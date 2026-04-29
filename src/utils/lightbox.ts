export const getFitScale = (
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number => {
  if (!naturalWidth || !naturalHeight) return 1;
  const scaleX = viewportWidth / naturalWidth;
  const scaleY = viewportHeight / naturalHeight;
  return Math.min(scaleX, scaleY);
};

export const computeNextScale = (
  currentScale: number,
  zoomIn: boolean,
  ratio: number,
  min: number,
  max: number,
): number => {
  const multiplier = zoomIn ? 1 + ratio : 1 - ratio;
  return Math.min(max, Math.max(min, currentScale * multiplier));
};
