import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Page } from '../../lib/desktop';

const PageVisibilityContext = createContext(true);

/** Portals belong to a page too: a hidden page must release its modal and focus trap. */
export function usePageActive() { return useContext(PageVisibilityContext); }

function useReducedMotion(preference: boolean) {
  const [system, setSystem] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystem(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return preference || system;
}

interface TransitionState { current: Page; outgoing: Page | null; visited: Page[]; revision: number }
interface PageTransitionProps {
  page: Page;
  reduceMotion: boolean;
  label: (page: Page) => string;
  children: (page: Page) => ReactNode;
}

/** Mount each area on its first visit and retain its forms and scroll position. */
export function PageTransition({ page, reduceMotion, label, children }: PageTransitionProps) {
  const immediate = useReducedMotion(reduceMotion);
  const [state, setState] = useState<TransitionState>(() => ({ current: page, outgoing: null, visited: [page], revision: 0 }));
  // Derive the presentation before committing a changed destination. An interrupted
  // transition always leaves from the latest requested area, never an old timer.
  if (state.current !== page) {
    setState({ current: page, outgoing: immediate ? null : state.current,
      visited: state.visited.includes(page) ? state.visited : [...state.visited, page], revision: state.revision + 1 });
  } else if (immediate && state.outgoing) {
    setState({ ...state, outgoing: null });
  }
  useEffect(() => {
    if (!state.outgoing) return;
    const revision = state.revision;
    const timer = window.setTimeout(() => setState(current => current.revision === revision
      ? { ...current, outgoing: null } : current), 220);
    return () => window.clearTimeout(timer);
  }, [state.outgoing, state.revision]);

  return <div className="navigation-pages" data-transitioning={Boolean(state.outgoing)}>
    {state.visited.map(id => {
      const active = id === state.current;
      const leaving = id === state.outgoing;
      return <section key={id} className={`navigation-page${active && state.outgoing ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}`}
        data-page={id} hidden={!active && !leaving} aria-label={label(id)} aria-hidden={!active || undefined} inert={!active || undefined}>
        <PageVisibilityContext.Provider value={active}>
          <div className="page-content">{children(id)}</div>
        </PageVisibilityContext.Provider>
      </section>;
    })}
  </div>;
}
