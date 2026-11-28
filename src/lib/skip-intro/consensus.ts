import type { SkipSegment } from "./types";

const SELF_OVERLAP_TOLERANCE_SEC = 2;

// An intro and a recap from one source cannot overlap; when they do, that source's timing is wrong, so both go.
export function dropSelfContradicting(list: SkipSegment[]): SkipSegment[] {
  const clash = (a: SkipSegment, b: SkipSegment) =>
    a.kind !== b.kind &&
    (a.kind === "intro" || a.kind === "recap") &&
    (b.kind === "intro" || b.kind === "recap") &&
    Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec) > SELF_OVERLAP_TOLERANCE_SEC;
  return list.filter((s) => !list.some((o) => clash(s, o)));
}
