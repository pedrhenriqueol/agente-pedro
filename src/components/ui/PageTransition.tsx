import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Page } from '../../lib/desktop';
import { WAAPI_ENTER, WAAPI_EXIT, WAAPI_PANEL } from '../../lib/motionProfiles';

const PageVisibilityContext = createContext(true);

/** Portals belong to a page too: a hidden page must release its modal and focus trap. */
export function usePageActive() { return useContext(PageVisibilityContext); }

export function useReducedMotion(preference: boolean) {
  const [system, setSystem] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystem(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return preference || system;
}

interface TransitionState<T> { current: T; outgoing: T[]; visited: T[]; revision: number; direction: 1 | -1 }
interface RetainedTransitionProps<T extends string> {
  value: T;
  reduceMotion: boolean;
  containerClassName: string;
  sectionClassName: string;
  slotAttribute: 'data-page' | 'data-section';
  label?: (value: T) => string;
  tabId?: (value: T) => string;
  panelId?: (value: T) => string;
  measureHeight?: boolean;
  values?: readonly T[];
  order?: readonly T[];
  children: (value: T) => ReactNode;
}

/** Retain visited areas and reverse from the currently drawn values, including midway through entry. */
export function RetainedTransition<T extends string>({ value, reduceMotion, containerClassName, sectionClassName,
  slotAttribute, label, tabId, panelId, measureHeight = false, values = [], order = values, children }: RetainedTransitionProps<T>) {
  const immediate = useReducedMotion(reduceMotion);
  const parentActive = usePageActive();
  const [state, setState] = useState<TransitionState<T>>(() => ({ current: value, outgoing: [], visited: [value], revision: 0, direction: 1 }));
  const container = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<T, HTMLElement>());
  const animations = useRef<Animation[]>([]);
  const visible = useRef(new Set<T>([value]));
  const sequence = useRef(0);
  const restingHeight = useRef<number | null>(null);
  if (state.current !== value) {
    const from = order.indexOf(state.current);
    const to = order.indexOf(value);
    setState({ current: value, outgoing: immediate ? [] : [...new Set([...state.outgoing, state.current])].filter(id => id !== value),
      visited: state.visited.includes(value) ? state.visited : [...state.visited, value], revision: state.revision + 1,
      direction: from >= 0 && to >= 0 && to < from ? -1 : 1 });
  }

  useLayoutEffect(() => {
    const epoch = ++sequence.current;
    // Sample each visible layer exactly once before cancellation removes its animation effect.
    const samples = new Map<T, { opacity: string; transform: string }>();
    for (const id of [state.current, ...state.outgoing]) {
      const node = nodes.current.get(id);
      if (!node) continue;
      if (visible.current.has(id)) {
        const computed = getComputedStyle(node);
        samples.set(id, { opacity: computed.opacity, transform: computed.transform });
      } else samples.set(id, { opacity: '0', transform: `translateX(${state.direction * 10}px)` });
    }
    const initialHeight = measureHeight ? animations.current.some(animation => animation.playState === 'running')
      ? container.current?.getBoundingClientRect().height : restingHeight.current ?? container.current?.getBoundingClientRect().height : undefined;
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    visible.current = new Set([state.current, ...state.outgoing]);
    const entering = state.outgoing.length > 0;
    for (const id of [state.current, ...state.outgoing]) {
      const node = nodes.current.get(id);
      if (!node) continue;
      const active = id === state.current;
      const sample = samples.get(id)!;
      node.style.opacity = active ? '1' : '0';
      node.style.transform = active ? 'none' : `translateX(${state.direction * -6}px)`;
      if (!immediate && parentActive && entering) {
        animations.current.push(node.animate([sample, { opacity: active ? '1' : '0', transform: node.style.transform }],
          active ? WAAPI_ENTER : WAAPI_EXIT));
      }
    }
    if (measureHeight && container.current) {
      const target = nodes.current.get(state.current)?.scrollHeight ?? initialHeight ?? 0;
      container.current.style.height = entering && !immediate && parentActive ? `${target}px` : 'auto';
      if (entering && !immediate && parentActive && initialHeight !== undefined && Math.abs(initialHeight - target) > 1) {
        animations.current.push(container.current.animate([{ height: `${initialHeight}px` }, { height: `${target}px` }],
          WAAPI_PANEL));
      }
    }
    const finish = () => {
      if (epoch !== sequence.current) return;
      visible.current = new Set([state.current]);
      if (container.current && measureHeight) container.current.style.height = 'auto';
      if (measureHeight) restingHeight.current = nodes.current.get(state.current)?.scrollHeight ?? null;
      if (state.outgoing.length) setState(current => current.revision === state.revision ? { ...current, outgoing: [] } : current);
    };
    if (!animations.current.length) finish();
    else void Promise.allSettled(animations.current.map(animation => animation.finished)).then(finish);
  }, [state.current, state.revision, immediate, measureHeight, parentActive]);

  useLayoutEffect(() => {
    const node = nodes.current.get(state.current);
    if (!measureHeight || !node) return;
    const observer = new ResizeObserver(() => {
      if (!animations.current.some(animation => animation.playState === 'running')) restingHeight.current = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state.current, measureHeight]);

  useEffect(() => () => { sequence.current++; animations.current.forEach(animation => animation.cancel()); }, []);

  return <div ref={container} className={containerClassName} data-transitioning={Boolean(state.outgoing.length)}
    data-direction={state.direction === 1 ? 'forward' : 'backward'}>
    {values.filter(id => !state.visited.includes(id)).map(id => <section key={id} hidden role={tabId ? 'tabpanel' : undefined}
      id={panelId?.(id)} aria-labelledby={tabId?.(id)} />)}
    {state.visited.map(id => {
      const active = id === state.current;
      const leaving = state.outgoing.includes(id);
      return <section key={id} ref={node => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }}
        className={sectionClassName} {...{ [slotAttribute]: id }} data-presence={active ? 'active' : leaving ? 'leaving' : 'hidden'}
        hidden={!active && !leaving} aria-label={label?.(id)} aria-hidden={!active || undefined} inert={!active || undefined}
        role={tabId ? 'tabpanel' : undefined} tabIndex={tabId ? 0 : undefined} id={panelId?.(id)} aria-labelledby={tabId?.(id)}>
        <PageVisibilityContext.Provider value={active && parentActive}>
          <div className="page-content">{children(id)}</div>
        </PageVisibilityContext.Provider>
      </section>;
    })}
  </div>;
}

interface PageTransitionProps {
  page: Page;
  reduceMotion: boolean;
  label: (page: Page) => string;
  children: (page: Page) => ReactNode;
}

export function PageTransition({ page, reduceMotion, label, children }: PageTransitionProps) {
  return <RetainedTransition value={page} reduceMotion={reduceMotion} label={label} containerClassName="navigation-pages"
    sectionClassName="navigation-page" slotAttribute="data-page" order={PAGE_ORDER}>{children}</RetainedTransition>;
}

const PAGE_ORDER: readonly Page[] = ['home', 'routine', 'finance', 'music', 'appearance'];
