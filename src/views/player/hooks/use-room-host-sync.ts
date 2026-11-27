import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import type { PartialSyncState } from "@/lib/together/provider";
import type { RoomSnapshot } from "@/lib/together/client";
import {
  RELAY_SYNC_STATUS_VERSION,
  type PlaybackAction,
  type PlaybackCause,
  type RoomCommand,
  type SourceDescriptor,
} from "@/lib/together/protocol";
import { anchorChange, expectedPosition, type PublishedAnchor } from "@/lib/together/timeline";
import type { PlayerSrc } from "@/lib/view";
import { HOST_HEARTBEAT_MS, SEEK_APPLY_DEBOUNCE_MS } from "../player-utils";

/** How often the host compares live playback with the anchor it published. */
const PUBLISH_TICK_MS = 250;
/** Rapid seeks (held arrow keys) settle for this long before going out once. */
const SEEK_SETTLE_MS = 300;
/** Countdown before a synchronized start, long enough for every viewer to receive it. */
export const START_COUNTDOWN_MS = 1500;
/** Countdown before resuming after the room waited for a buffering guest. */
const RESUME_COUNTDOWN_MS = 600;
/** A guest still buffering after this long no longer holds up the room. */
const GUEST_WAIT_MAX_MS = 15_000;
/** A dropped guest (relay holds them for 2 minutes) plus time to reload the video. */
const DROPPED_WAIT_MAX_MS = 150_000;
/** "Automatic" waits for people who drop only in rooms up to this size. */
const AUTO_WAIT_MAX_ROOM = 3;

export type DropPolicy = "keep-playing" | "auto" | "always";
const CAST_PUBLISH_MS = 1000;
/** mpv can still report "playing" briefly after the room-wait pause. */
const WAIT_PAUSE_SETTLE_MS = 1500;
/** A requested play, pause or seek that has not shown up in playback by then caused nothing. */
const CAUSE_MAX_AGE_MS = 3000;

/** Someone in the room played, paused or seeked. */
export type RoomActivity = {
  by: string;
  action: PlaybackAction;
  positionSeconds?: number;
  at: number;
};

type CastSync = {
  activeRef: RefObject<boolean>;
  play: () => Promise<void> | void;
  pause: () => Promise<void> | void;
  seek: (sec: number) => Promise<void> | void;
  getPosition: () => number;
  isPlaying: () => boolean;
};

/**
 * The host's half of the watch party: it owns the shared timeline. It
 * publishes a new anchor whenever playback changes (play, pause, buffering,
 * speed, or a seek from any source) plus a heartbeat, applies guest requests,
 * and, on relays that report guest status, pauses the room while a guest
 * buffers and resumes everyone together.
 */
