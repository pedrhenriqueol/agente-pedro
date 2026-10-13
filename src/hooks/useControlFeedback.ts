import { useEffect } from 'react';

/** Visual feedback leaves the controls' commands and target rectangles intact. */
export function useControlFeedback() {
  useEffect(() => {
    const pressed = new Map<HTMLElement, { started: number; timer?: number }>();
    const target = (event: Event) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('button, summary') : null;
      return node && node.closest('#root, .dialog-backdrop') && !node.closest('[inert], [hidden], [aria-hidden="true"]')
        && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true' ? node : null;
    };
    const clear = (node: HTMLElement) => {
      const record = pressed.get(node); if (record?.timer) clearTimeout(record.timer);
      node.removeAttribute('data-pressed'); pressed.delete(node);
    };
    const press = (node: HTMLElement) => {
      const record = pressed.get(node); if (record?.timer) clearTimeout(record.timer);
      node.dataset.pressed = 'true'; pressed.set(node, { started: record?.started ?? performance.now() });
    };
    const release = () => pressed.forEach((record, node) => {
      if (record.timer) clearTimeout(record.timer);
      record.timer = window.setTimeout(() => clear(node), Math.max(0, 80 - (performance.now() - record.started)));
    });
    const cancel = () => [...pressed.keys()].forEach(clear);
    const down = (event: Event) => { const node = target(event); if (node) press(node); };
    const keyDown = (event: KeyboardEvent) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) down(event); };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') release(); };
    const click = (event: MouseEvent) => { const node = target(event); if (node && !pressed.has(node)) { press(node); release(); } };
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', cancel, true); document.addEventListener('keydown', keyDown, true);
    document.addEventListener('keyup', keyUp, true); document.addEventListener('click', click, true); window.addEventListener('blur', cancel);
    return () => {
      cancel(); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('keyup', keyUp, true); document.removeEventListener('click', click, true); window.removeEventListener('blur', cancel);
    };
  }, []);
}
