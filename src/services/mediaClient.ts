import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'volume';
export interface MediaSession {
  id: string;
  sourceApp: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  playbackStatus: 'playing' | 'paused' | 'stopped' | 'unknown';
  canPlay: boolean;
  canPause: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  positionSeconds: number | null;
  durationSeconds: number | null;
}
export interface MediaSnapshot {
  revision: number;
  sequence: number;
  supported: boolean;
  session: MediaSession | null;
  volume: number | null;
  muted: boolean | null;
  error: string | null;
}
export interface MediaPosition {
  revision: number;
  sequence: number;
  sessionId: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export const EMPTY_MEDIA: MediaSnapshot = {
  revision: 0, sequence: 0, supported: false, session: null, volume: null, muted: null, error: null,
};

export async function readMedia(): Promise<MediaSnapshot> {
  return isTauri() ? invoke<MediaSnapshot>('media_snapshot') : { ...EMPTY_MEDIA };
}

export async function watchMedia(receive: (snapshot: MediaSnapshot) => void, position: (value: MediaPosition) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const stopSnapshot = await listen<MediaSnapshot>('pedro:media', event => receive(event.payload));
  try {
    const stopPosition = await listen<MediaPosition>('pedro:media-position', event => position(event.payload));
    return () => { stopSnapshot(); stopPosition(); };
  } catch (error) { stopSnapshot(); throw error; }
}

export async function sendMediaControl(action: MediaAction, sessionId: string | null, value?: number): Promise<MediaSnapshot> {
  if (!isTauri()) throw new Error('Os controles de música estão disponíveis no aplicativo para Windows.');
  return invoke<MediaSnapshot>('media_control', { action, sessionId, value: value ?? null });
}
