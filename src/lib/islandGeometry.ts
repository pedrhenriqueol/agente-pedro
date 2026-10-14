export type IslandSize = 'small' | 'medium' | 'large';
export const ISLAND_FRAME_PADDING = 24;
export const ISLAND_HEADER_HEIGHT = 32;
export const ISLAND_MAX_HEIGHT = 400;

/** Logical dimensions; transparent frame space never scales with the content. */
export function islandGeometry(size: IslandSize, hasActivity: boolean, viewportWidth: number) {
  const available = Math.max(72, Number.isFinite(viewportWidth) ? viewportWidth - ISLAND_FRAME_PADDING : 560);
  return {
    compactWidth: Math.min(available, hasActivity ? 280 : 96),
    compactHeight: hasActivity ? 30 : 24,
    expandedWidth: Math.min(available, { small: 480, medium: 560, large: 640 }[size]),
  };
}
