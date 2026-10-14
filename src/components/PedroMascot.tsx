/// <reference types="vite/client" />
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import mascotSvg from '../assets/pedro-icon.svg?raw';
import '../styles/mascot.css';

export type PedroMascotEmotion = 'calm' | 'engaged' | 'focus' | 'music';

interface PedroMascotProps {
  className?: string;
  emotion?: PedroMascotEmotion;
  /** The surrounding surface receives interaction; this mark never captures it. */
  interactive?: boolean;
}

const readSystemMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const watchSystemMotion = (receive: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', receive);
  return () => query.removeEventListener('change', receive);
};

/** A single original vector, also used by the native app icons. */
export function PedroMascot({ className = '', emotion = 'calm', interactive = false }: PedroMascotProps) {
  const host = useRef<HTMLSpanElement>(null);
  const systemReduced = useSyncExternalStore(watchSystemMotion, readSystemMotion, () => false);
  const appReduced = usePreferencesStore(state => state.reduceMotion);
  const movement = interactive && !systemReduced && !appReduced;

  useEffect(() => {
    const node = host.current;
    if (!node || !movement) return;
    const surface = node.closest<HTMLElement>('.pedro-island') ?? node.parentElement;
    const islandShell = node.closest<HTMLElement>('.island-shell');
    const svg = node.querySelector('svg');
    const eyes = Array.from(node.querySelectorAll<SVGGElement>('.pedro-mascot-eyes'));
    if (!surface || !svg) return;

    let animations: Animation[] = [];
    const stop = () => { animations.forEach(animation => animation.cancel()); animations = []; };
    const available = () => !document.hidden && !node.closest('[inert], [hidden]')
      && islandShell?.dataset.islandVisible !== 'false' && islandShell?.dataset.visibilityIntent !== 'false';
    const react = () => {
      stop();
      if (!available() || typeof svg.animate !== 'function') return;
      const rest = emotion === 'focus' ? .86 : 1;
      animations = eyes.map(eye => eye.animate([
        { transform: `scaleY(${rest})` },
        { transform: 'scaleY(.08)', offset: .42 },
        { transform: `scaleY(${rest})` },
      ], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' }));
      // One small acknowledgement, then rest. No breathing or pointer-tracking loop.
      animations.push(svg.animate([
        { transform: 'none' },
        { transform: `translateY(-1%) rotate(${emotion === 'music' ? 2 : -1.5}deg)`, offset: .45 },
        { transform: 'none' },
      ], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' }));
    };
    const focus = (event: FocusEvent) => {
      if (!surface.contains(event.relatedTarget as Node | null)) react();
    };
    const visibility = () => { if (!available()) stop(); };
    surface.addEventListener('pointerenter', react);
    surface.addEventListener('focusin', focus);
    surface.addEventListener('pointerleave', stop);
    document.addEventListener('visibilitychange', visibility);
    // Native hide makes the ancestor inert before physically hiding its HWND.
    const observer = islandShell ? new MutationObserver(visibility) : null;
    observer?.observe(islandShell!, { attributes: true, attributeFilter: ['inert', 'aria-hidden', 'data-island-visible', 'data-visibility-intent'] });
    react();
    return () => {
      stop(); observer?.disconnect();
      surface.removeEventListener('pointerenter', react);
      surface.removeEventListener('focusin', focus);
      surface.removeEventListener('pointerleave', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [movement, emotion]);

  return <span ref={host} className={`pedro-mascot${className ? ` ${className}` : ''}`} aria-hidden="true" draggable={false}
    data-emotion={emotion} data-movement={movement}
    // Only the bundled, trusted SVG is inserted; external or user SVG is never accepted.
    dangerouslySetInnerHTML={{ __html: mascotSvg }} />;
}