export function useRoomHostSync(params: {
  inRoom: boolean;
  isHost: boolean;
  hasStarted: boolean;
  roomSnapshot: RoomSnapshot;
  clientId: string;
  src: PlayerSrc;
  snap: PlayerSnapshot;
  bridgeRef: RefObject<PlayerBridge | null>;
  hostSourceRef: RefObject<SourceDescriptor | null>;
  guestPickRef: RefObject<boolean>;
  /** Only the host controls playback: guests' commands are ignored. */
  hostOnlyRef?: RefObject<boolean>;
  publishState: (state: PartialSyncState) => void;
  onIncomingCommand: (cb: (from: string, command: RoomCommand) => void) => () => void;
  /** A guest's command was applied. */
  onActivity?: (activity: RoomActivity) => void;
  dropPolicy?: DropPolicy;
  /** Set by a guest who chose "Keep watching" and took over: don't wait for who dropped. */
  skipDroppedRef?: RefObject<boolean>;
  cast?: CastSync;
}): {
  startTogether: () => void;
  waitingFor: string[];
  skipWaiting: () => void;
  /** When the host's own scheduled start happens, so the host sees the countdown too. */
  countdownAt: number | null;
  /** The host's own play, pause or seek, so guests see who made it. */
  noteLocalAction: (action: PlaybackAction) => void;
} {
  const {
    inRoom,
    isHost,
    hasStarted,
    roomSnapshot,
    clientId,
    src,
    snap,
    bridgeRef,
    hostSourceRef,
    guestPickRef,
    hostOnlyRef,
    publishState,
    onIncomingCommand,
    onActivity,
    dropPolicy = "keep-playing",
    skipDroppedRef,
    cast,
  } = params;

  const inRoomRef = useRef(inRoom);
  inRoomRef.current = inRoom;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const statusRef = useRef(snap.status);
  statusRef.current = snap.status;
  const bufferingRef = useRef(snap.buffering);
  bufferingRef.current = snap.buffering;
  const durationRef = useRef(snap.durationSec);
  durationRef.current = snap.durationSec;
  const rateRef = useRef(snap.rate);
  rateRef.current = snap.rate;
  const srcRef = useRef(src);
  srcRef.current = src;
  // Counted with anyone already away, so the room size is the one before the drop.
  const waitOnDropRef = useRef(false);
  // Only relay v12 can hold a dropped person, so older relays always keep playing.
  waitOnDropRef.current =
    (roomSnapshot.relayVersion ?? 0) >= RELAY_SYNC_STATUS_VERSION &&
    (dropPolicy === "always" ||
      (dropPolicy === "auto" && roomSnapshot.participants.length <= AUTO_WAIT_MAX_ROOM));
  const mediaKey = `${src.meta.id}|${src.episode?.season ?? ""}|${src.episode?.episode ?? ""}`;

  const lastPublishedRef = useRef<PublishedAnchor | null>(null);
  const lastPublishedAtRef = useRef(0);
  const seekSettleRef = useRef<{ since: number; probe: PublishedAnchor } | null>(null);
  const pendingPlayAtRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const [countdownAt, setCountdownAt] = useState<number | null>(null);

  const cancelScheduledPlay = () => {
    if (playTimerRef.current != null) window.clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    if (pendingPlayAtRef.current != null) setCountdownAt(null);
    pendingPlayAtRef.current = null;
  };

  const baseState = () => {
    const s = srcRef.current;
    return {
      mediaId: s.meta.id,
      mediaTitle: s.meta.name ?? null,
      episode: s.episode
        ? { season: s.episode.season, episode: s.episode.episode, name: s.episode.name }
        : null,
      posterUrl: s.meta.poster ?? null,
      source: hostSourceRef.current ?? undefined,
      guestPick: guestPickRef.current || undefined,
      waitOnDrop: waitOnDropRef.current || undefined,
      hostOnly: hostOnlyRef?.current || undefined,
    };
  };

  // Who asked for the change the next published anchor shows: the host itself,
  // or the guest whose command it applied.
  const pendingCauseRef = useRef<{ by: string; action: PlaybackAction; at: number } | null>(null);
  const causeIdRef = useRef(Date.now());
  const noteAction = (by: string, action: PlaybackAction) => {
    pendingCauseRef.current = { by, action, at: Date.now() };
  };
  const takeCause = (actions: PlaybackAction[], now: number): PlaybackCause | undefined => {
    const pending = pendingCauseRef.current;
    if (!pending || now - pending.at > CAUSE_MAX_AGE_MS) {
      pendingCauseRef.current = null;
      return undefined;
    }
    if (!actions.includes(pending.action)) return undefined;
    pendingCauseRef.current = null;
    causeIdRef.current += 1;
    return { by: pending.by, action: pending.action, id: causeIdRef.current };
  };

  // The latest cause rides along with heartbeats, so a late look at the room
  // still shows who paused; the next change replaces it.
  const currentCauseRef = useRef<PlaybackCause | undefined>(undefined);
  const publishAnchor = (
    anchor: PublishedAnchor,
    now: number,
    playAt?: number,
    cause?: PlaybackCause | "keep",
  ) => {
    if (cause !== "keep") currentCauseRef.current = cause;
    const stickyCause = currentCauseRef.current;
    lastPublishedRef.current = anchor;
    lastPublishedAtRef.current = now;
    publishState({
      ...baseState(),
      positionSeconds: anchor.positionSeconds,
      playing: anchor.playing,
      buffering: anchor.buffering,
      speed: anchor.rate,
      sampledAt: now,
      ...(playAt != null && { playAt }),
      ...(stickyCause && { cause: stickyCause }),
    });
  };

  const liveAnchor = (now: number): PublishedAnchor | null => {
    const status = statusRef.current;
    if (status !== "playing" && status !== "paused") return null;
    if (durationRef.current <= 0) return null;
    const pos = getPlaybackPosition();
    if (pos <= 0) return null;
    // mpv keeps reporting "playing" while it waits for data; the timeline is stopped.
    const buffering = status === "playing" && bufferingRef.current;
    return {
      positionSeconds: pos,
      startedAt: now,
      rate: rateRef.current,
      playing: status === "playing" && !buffering,
      buffering,
    };
  };

  const scheduleSyncedPlay = (positionSeconds: number, delayMs: number) => {
    const b = bridgeRef.current;
    if (!b) return;
    cancelScheduledPlay();
    const now = Date.now();
    const playAt = now + delayMs;
    pendingPlayAtRef.current = playAt;
    setCountdownAt(playAt);
    seekSettleRef.current = null;
    publishAnchor(
      {
        positionSeconds,
        startedAt: playAt,
        rate: rateRef.current,
        playing: true,
        buffering: false,
      },
      now,
      playAt,
    );
    playTimerRef.current = window.setTimeout(() => {
      playTimerRef.current = null;
      pendingPlayAtRef.current = null;
      setCountdownAt(null);
      bridgeRef.current?.play({ reason: "together" }).catch(() => {});
    }, delayMs);
  };

  const tickRef = useRef<() => void>(() => {});
  tickRef.current = () => {
    if (!inRoomRef.current || !isHostRef.current) return;
    if (cast?.activeRef.current) return;
    const now = Date.now();
    // During a synchronized-start countdown the published anchor already says
    // where playback will be; the paused player must not overwrite it.
    if (pendingPlayAtRef.current != null && now < pendingPlayAtRef.current) return;
    const current = liveAnchor(now);
    if (!current) return;
    const change = anchorChange(lastPublishedRef.current, current, now);
    if (change === "state") {
      seekSettleRef.current = null;
      publishAnchor(current, now, undefined, takeCause(["play", "pause"], now));
      return;
    }
    if (change === "position") {
      const settle = seekSettleRef.current;
      if (!settle || Math.abs(current.positionSeconds - expectedPosition(settle.probe, now)) > 0.5)
        seekSettleRef.current = { since: now, probe: current };
      else seekSettleRef.current = { since: settle.since, probe: current };
      if (now - seekSettleRef.current.since >= SEEK_SETTLE_MS) {
        seekSettleRef.current = null;
        publishAnchor(current, now, undefined, takeCause(["seek"], now));
      }
      return;
    }
    seekSettleRef.current = null;
    if (now - lastPublishedAtRef.current >= HOST_HEARTBEAT_MS)
      publishAnchor(current, now, undefined, "keep");
  };

  useEffect(() => {
    lastPublishedRef.current = null;
    currentCauseRef.current = undefined;
    seekSettleRef.current = null;
    const wasCountingDown = pendingPlayAtRef.current != null;
    cancelScheduledPlay();
    // A countdown cut short because the last guest left still starts this player.
    if (wasCountingDown && !inRoom) bridgeRef.current?.play({ reason: "together" }).catch(() => {});
  }, [mediaKey, inRoom, isHost]);
  useEffect(() => cancelScheduledPlay, []);

  useEffect(() => {
    if (!inRoom || !isHost || !hasStarted) return;
    if (cast?.activeRef.current) return;
    tickRef.current();
    const id = window.setInterval(() => tickRef.current(), PUBLISH_TICK_MS);
    return () => window.clearInterval(id);
  }, [inRoom, isHost, hasStarted, mediaKey, cast]);

  // Play, pause, buffering and speed changes go out immediately, not on the next tick.
  useEffect(() => {
    if (!inRoom || !isHost || !hasStarted) return;
    tickRef.current();
  }, [inRoom, isHost, hasStarted, snap.status, snap.buffering, snap.rate]);

  const startTogether = useCallback(() => {
    scheduleSyncedPlay(Math.max(0, getPlaybackPosition()), START_COUNTDOWN_MS);
  }, []);

  const noteLocalAction = useCallback(
    (action: PlaybackAction) => noteAction(clientId, action),
    [clientId],
  );

  // Guest requests (play, pause, seek) arrive as commands; the host applies them.
  const seekSeqRef = useRef<Map<string, number>>(new Map());
  const pendingSeekRef = useRef<number | null>(null);
  const seekFromRef = useRef<string | null>(null);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const seekApplyTimerRef = useRef<number | null>(null);
  const clearPendingSeek = () => {
    if (seekApplyTimerRef.current != null) {
      window.clearTimeout(seekApplyTimerRef.current);
      seekApplyTimerRef.current = null;
    }
    pendingSeekRef.current = null;
  };
  useEffect(() => {
    if (inRoom && isHost) return;
    clearPendingSeek();
  }, [inRoom, isHost]);
  useEffect(() => clearPendingSeek, []);
  useEffect(() => {
    if (!inRoom || !isHost) return;
    const applySeek = (pos: number) => {
      const b = bridgeRef.current;
      if (!b || durationRef.current <= 0) return;
      b.seek(Math.max(0, Math.min(pos, durationRef.current - 1)));
    };
    const applied = (from: string, action: PlaybackAction, positionSeconds?: number) => {
      noteAction(from, action);
      onActivityRef.current?.({ by: from, action, positionSeconds, at: Date.now() });
    };
    const fireTimer = () => {
      seekApplyTimerRef.current = null;
      const pos = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pos == null) return;
      if (!inRoomRef.current || !isHostRef.current) return;
      applySeek(pos);
      applied(seekFromRef.current ?? "", "seek", pos);
    };
    const flushPending = () => {
      if (seekApplyTimerRef.current != null) {
        window.clearTimeout(seekApplyTimerRef.current);
        seekApplyTimerRef.current = null;
      }
      const pos = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pos == null) return;
      applySeek(pos);
      applied(seekFromRef.current ?? "", "seek", pos);
    };
    const off = onIncomingCommand((from, command) => {
      if (cast?.activeRef.current) return;
      // The host locked playback; guests' players already refuse to send these.
      if (hostOnlyRef?.current) return;
      const b = bridgeRef.current;
      if (!b) return;
      if (command.action === "play") {
        flushPending();
        cancelScheduledPlay();
        b.play({ reason: "room" }).catch(() => {});
        applied(from, "play");
      } else if (command.action === "pause") {
        flushPending();
        cancelScheduledPlay();
        b.pause("room");
        applied(from, "pause");
      } else if (command.action === "seek") {
        if (typeof command.seq === "number") {
          const last = seekSeqRef.current.get(from);
          if (last != null && command.seq <= last) return;
          seekSeqRef.current.set(from, command.seq);
        }
        pendingSeekRef.current = command.positionSeconds;
        seekFromRef.current = from;
        if (seekApplyTimerRef.current != null) window.clearTimeout(seekApplyTimerRef.current);
        seekApplyTimerRef.current = window.setTimeout(fireTimer, SEEK_APPLY_DEBOUNCE_MS);
      }
    });
    return off;
  }, [inRoom, isHost, onIncomingCommand, bridgeRef, cast]);

  // Room-wide wait (relay v12+): for guests stuck buffering, and, when the host
  // chose to, for guests whose connection dropped until they are back and loaded.
  type WaitState = {
    paused: boolean;
    pausedAt: number;
    since: Map<string, number>;
    /** Time already spent waiting for each guest on this title, across stalls. */
    spent: Map<string, number>;
    skipped: Set<string>;
    dropped: Set<string>;
  };
  const freshWait = (): WaitState => ({
    paused: false,
    pausedAt: 0,
    since: new Map(),
    spent: new Map(),
    skipped: new Set(),
    dropped: new Set(),
  });
  const waitRef = useRef<WaitState>(freshWait());
  const [waitingFor, setWaitingFor] = useState<string[]>([]);
  const waitingForRef = useRef<string[]>([]);
  const showWaiting = (ids: string[]) => {
    if (ids.join("|") === waitingForRef.current.join("|")) return;
    waitingForRef.current = ids;
    setWaitingFor(ids);
  };
  const statusesRef = useRef(roomSnapshot.participantStatus);
  statusesRef.current = roomSnapshot.participantStatus;
  const participantsRef = useRef(roomSnapshot.participants);
  participantsRef.current = roomSnapshot.participants;

  const resumeAfterWait = () => {
    const wait = waitRef.current;
    if (!wait.paused) return;
    wait.paused = false;
    showWaiting([]);
    scheduleSyncedPlay(Math.max(0, getPlaybackPosition()), RESUME_COUNTDOWN_MS);
  };

  const waitTickRef = useRef<() => void>(() => {});
  waitTickRef.current = () => {
    const wait = waitRef.current;
    const b = bridgeRef.current;
    if (!b || cast?.activeRef.current) return;
    const now = Date.now();
    const byId = new Map(participantsRef.current.map((p) => [p.id, p]));
    if (skipDroppedRef?.current) {
      skipDroppedRef.current = false;
      for (const p of byId.values())
        if (p.away) {
          wait.since.set(p.id, now);
          wait.skipped.add(p.id);
        }
    }
    const limits = new Map<string, number>();
    for (const [id, phase] of Object.entries(statusesRef.current ?? {})) {
      const p = byId.get(id);
      if (phase === "buffering" && id !== clientId && p && !p.away)
        limits.set(id, GUEST_WAIT_MAX_MS);
    }
    if (waitOnDropRef.current)
      for (const p of byId.values())
        if (p.away && p.id !== clientId) {
          wait.dropped.add(p.id);
          limits.set(p.id, DROPPED_WAIT_MAX_MS);
        }
    for (const id of wait.dropped) {
      const p = byId.get(id);
      if (!p) wait.dropped.delete(id);
      else if (!p.away) {
        // Back in the room: wait until their player has loaded the video.
        if (p.ready) wait.dropped.delete(id);
        else limits.set(id, DROPPED_WAIT_MAX_MS);
      }
    }
    // One wait budget per guest per title: a stall that ends adds to it, so a
    // guest who keeps stalling stops pausing everyone. Once skipped (budget
    // spent, or Keep watching) a guest stays skipped until they leave.
    for (const [id, at] of wait.since)
      if (!limits.has(id)) {
        wait.spent.set(id, (wait.spent.get(id) ?? 0) + (now - at));
        wait.since.delete(id);
      }
    for (const id of [...wait.skipped, ...wait.spent.keys()])
      if (!byId.has(id)) {
        wait.skipped.delete(id);
        wait.spent.delete(id);
      }
    const holding: string[] = [];
    for (const [id, limit] of limits) {
      if (!wait.since.has(id)) wait.since.set(id, now);
      const waited = (wait.spent.get(id) ?? 0) + now - (wait.since.get(id) ?? now);
      if (waited > limit) wait.skipped.add(id);
      if (!wait.skipped.has(id)) holding.push(id);
    }
    if (
      wait.paused &&
      statusRef.current === "playing" &&
      pendingPlayAtRef.current == null &&
      now - wait.pausedAt > WAIT_PAUSE_SETTLE_MS
    ) {
      // The host pressed play during the wait: stop waiting for these guests.
      for (const id of holding) wait.skipped.add(id);
      wait.paused = false;
      showWaiting([]);
      return;
    }
    if (holding.length > 0) {
      if (!wait.paused && statusRef.current === "playing") {
        wait.paused = true;
        wait.pausedAt = now;
        cancelScheduledPlay();
        b.pause("room-wait");
      }
      showWaiting(wait.paused ? holding : []);
      return;
    }
    resumeAfterWait();
  };

  /** "Keep watching": stop waiting for everyone the room is holding for right now. */
  const skipWaiting = useCallback(() => {
    const wait = waitRef.current;
    for (const id of wait.since.keys()) wait.skipped.add(id);
    wait.dropped.clear();
    resumeAfterWait();
  }, []);

  // A new title gives every guest a fresh budget.
  useEffect(() => {
    const wait = waitRef.current;
    wait.since.clear();
    wait.spent.clear();
    wait.skipped.clear();
  }, [mediaKey]);

  const statusSupported = (roomSnapshot.relayVersion ?? 0) >= RELAY_SYNC_STATUS_VERSION;
  useEffect(() => {
    if (!inRoom || !isHost || !hasStarted || !statusSupported) {
      // The room paused this player for a guest; with the room gone, nobody resumes it.
      if (waitRef.current.paused && pendingPlayAtRef.current == null)
        bridgeRef.current?.play({ reason: "room-wait" }).catch(() => {});
      waitRef.current = freshWait();
      showWaiting([]);
      return;
    }
    waitTickRef.current();
    const id = window.setInterval(() => waitTickRef.current(), 1000);
    return () => window.clearInterval(id);
  }, [inRoom, isHost, hasStarted, statusSupported, mediaKey]);
  useEffect(() => {
    if (!inRoom || !isHost || !hasStarted || !statusSupported) return;
    waitTickRef.current();
  }, [
    inRoom,
    isHost,
    hasStarted,
    statusSupported,
    roomSnapshot.participantStatus,
    roomSnapshot.participants,
  ]);

  // While casting, the cast device is the host's clock.
  useEffect(() => {
    if (!inRoom || !isHost || !cast) return;
    const publishCast = () => {
      if (!cast.activeRef.current) return;
      const pos = cast.getPosition();
      const playing = cast.isPlaying();
      if (durationRef.current <= 0) return;
      if (pos <= 0 && playing) return;
      publishState({
        ...baseState(),
        positionSeconds: pos,
        playing,
        sampledAt: Date.now(),
      });
    };
    publishCast();
    const id = window.setInterval(publishCast, CAST_PUBLISH_MS);
    return () => window.clearInterval(id);
  }, [inRoom, isHost, cast, publishState, mediaKey]);

  // Before the start, guests see where the host's paused player sits.
  const lobbySeededRef = useRef(false);
  useEffect(() => {
    lobbySeededRef.current = false;
  }, [mediaKey]);
  useEffect(() => {
    if (!inRoom || !isHost || hasStarted || lobbySeededRef.current) return;
    if (snap.durationSec <= 0) return;
    lobbySeededRef.current = true;
    // A host back from a crash returns to where it left the room, not to its
    // last saved resume point.
    const stored = roomSnapshot.syncState;
    const s = srcRef.current;
    let position = getPlaybackPosition();
    if (
      roomSnapshot.started &&
      stored?.updatedBy === clientId &&
      stored.mediaId === s.meta.id &&
      (stored.episode?.season ?? null) === (s.episode?.season ?? null) &&
      (stored.episode?.episode ?? null) === (s.episode?.episode ?? null) &&
      Math.abs(stored.positionSeconds - position) > 1.5
    ) {
      position = stored.positionSeconds;
      bridgeRef.current?.seek(position);
    }
    publishState({
      ...baseState(),
      positionSeconds: position,
      playing: false,
      buffering: false,
      speed: rateRef.current,
      sampledAt: Date.now(),
    });
  }, [inRoom, isHost, hasStarted, snap.durationSec, publishState, mediaKey]);

  return { startTogether, waitingFor, skipWaiting, countdownAt, noteLocalAction };
}
