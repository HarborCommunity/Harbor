const GLIDE = "harbor-modern-glide";
/** More rows than this moving at once would be a shake and no longer a glide. */
const MOST_ROWS = 80;

export type RowPlaces = ReadonlyMap<Element, number>;

function placeIn(area: Element): (row: Element) => number {
  const top = area.getBoundingClientRect().top;
  return (row) => row.getBoundingClientRect().top - top;
}

/** A row that is still gliding counts where it is on its way. */
export function rowPlaces(area: Element): RowPlaces | null {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  const place = placeIn(area);
  return new Map([...area.children].map((row) => [row, place(row)]));
}

export function endGlides(area: Element) {
  for (const animation of area.getAnimations?.({ subtree: true }) ?? []) {
    if (animation.id === GLIDE) animation.finish();
  }
}

export function glideFrom(before: RowPlaces, area: Element) {
  endGlides(area);
  const place = placeIn(area);
  const moves: { row: Element; way: number }[] = [];
  for (const row of area.children) {
    const was = before.get(row);
    const way = was === undefined ? 0 : was - place(row);
    if (Math.abs(way) >= 1) moves.push({ row, way });
  }
  if (moves.length > MOST_ROWS) return;
  for (const { row, way } of moves) {
    row.animate?.([{ transform: `translateY(${way}px)` }, { transform: "none" }], {
      id: GLIDE,
      duration: 380,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
  }
}
