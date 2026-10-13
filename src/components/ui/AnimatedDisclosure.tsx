import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useReducedMotion } from './PageTransition';

interface AnimatedDisclosureProps { title: string; reduceMotion: boolean; children: ReactNode }

/** A semantic disclosure that keeps its content mounted and reverses from its current height. */
export function AnimatedDisclosure({ title, reduceMotion, children }: AnimatedDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const sequence = useRef(0);
  const immediate = useReducedMotion(reduceMotion);
  if (expanded && !present) setPresent(true);

  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const epoch = ++sequence.current;
    const height = node.getBoundingClientRect().height;
    const opacity = getComputedStyle(node).opacity;
    animation.current?.cancel();
    animation.current = null;
    if (!expanded && node.contains(document.activeElement)) summary.current?.focus({ preventScroll: true });
    const target = expanded ? content.current?.scrollHeight ?? 0 : 0;
    node.style.height = `${target}px`;
    node.style.opacity = expanded ? '1' : '0';
    const finish = () => {
      if (epoch !== sequence.current) return;
      if (expanded) node.style.height = 'auto';
      else setPresent(false);
    };
    if (immediate || !present || Math.abs(height - target) < 1) { finish(); return; }
    const current = node.animate([{ height: `${height}px`, opacity }, { height: `${target}px`, opacity: expanded ? '1' : '0' }],
      { duration: 190, easing: 'cubic-bezier(.16,1,.3,1)' });
    animation.current = current;
    void current.finished.then(finish, () => {});
  }, [expanded, present, immediate]);

  useEffect(() => () => { sequence.current++; animation.current?.cancel(); }, []);
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
