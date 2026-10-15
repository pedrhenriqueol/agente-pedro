export interface WidgetDimensions { width: number; height: number }

/** Applied footprint, with the stable WebView reservation when supported. */
export interface WidgetViewport extends WidgetDimensions { viewport?: WidgetDimensions }

/** Validate native geometry before it can constrain a surface or release it. */
export function normalizeWidgetViewport(value: unknown): WidgetViewport {
  const dimensions = (candidate: unknown): WidgetDimensions => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new Error('A janela retornou dimensões inválidas.');
    }
    const { width, height } = candidate as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number'
      || ![width, height].every(number => Number.isFinite(number) && number > 0)) {
      throw new Error('A janela retornou dimensões inválidas.');
    }
    return { width, height };
  };
  const footprint = dimensions(value);
  const reservation = (value as Record<string, unknown>).viewport;
  // A missing/null field is the existing backend contract, where the HWND and
  // the footprint have identical dimensions.
  if (reservation == null) return footprint;
  const viewport = dimensions(reservation);
  if (footprint.width > viewport.width + 1 || footprint.height > viewport.height + 1) {
    throw new Error('A janela retornou dimensões inválidas.');
  }
  return { ...footprint, viewport };
}

/**
 * A stable native viewport can contain a smaller interactive footprint. Keep
 * the preparer pose until two frames confirm the reservation, not its region.
 * Older backends still resize their HWND to the footprint on each operation.
 * This is a renderer barrier, not a guarantee about the Windows compositor.
 */
export function waitForWidgetViewport(expected: WidgetViewport, current: () => boolean): Promise<boolean> {
  let target: WidgetDimensions;
  try {
    const confirmed = normalizeWidgetViewport(expected);
    target = confirmed.viewport ?? confirmed;
  } catch (error) { return Promise.reject(error); }
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
      const ready = Math.abs(window.innerWidth - target.width) < 1
        && Math.abs(window.innerHeight - target.height) < 1;
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
