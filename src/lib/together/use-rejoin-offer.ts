import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "./client-types";
import { clearSavedRoom, loadRecentRoom, saveRoom, type SavedRoom } from "./rejoin";

/** The saved room's timestamp is refreshed this often while in it (not on every heartbeat). */
export const SAVED_ROOM_REFRESH_MS = 60_000;

/**
 * Remembers the watch party on disk while in it, and after a crash or restart
 * offers to rejoin it once. Leaving on purpose or dismissing the offer forgets it.
 */
export function useRejoinOffer(params: {
  relayUrl: string;
  snapshot: RoomSnapshot;
  pendingInvite: unknown;
  join: (room: string) => void;
}): {
  rejoinOffer: SavedRoom | null;
  acceptRejoin: () => void;
  dismissRejoin: () => void;
} {
  const { relayUrl, snapshot, pendingInvite, join } = params;
  const syncRef = useRef(snapshot.syncState);
  syncRef.current = snapshot.syncState;
  const sync = snapshot.syncState;
  // Only the room and the title matter on disk; position changes every second.
  const mediaKey = sync?.mediaId
    ? `${sync.mediaId}|${sync.episode?.season ?? ""}|${sync.episode?.episode ?? ""}`
    : "";
  const inRoom = snapshot.state === "joined" && !!snapshot.room && !snapshot.listenSessionId;
  useEffect(() => {
    if (!inRoom || !snapshot.room) return;
    const room = snapshot.room;
    const save = () => saveRoom(relayUrl, room, syncRef.current);
    save();
    const id = window.setInterval(save, SAVED_ROOM_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [relayUrl, inRoom, snapshot.room, mediaKey]);

  const [rejoinOffer, setRejoinOffer] = useState<SavedRoom | null>(null);
  const checkedRef = useRef(false);
  useEffect(() => {
    if (checkedRef.current || !relayUrl) return;
    checkedRef.current = true;
    if (pendingInvite) return;
    setRejoinOffer(loadRecentRoom(relayUrl));
  }, [relayUrl, pendingInvite]);
  useEffect(() => {
    if (pendingInvite || snapshot.state === "joined") setRejoinOffer(null);
  }, [pendingInvite, snapshot.state]);

  const offerRef = useRef(rejoinOffer);
  offerRef.current = rejoinOffer;
  const acceptRejoin = useCallback(() => {
    const offer = offerRef.current;
    setRejoinOffer(null);
    if (offer) join(offer.room);
  }, [join]);
  const dismissRejoin = useCallback(() => {
    clearSavedRoom();
    setRejoinOffer(null);
  }, []);
  return { rejoinOffer, acceptRejoin, dismissRejoin };
}
