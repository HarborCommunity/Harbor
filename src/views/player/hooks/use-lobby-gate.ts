import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge } from "@/lib/player/bridge";
import type { RoomSnapshot } from "@/lib/together/client";
import { GUEST_ESCAPE_MS, READY_STALE_MS } from "../player-utils";

/** Countdown the host can cancel before an automatic start. */
const AUTO_START_MS = 5000;

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function useLobbyGate(params: {
  inRoom: boolean;
  isHost: boolean;
  hasStarted: boolean;
  setHasStarted: (v: boolean) => void;
  roomSnapshot: RoomSnapshot;
  startRoom: () => void;
  /** Starts the host's playback together with the room (synchronized countdown). */
  startTogether: () => void;
  autoStart: boolean;
  suppressOutgoingFor: (ms: number) => void;
  bridgeRef: RefObject<PlayerBridge | null>;
  initialSyncDoneRef: RefObject<boolean>;
  mediaKey: string;
}): {
  startHost: () => void;
  playWithoutSync: () => void;
  guestEscapeReady: boolean;
  staleIds: Set<string>;
  autoStartAt: number | null;
  cancelAutoStart: () => void;
} {
  const {
    inRoom,
    isHost,
    hasStarted,
    setHasStarted,
    roomSnapshot,
    startRoom,
    startTogether,
    autoStart,
    suppressOutgoingFor,
    bridgeRef,
    initialSyncDoneRef,
    mediaKey,
  } = params;

  const startHost = useCallback(() => {
    setHasStarted(true);
    suppressOutgoingFor(0);
    // The timed start goes out before "started", so guests see it when they leave the lobby.
    startTogether();
    startRoom();
  }, [setHasStarted, startRoom, startTogether, suppressOutgoingFor]);

  const [autoStartAt, setAutoStartAt] = useState<number | null>(null);
  const [autoStartCancelled, setAutoStartCancelled] = useState(false);
  const everyoneReady =
    roomSnapshot.participants.length > 0 && roomSnapshot.participants.every((p) => p.ready);
  // A new title, or switching the setting off and on, arms the countdown again.
  useEffect(() => {
    setAutoStartCancelled(false);
  }, [mediaKey, autoStart]);
  useEffect(() => {
    if (!inRoom || !isHost || hasStarted || !autoStart || autoStartCancelled || !everyoneReady) {
      setAutoStartAt(null);
      return;
    }
    setAutoStartAt(Date.now() + AUTO_START_MS);
    const t = window.setTimeout(() => {
      setAutoStartAt(null);
      startHost();
    }, AUTO_START_MS);
    return () => window.clearTimeout(t);
  }, [inRoom, isHost, hasStarted, autoStart, autoStartCancelled, everyoneReady, startHost]);
  const cancelAutoStart = useCallback(() => setAutoStartCancelled(true), []);

  useEffect(() => {
    if (!inRoom || !isHost || !hasStarted || roomSnapshot.started) return;
    startRoom();
  }, [inRoom, isHost, hasStarted, roomSnapshot.started, startRoom]);

  const playWithoutSync = useCallback(() => {
    initialSyncDoneRef.current = true;
    setHasStarted(true);
    bridgeRef.current?.play({ reason: "together" }).catch(() => {});
  }, [initialSyncDoneRef, setHasStarted, bridgeRef]);

  const [guestEscapeReady, setGuestEscapeReady] = useState(false);
  useEffect(() => {
    if (!inRoom || isHost || hasStarted) {
      setGuestEscapeReady(false);
      return;
    }
    const t = window.setTimeout(() => setGuestEscapeReady(true), GUEST_ESCAPE_MS);
    return () => {
      window.clearTimeout(t);
      setGuestEscapeReady(false);
    };
  }, [inRoom, isHost, hasStarted, mediaKey]);

  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    firstSeenRef.current = new Map();
    setStaleIds(new Set());
  }, [mediaKey]);
  useEffect(() => {
    if (!inRoom || !isHost || hasStarted) {
      setStaleIds((prev) => (prev.size > 0 ? new Set<string>() : prev));
      return;
    }
    const tick = () => {
      const now = Date.now();
      const seen = firstSeenRef.current;
      const ids = new Set(roomSnapshot.participants.map((p) => p.id));
      for (const id of ids) if (!seen.has(id)) seen.set(id, now);
      for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
      const next = new Set<string>();
      for (const p of roomSnapshot.participants) {
        if (!p.ready && now - (seen.get(p.id) ?? now) > READY_STALE_MS) next.add(p.id);
      }
      setStaleIds((prev) => (sameSet(prev, next) ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [inRoom, isHost, hasStarted, roomSnapshot.participants]);

  return { startHost, playWithoutSync, guestEscapeReady, staleIds, autoStartAt, cancelAutoStart };
}
