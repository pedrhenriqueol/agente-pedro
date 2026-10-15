import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import '../../styles/action-confirmation.css';

const readSystemMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const watchSystemMotion = (receive: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', receive);
  return () => query.removeEventListener('change', receive);
};

/** Decoration for an existing status message, issued only after an action succeeds. */
export function ActionConfirmation({ eventId }: { eventId: number }) {
  const icon = useRef<SVGSVGElement>(null);
  const consumed = useRef(0);
  const systemReduced = useSyncExternalStore(watchSystemMotion, readSystemMotion, () => false);
  const appReduced = usePreferencesStore(state => state.reduceMotion);

  useEffect(() => {
    const node = icon.current;
    if (!node || !eventId || consumed.current === eventId) return;
    const available = () => !document.hidden && !node.parentElement?.closest('[hidden], [inert], [aria-hidden="true"], [data-island-visible="false"], [data-visibility-intent="false"]')
      && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
    if (systemReduced || appReduced || !available() || typeof node.animate !== 'function') {
      consumed.current = eventId;
      return;
    }

    let animation: Animation | undefined;
    // A single frame defers consumption past Strict Mode's setup/cleanup probe.
    // Reopening a retained, hidden view never schedules a second acknowledgement.
    const frame = requestAnimationFrame(() => {
      consumed.current = eventId;
      if (!available()) return;
      animation = node.animate([
        { opacity: .55, transform: 'scale(.82)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { duration: 150, easing: 'cubic-bezier(.18,.8,.28,1)' });
    });
    const stopWhenHidden = () => {
      if (available()) return;
      consumed.current = eventId;
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
    const observer = new MutationObserver(stopWhenHidden);
    // Observe ancestor visibility flags only, never the moving SVG or DOM content.
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-island-visible', 'data-visibility-intent'] });
    }
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      observer.disconnect();
      document.removeEventListener('visibilitychange', stopWhenHidden);
    };
  }, [eventId, systemReduced, appReduced]);

  return <Check ref={icon} size={13} className="action-confirmation" aria-hidden="true" focusable="false" />;
}
