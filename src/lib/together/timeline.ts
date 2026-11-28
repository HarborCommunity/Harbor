import type { SyncState } from "./protocol";

/**
 * A shared playback timeline: "at local time `startedAt` the video was at
 * `positionSeconds`, moving at `rate` while `playing`". Every viewer derives
 * the expected position from the same anchor instead of chasing positions.
 * All times are local epoch milliseconds (the client converts relay times).
 */
export type TimelineAnchor = {
  positionSeconds: number;
  startedAt: number;
  rate: number;
  playing: boolean;
};

/** Never extrapolate further than this from one anchor. */
export const TIMELINE_MAX_AGE_S = 30;
/** Gap at which a viewer starts nudging its speed. */
export const NUDGE_START_S = 0.15;
/** Gap at which an active nudge stops; lower than the start to avoid flapping. */
export const NUDGE_STOP_S = 0.04;
/** Largest speed change used for nudging (5%). */
export const NUDGE_MAX_FACTOR = 0.05;
/** Beyond this gap a viewer jumps instead of nudging. */
export const SEEK_GAP_S = 3;
/** Players that cannot change speed smoothly jump beyond this gap. */
export const SEEK_GAP_NO_NUDGE_S = 0.5;
/** A host whose playing position stays this still for this long is stalled. */
export const STALL_MIN_MS = 900;
export const STALL_MAX_MOVE_S = 0.25;
/** A host position this far from its published anchor counts as a seek. */
export const ANCHOR_JUMP_S = 0.5;

export function safeRate(rate: number | null | undefined): number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/**
 * Builds the anchor described by a received state. `playAt` delays the start,
 * `sampledAt` (when the host read its position) beats the relay's receive time,
 * and a buffering host is treated as stopped.
 */
export function anchorFromState(state: SyncState, stalled = false): TimelineAnchor {
  const sampled =
    typeof state.sampledAt === "number" && Number.isFinite(state.sampledAt)
      ? state.sampledAt
      : state.updatedAt;
  const playAt =
    typeof state.playAt === "number" && Number.isFinite(state.playAt) ? state.playAt : 0;
  return {
    positionSeconds: state.positionSeconds,
    startedAt: Math.max(sampled, playAt),
    rate: safeRate(state.speed),
    playing: state.playing && state.buffering !== true && !stalled,
  };
}

/** Where the shared timeline says the video is at `now`. */
export function expectedPosition(anchor: TimelineAnchor, now: number, durationSec = 0): number {
  const ageS = Math.min(TIMELINE_MAX_AGE_S, Math.max(0, (now - anchor.startedAt) / 1000));
  const pos = anchor.positionSeconds + (anchor.playing ? ageS * anchor.rate : 0);
  return durationSec > 0 ? Math.min(pos, Math.max(0, durationSec - 0.25)) : pos;
}

export type Correction = { kind: "none" } | { kind: "nudge"; factor: number } | { kind: "seek" };

/**
 * Decides how a following viewer closes `gapS` (expected minus actual; positive
 * means the viewer is behind). Small gaps nudge the speed, large ones jump.
 */
export function decideCorrection(input: {
  gapS: number;
  nudging: boolean;
  canNudge: boolean;
}): Correction {
  const abs = Math.abs(input.gapS);
  if (!input.canNudge) return abs > SEEK_GAP_NO_NUDGE_S ? { kind: "seek" } : { kind: "none" };
  if (abs >= SEEK_GAP_S) return { kind: "seek" };
  if (abs < (input.nudging ? NUDGE_STOP_S : NUDGE_START_S)) return { kind: "none" };
  // Close half the gap per second of playback, capped at 5% speed change.
  const delta = Math.max(-NUDGE_MAX_FACTOR, Math.min(NUDGE_MAX_FACTOR, input.gapS * 0.5));
  return { kind: "nudge", factor: 1 + delta };
}

export type HostSample = { positionSeconds: number; at: number; playing: boolean };

/**
 * Hosts from before buffering was reported keep publishing "playing" with a
 * frozen position while they wait for data. Two playing samples far apart in
 * time with the same position mean the host is stalled.
 */
export function isHostStalled(first: HostSample | null, next: HostSample): boolean {
  if (!first || !first.playing || !next.playing) return false;
  return (
    next.at - first.at >= STALL_MIN_MS &&
    Math.abs(next.positionSeconds - first.positionSeconds) < STALL_MAX_MOVE_S
  );
}

export type PublishedAnchor = TimelineAnchor & { buffering: boolean };

export type AnchorChange = "none" | "state" | "position";

/**
 * Compares the host's live playback with the anchor it last published. Play,
 * pause, buffering and speed changes are "state" changes and go out at once;
 * a position that left the anchor (a seek from any source) is a "position"
 * change and is debounced by the caller.
 */
export function anchorChange(
  last: PublishedAnchor | null,
  current: PublishedAnchor,
  now: number,
): AnchorChange {
  if (!last) return "state";
  if (last.playing !== current.playing || last.buffering !== current.buffering) return "state";
  if (Math.abs(last.rate - current.rate) > 0.001) return "state";
  const drift = Math.abs(current.positionSeconds - expectedPosition(last, now));
  return drift > ANCHOR_JUMP_S ? "position" : "none";
}
