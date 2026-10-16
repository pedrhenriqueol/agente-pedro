import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motion, useAnimationControls } from 'motion/react';

interface MenuHighlightProps {
  owner: RefObject<HTMLElement | null>;
  active: number | null;
  reduceMotion: boolean;
}

/** A decorative cursor follows the presented position, without moving a hit target. */
export function MenuHighlight({ owner, active, reduceMotion }: MenuHighlightProps) {
  const controls = useAnimationControls();
  const anchored = useRef(false);
  const revision = useRef(0);

  useLayoutEffect(() => {
    const menu = owner.current;
    if (!menu) return;
    const update = () => {
      const current = ++revision.current;
      controls.stop();
      const item = active === null ? null : menu.querySelector<HTMLElement>(`[data-menu-index="${active}"]`);
      if (!item || !item.offsetWidth || !item.offsetHeight) {
        if (reduceMotion) { controls.set({ opacity: 0 }); anchored.current = false; }
        else void controls.start({ opacity: 0 }, { duration: .10 }).then(() => {
          if (current === revision.current) anchored.current = false;
        });
        return;
      }
      // Layout offsets stay correct while an ancestor crossfades or translates.
      const box = { x: item.offsetLeft, y: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight };
      if (reduceMotion) controls.set({ ...box, opacity: 1 });
      else if (!anchored.current) {
        // First appearance belongs to its item, rather than travelling from (0,0).
        controls.set({ ...box, opacity: 0 });
        void controls.start({ opacity: 1 }, { duration: .10 });
      } else {
        void controls.start({ ...box, opacity: 1 }, { type: 'tween', duration: .16, ease: [.18, .8, .28, 1] });
      }
      anchored.current = true;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    return () => { revision.current++; observer.disconnect(); controls.stop(); };
  }, [active, owner, reduceMotion, controls]);

  return <motion.span className="island-menu-highlight" aria-hidden="true" data-menu-highlight
    initial={{ opacity: 0, x: 0, y: 0, width: 0, height: 0 }} animate={controls} />;
}
