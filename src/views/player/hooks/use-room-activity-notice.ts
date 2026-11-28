import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/together/protocol";
import type { RoomActivityNoticeInfo } from "../room-activity-notice";
import type { RoomActivity } from "./use-room-host-sync";

/** Long enough to read a short line; the next change replaces it sooner. */
const NOTICE_MS = 3000;

/**
 * The passing line under the sync pill: who just played, paused or skipped,
 * whether the host locked playback, and why a locked guest's press did nothing.
 */
export function useRoomActivityNotice(params: {
  inRoom: boolean;
  isHost: boolean;
  hasStarted: boolean;
  participants: Participant[];
  hostClientId: string | null;
  /** Null while the room's state names no media (the host is leaving): not a lock change. */
  hostOnly: boolean | null;
  activity: RoomActivity | null;
}): { notice: RoomActivityNoticeInfo | null; showLockedOut: () => void } {
  const { inRoom, isHost, hasStarted, participants, hostClientId, hostOnly, activity } = params;
  const [notice, setNotice] = useState<RoomActivityNoticeInfo | null>(null);
  const timerRef = useRef<number | null>(null);
  const nameOfRef = useRef<(id: string | null) => string>(() => "");
  nameOfRef.current = (id) => participants.find((p) => p.id === id)?.name ?? "Host";

  const show = useCallback((next: RoomActivityNoticeInfo) => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    setNotice(next);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!activity || !inRoom) return;
    show({
      kind: "playback",
      name: nameOfRef.current(activity.by),
      action: activity.action,
      positionSeconds: activity.positionSeconds,
    });
  }, [activity, inRoom, show]);

  // Guests learn about the lock when it changes, and once when they start in a locked room.
  const lockSeenRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!inRoom || isHost || !hasStarted) {
      lockSeenRef.current = null;
      return;
    }
    if (hostOnly === null) return;
    const seen = lockSeenRef.current;
    lockSeenRef.current = hostOnly;
    if (seen === hostOnly || (seen === null && !hostOnly)) return;
    show({ kind: "lock", name: nameOfRef.current(hostClientId), locked: hostOnly });
  }, [inRoom, isHost, hasStarted, hostOnly, hostClientId, show]);

  const showLockedOut = useCallback(
    () => show({ kind: "locked-out", name: nameOfRef.current(hostClientId) }),
    [hostClientId, show],
  );

  return { notice: inRoom ? notice : null, showLockedOut };
}
