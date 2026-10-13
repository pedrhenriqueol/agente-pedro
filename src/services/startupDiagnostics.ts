import { invoke, isTauri } from '@tauri-apps/api/core';

export type StartupStage = 'frontend_loaded' | 'data_loading' | 'frontend_ready' | 'frontend_error';

/** Capture failure causes without including store snapshots or blocking startup on logging. */
export function startupErrorMessage(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && error != null && !seen.has(error); depth++) {
    seen.add(error);
    if (error instanceof Error) {
      parts.push(error.message);
      error = error.cause;
    } else {
      parts.push(typeof error === 'string' ? error : 'Falha sem mensagem disponível');
      break;
    }
  }
  return parts.join(' | ').slice(0, 2000);
}

export async function reportStartupStatus(stage: StartupStage, error?: unknown): Promise<void> {
  try {
    if (isTauri()) await invoke('startup_status', { stage, message: error === undefined ? null : startupErrorMessage(error) });
  } catch { /* Diagnostics must not prevent opening local data or retrying. */ }
}
