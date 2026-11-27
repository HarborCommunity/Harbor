import type { SyncState } from "./protocol";

/**
 * Who the pause badge should mark: the person whose pause the host announced.
 * A pause nobody asked for (the room waiting for someone, an older host that
 * names no cause) marks no one rather than blaming the host.
 */
export function whoPaused(state: SyncState | null): string | null {
  if (!state || state.playing || state.buffering) return null;
  return state.cause?.action === "pause" ? state.cause.by : null;
}
