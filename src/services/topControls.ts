import { invoke, isTauri } from '@tauri-apps/api/core';

export type TopControlLabel = 'top-left' | 'top-right';
export interface TopControlFrame { visible: boolean; expanded: boolean; width: number; height: number }

interface Batch {
  frame: TopControlFrame;
  waiters: { resolve: (frame: TopControlFrame) => void; reject: (error: unknown) => void }[];
}
interface Queue { pending: Batch | null; running: boolean }
const queues: Record<TopControlLabel, Queue> = {
  'top-left': { pending: null, running: false }, 'top-right': { pending: null, running: false },
};

/** Each corner has one native owner and a queue independent of the other one. */
export function configureTopControl(label: TopControlLabel, frame: TopControlFrame): Promise<TopControlFrame> {
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height)) {
    return Promise.reject(new Error('As dimensões do controle de desktop não são válidas.'));
  }
  if (!isTauri()) return Promise.resolve({ ...frame });
  return new Promise((resolve, reject) => {
    const queue = queues[label];
    if (queue.pending) { queue.pending.frame = { ...frame }; queue.pending.waiters.push({ resolve, reject }); }
    else queue.pending = { frame: { ...frame }, waiters: [{ resolve, reject }] };
    if (!queue.running) void flush(label);
  });
}

async function flush(label: TopControlLabel): Promise<void> {
  const queue = queues[label];
  queue.running = true;
  try {
    while (queue.pending) {
      const batch = queue.pending;
      queue.pending = null;
      try {
        const result = await invoke<TopControlFrame>('configure_top_control', { label, ...batch.frame });
        batch.waiters.forEach(waiter => waiter.resolve(result));
      } catch (error) { batch.waiters.forEach(waiter => waiter.reject(error)); }
    }
  } finally { queue.running = false; }
}
