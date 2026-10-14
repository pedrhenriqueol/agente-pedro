import type { Transition } from 'motion/react';

/** Original Pedro motion vocabulary. Geometry never overshoots its prepared frame. */
export const SURFACE_OPEN: Transition = { type: 'spring', duration: .26, bounce: 0 };
export const SURFACE_CHANGE: Transition = { type: 'spring', duration: .22, bounce: 0 };
export const SURFACE_CLOSE: Transition = { type: 'tween', duration: .20, ease: [.4, 0, .18, 1] };
export const POPOVER_ENTER: Transition = { type: 'spring', duration: .24, bounce: .04 };
export const POPOVER_EXIT: Transition = { type: 'tween', duration: .14, ease: [.32, 0, .68, 1] };
export const CONTENT_ENTER: Transition = { type: 'tween', duration: .18, ease: [.18, .8, .28, 1] };
export const CONTENT_EXIT: Transition = { type: 'tween', duration: .10, ease: [.4, 0, 1, 1] };
export const MARKER_TRAVEL: Transition = { type: 'spring', duration: .21, bounce: 0 };
export const MOTION_INSTANT: Transition = { duration: 0 };
export const WAAPI_ENTER = { duration: 180, easing: 'cubic-bezier(.18,.8,.28,1)' };
export const WAAPI_EXIT = { duration: 100, easing: 'cubic-bezier(.4,0,1,1)' };
export const WAAPI_PANEL = { duration: 220, easing: 'cubic-bezier(.18,.8,.28,1)' };
