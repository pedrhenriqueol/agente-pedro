import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePageActive } from './PageTransition';
import { usePreferencesStore } from '../../stores/usePreferencesStore';

interface DialogProps { open?: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }

interface ModalLock { overlay: HTMLElement; dialog: HTMLElement; previous: HTMLElement | null }
const locks = new Map<symbol, ModalLock>();
const background = new Map<HTMLElement, boolean>();
let previousOverflow = '';
const topModal = () => [...locks.values()].at(-1);

function focusFirst(dialog: HTMLElement) {
  (dialog.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled])') ?? dialog).focus({ preventScroll: true });
}

/** A handoff between portals must not restore another dialog's background lock. */
function refreshLocks() {
  const top = topModal();
  if (!top) {
    background.forEach((inert, node) => { if (node.isConnected) node.inert = inert; });
    background.clear();
    document.body.style.overflow = previousOverflow;
    return;
  }
  for (const node of document.body.children) {
    if (!(node instanceof HTMLElement) || node.classList.contains('dialog-backdrop')) continue;
    if (!background.has(node)) background.set(node, node.inert);
    node.inert = true;
  }
  for (const modal of locks.values()) modal.overlay.inert = modal !== top;
  document.body.style.overflow = 'hidden';
}

function useReducedDialogMotion() {
  const preference = usePreferencesStore(state => state.reduceMotion);
  const [system, setSystem] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystem(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  return preference || system;
}

export function Dialog({ open = true, title, description, onClose, children, className = '' }: DialogProps) {
  const active = usePageActive();
  const immediate = useReducedDialogMotion();
  const [present, setPresent] = useState(open && active);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const animations = useRef<Animation[]>([]);
  const epoch = useRef(0);
  const lastPresentation = useRef({ title, description, children, className });
  close.current = onClose;
  if (open && active) lastPresentation.current = { title, description, children, className };
  if (active && open && !present) setPresent(true);
  else if (!active && present) setPresent(false);

  useLayoutEffect(() => {
    if (!active || !present || !overlay.current || !ref.current) return;
    const backdrop = overlay.current;
    const surface = ref.current;
    const revision = ++epoch.current;
    const nodes = [backdrop, surface];
    // Read both current frames before cancelling either animation. A reopen uses
    // exactly the closing frame, rather than restarting from the entrance pose.
    const current = nodes.map(node => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, transform: style.transform };
    });
    animations.current.forEach(animation => animation.cancel());
    nodes.forEach((node, index) => {
      node.style.opacity = current[index].opacity;
      if (index === 1) node.style.transform = current[index].transform;
    });
    const opacity = open ? '1' : '0';
    const transform = open ? 'translateY(0px) scale(1)' : 'translateY(4px) scale(.985)';
    if (immediate) {
      backdrop.style.opacity = opacity;
      surface.style.opacity = opacity;
      surface.style.transform = transform;
      animations.current = [];
      if (!open) setPresent(false);
      return;
    }
    const duration = open ? 190 : 120;
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' };
    const running = [
      backdrop.animate([{ opacity: current[0].opacity }, { opacity }], options),
      surface.animate([current[1], { opacity, transform }], options),
    ];
    animations.current = running;
    void Promise.all(running.map(animation => animation.finished)).then(() => {
      if (epoch.current !== revision) return;
      backdrop.style.opacity = opacity;
      surface.style.opacity = opacity;
      surface.style.transform = transform;
      running.forEach(animation => animation.cancel());
      animations.current = [];
      if (!open) setPresent(false);
    }).catch(() => { /* Superseded presentations are deliberately cancelled. */ });
    return () => { ++epoch.current; };
  }, [active, present, open, immediate]);

  useLayoutEffect(() => () => {
    ++epoch.current;
    animations.current.forEach(animation => animation.cancel());
  }, []);

  useLayoutEffect(() => {
    if (!active || !open || !present || !overlay.current || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const key = Symbol('dialog');
    if (locks.size === 0) previousOverflow = document.body.style.overflow;
    const modal = { overlay: overlay.current, dialog: ref.current, previous };
    locks.set(key, modal);
    refreshLocks();
    focusFirst(modal.dialog);
    const keys = (event: KeyboardEvent) => {
      if (topModal() !== modal) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]') ?? [])]
        .filter(e => e.tabIndex >= 0 && !e.hasAttribute('disabled') && e.getClientRects().length > 0);
      const first = items[0]; const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => {
      document.removeEventListener('keydown', keys, true);
      const wasTop = topModal() === modal;
      locks.delete(key);
      refreshLocks();
      const next = topModal();
      if (wasTop && next) focusFirst(next.dialog);
      else if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [active, open, present]);
  if (!active || !present) return null;
  const shown = lastPresentation.current;
  return createPortal(
    <div ref={overlay} className="dialog-backdrop" data-state={open ? 'open' : 'closing'} inert={!open || undefined}
      aria-hidden={!open || undefined} onClick={e => { if (open && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`dialog ${shown.className}`} role="dialog" aria-modal={open || undefined} aria-labelledby={`${id}-title`}
        aria-describedby={shown.description ? `${id}-description` : undefined} tabIndex={-1}>
        <header className="dialog-header"><div><h2 id={`${id}-title`}>{shown.title}</h2>
          {shown.description && <p id={`${id}-description`} className="muted">{shown.description}</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={18} aria-hidden="true" /></button></header>
        <div className="dialog-body">{shown.children}</div>
      </div>
    </div>, document.body,
  );
}
