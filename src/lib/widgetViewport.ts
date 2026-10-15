/** Logical client dimensions confirmed by the native window operation. */
export interface WidgetViewport { width: number; height: number }

/**
 * An HWND resize can finish before WebView2 receives its new viewport. Keep the
 * preparer pose until two actual animation frames see the confirmed dimensions.
 * This is a renderer barrier, not a guarantee about the Windows compositor.
 */
export function waitForWidgetViewport(expected: WidgetViewport, current: () => boolean): Promise<boolean> {
  if (![expected.width, expected.height].every(value => Number.isFinite(value) && value > 0)) {
    return Promise.reject(new Error('A janela retornou dimensões inválidas.'));
  }
  return new Promise((resolve, reject) => {
    let animationFrame = 0;
    let consecutive = 0;
    let finished = false;
    const finish = (result: boolean, error?: Error) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
      if (error) reject(error); else resolve(result);
    };
    const sample = () => {
      if (!current()) { finish(false); return; }
      // Hidden is not obsolete: abandoning a still-valid preparation would
      // leave its native frame expanded and empty when the WebView returns.
      if (document.hidden) {
        consecutive = 0;
        animationFrame = requestAnimationFrame(sample);
        return;
      }
      // Physical rounding at fractional DPI can differ from innerWidth by <1px.
      const ready = Math.abs(window.innerWidth - expected.width) < 1
        && Math.abs(window.innerHeight - expected.height) < 1;
      consecutive = ready ? consecutive + 1 : 0;
      if (consecutive >= 2) finish(true);
      else animationFrame = requestAnimationFrame(sample);
    };
    const timeout = window.setTimeout(() => {
      if (!current()) finish(false);
      else finish(false, new Error('A janela não confirmou seu tamanho a tempo. Tente novamente.'));
    }, 1200);
    animationFrame = requestAnimationFrame(sample);
  });
}
