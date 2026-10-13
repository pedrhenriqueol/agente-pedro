import { useLayoutEffect, useRef, type RefObject } from 'react';

interface SelectionIndicatorProps {
  owner: RefObject<HTMLElement | null>;
  selection: string;
  selector: string;
  className: string;
  axis?: 'vertical' | 'horizontal';
}

/** One persistent marker: geometry is measured only when selection or container dimensions change. */
export function SelectionIndicator({ owner, selection, selector, className, axis = 'horizontal' }: SelectionIndicatorProps) {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const container = owner.current;
    const node = marker.current;
    if (!container || !node) return;
    const update = () => {
      const selected = container.querySelector<HTMLElement>(selector);
      if (!selected) return;
      // Offset coordinates stay anchored while a tab strip scrolls.
      if (axis === 'vertical') {
        node.style.transform = `translateY(${selected.offsetTop + (selected.offsetHeight - 16) / 2}px)`;
      } else {
        node.style.transform = `translateX(${selected.offsetLeft}px)`;
        node.style.width = `${selected.offsetWidth}px`;
        node.style.height = `${selected.offsetHeight}px`;
        node.style.top = `${selected.offsetTop}px`;
      }
      node.dataset.ready = 'true';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [owner, selection, selector, axis]);
  return <span ref={marker} className={className} aria-hidden="true" />;
}
