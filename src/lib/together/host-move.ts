/**
 * A host who plays the next title from the end screen keeps the room (it does
 * not send host-leaving) while the picker finds a stream. If that never leads
 * to a player (Back from the picker, no streams), the room still has to be told.
 */
export type HostMove = "idle" | "armed" | "picking";
export type HostMoveStep = { state: HostMove; teardown: boolean };

/** How long an armed move may wait for the picker to appear before it counts as abandoned. */
export const HOST_MOVE_ARM_MS = 10_000;

export function nextHostMove(
  state: HostMove,
  view: { picker: unknown; player: unknown },
  armedForMs = 0,
): HostMoveStep {
  if (state === "idle") return { state, teardown: false };
  if (view.player) return { state: "idle", teardown: false };
  if (view.picker) return { state: "picking", teardown: false };
  // Between closing the player and opening the picker neither is up for a moment.
  if (state === "armed" && armedForMs < HOST_MOVE_ARM_MS) return { state, teardown: false };
  return { state: "idle", teardown: true };
}

let current: HostMove = "idle";
let armedAt = 0;
const listeners = new Set<() => void>();

export function getHostMove(): HostMove {
  return current;
}
export function hostMoveArmedFor(now = Date.now()): number {
  return now - armedAt;
}
export function setHostMove(next: HostMove): void {
  if (next === "armed") armedAt = Date.now();
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}
export function subscribeHostMove(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
