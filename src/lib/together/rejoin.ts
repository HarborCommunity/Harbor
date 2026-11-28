import type { SyncState } from "./protocol";

/**
 * The room this app was in, kept on disk so a crash or restart can offer to
 * rejoin it. The relay keeps the room's timeline and host; only this link back
 * to it lives in the app.
 */
export type SavedRoom = {
  relayUrl: string;
  room: string;
  at: number;
  media: {
    id: string;
    type: "movie" | "series";
    name: string;
    poster?: string;
    episode?: { season: number; episode: number; name?: string };
  } | null;
};

const KEY = "harbor.together.lastRoom";
/** A restart later than this starts fresh instead of offering to rejoin. */
export const REJOIN_WINDOW_MS = 15 * 60_000;

export function saveRoom(relayUrl: string, room: string, state: SyncState | null): void {
  const media =
    state?.mediaId != null
      ? {
          id: state.mediaId,
          type: state.episode ? ("series" as const) : ("movie" as const),
          name: state.mediaTitle ?? "Watch Together",
          poster: state.posterUrl ?? undefined,
          episode: state.episode
            ? {
                season: state.episode.season,
                episode: state.episode.episode,
                name: state.episode.name,
              }
            : undefined,
        }
      : null;
  const saved: SavedRoom = { relayUrl, room, at: Date.now(), media };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable: nothing to rejoin later */
  }
}

export function clearSavedRoom(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The room saved by the last session, if it is recent and on the same relay. */
export function loadRecentRoom(relayUrl: string, now = Date.now()): SavedRoom | null {
  let saved: SavedRoom;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    saved = JSON.parse(raw) as SavedRoom;
  } catch {
    return null;
  }
  if (!saved || typeof saved.room !== "string" || typeof saved.at !== "number") return null;
  if (saved.relayUrl !== relayUrl || now - saved.at > REJOIN_WINDOW_MS) return null;
  return saved;
}
