import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePageActive, useReducedMotion } from './PageTransition';
import { WAAPI_ENTER, WAAPI_EXIT, WAAPI_PANEL } from '../../lib/motionProfiles';

interface AnimatedDisclosureProps { title: string; reduceMotion: boolean; children: ReactNode }

/** A semantic disclosure that keeps its content mounted and reverses from its current height. */
export function AnimatedDisclosure({ title, reduceMotion, children }: AnimatedDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const sequence = useRef(0);
  const immediate = useReducedMotion(reduceMotion);
  const parentActive = usePageActive();
  if (expanded && !present) setPresent(true);

  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const epoch = ++sequence.current;
    const height = node.getBoundingClientRect().height;
    const opacity = getComputedStyle(node).opacity;
    const inner = content.current;
    // Preserve both layers before cancellation so a rapid reversal resumes the
    // currently drawn content instead of replaying an entrance from scratch.
    const transform = height < 1 && expanded ? 'translateY(4px)' : inner ? getComputedStyle(inner).transform : 'none';
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    if (!expanded && node.contains(document.activeElement)) summary.current?.focus({ preventScroll: true });
    const target = expanded ? content.current?.scrollHeight ?? 0 : 0;
    node.style.height = `${target}px`;
    node.style.opacity = expanded ? '1' : '0';
    if (inner) inner.style.transform = expanded ? 'none' : 'translateY(-3px)';
    const finish = () => {
      if (epoch !== sequence.current) return;
      if (expanded) node.style.height = 'auto';
      else setPresent(false);
    };
    if (immediate || !parentActive || !present || Math.abs(height - target) < 1) { finish(); return; }
    const current = node.animate([{ height: `${height}px`, opacity }, { height: `${target}px`, opacity: expanded ? '1' : '0' }],
      expanded ? WAAPI_PANEL : { ...WAAPI_EXIT, duration: 160 });
    animations.current = [current];
    if (inner) animations.current.push(inner.animate([{ transform }, { transform: inner.style.transform }], expanded ? WAAPI_ENTER : WAAPI_EXIT));
    void Promise.allSettled(animations.current.map(animation => animation.finished)).then(finish);
  }, [expanded, present, immediate, parentActive]);

  useEffect(() => () => { sequence.current++; animations.current.forEach(animation => animation.cancel()); }, []);
  return <details className="settings-details is-animated-disclosure" open={present} data-expanded={expanded}
    onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); } }}>
    <summary ref={summary} aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      {title}<ChevronDown size={15} aria-hidden="true" />
    </summary>
    <div ref={body} className="settings-disclosure-body" aria-hidden={!expanded || undefined} inert={!expanded || undefined}>
      <div ref={content} className="settings-disclosure-content">{children}</div>
    </div>
  </details>;
}
