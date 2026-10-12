import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface DialogProps { title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }

export function Dialog({ title, description, onClose, children, className = '' }: DialogProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((e): e is HTMLElement => e instanceof HTMLElement && e !== overlay.current)
      .map(node => ({ node, inert: node.inert }));
    siblings.forEach(({ node }) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    (ref.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), button') ?? ref.current)?.focus();
    const keys = (event: KeyboardEvent) => {
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
      siblings.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = overflow;
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div ref={overlay} className="dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}>
        <header className="dialog-header"><div><h2 id={`${id}-title`}>{title}</h2>
          {description && <p id={`${id}-description`} className="muted">{description}</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={18} aria-hidden="true" /></button></header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>, document.body,
  );
}
