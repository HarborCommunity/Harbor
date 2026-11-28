import type { ParticipantSyncPhase } from "./protocol";

/** Closer to the host than this counts as in sync; nobody can tell from another room. */
export const IN_SYNC_S = 1;
/** Further than this, a guest's own correction should already have jumped; it needs a look. */
export const FAR_OFFSET_S = 3;

/** What a guest tells the room about its distance from the host: 0 when in sync, else half seconds. */
export function reportedOffset(offsetS: number): number {
  if (!Number.isFinite(offsetS) || Math.abs(offsetS) < IN_SYNC_S) return 0;
  return Math.round(offsetS * 2) / 2;
}

/** How a person's playback compares with the host's, worded for people, not for engineers. */
export type SyncHealth =
  | { kind: "in-sync" }
  | { kind: "loading" }
  | { kind: "behind" | "ahead"; seconds: number };

export function syncHealth(
  phase: ParticipantSyncPhase | undefined,
  offset: number | undefined,
): SyncHealth {
  if (phase === "buffering") return { kind: "loading" };
  if (offset == null || !Number.isFinite(offset) || Math.abs(offset) < IN_SYNC_S)
    return { kind: "in-sync" };
  return {
    kind: offset < 0 ? "behind" : "ahead",
    seconds: Math.max(1, Math.round(Math.abs(offset))),
  };
}

/** Loading, or so far off that the room should notice. */
export function needsAttention(health: SyncHealth): boolean {
  return health.kind === "loading" || (health.kind !== "in-sync" && health.seconds >= FAR_OFFSET_S);
}
