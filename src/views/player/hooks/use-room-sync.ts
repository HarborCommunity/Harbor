import { useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import { getPlaybackBuffered, getPlaybackPosition } from "@/lib/player/playback-clock";
import type { PartialSyncState } from "@/lib/together/provider";
import type { RoomSnapshot } from "@/lib/together/client";
import {
  RELAY_SYNC_STATUS_VERSION,
  type ParticipantSyncPhase,
  type RoomCommand,
  type SourceDescriptor,
  type SyncState,
} from "@/lib/together/protocol";
import {
  STALL_MAX_MOVE_S,
  anchorFromState,
  decideCorrection,
  expectedPosition,
  isHostStalled,
  safeRate,
  type HostSample,
  type TimelineAnchor,
} from "@/lib/together/timeline";
import type { PlayerSrc } from "@/lib/view";
import {
  SYNC_DRIFT_TOLERANCE_S,
  SYNC_MAX_AGE_S,
  SYNC_PLAY_LOOKAHEAD_S,
  SYNC_SEEK_JUMP_S,
  SYNC_SUPPRESS_MS,
} from "../player-utils";
import { useRoomHostSync, type DropPolicy } from "./use-room-host-sync";

type ForeignNotice = { title: string | null; from: string };

/** What the guest shows while the shared timeline holds it back. */
export type RoomSyncNotice = { kind: "host-buffering" } | { kind: "countdown"; at: number };

/** How often a guest compares its position with the shared timeline. */
const GUEST_CORRECTION_TICK_MS = 250;
/** A paused guest snaps to the host's paused frame when further off than this. */
const PAUSE_SNAP_S = 0.1;
/** A resuming guest seeks first only when further off than this; nudging handles the rest. */
const RESUME_SEEK_S = 1;
/** After a corrective seek the playback clock needs time to settle before the next decision. */
const SEEK_SETTLE_MS = 1500;
/** A guest reports buffering to the room only after waiting this long. */
const BUFFERING_REPORT_MS = 1000;
/** A guest that reported buffering is ready again once this much is buffered. */
const READY_BUFFER_S = 2;

function syncTarget(state: SyncState, duration: number): number {
  const age = Math.min(SYNC_MAX_AGE_S, Math.max(0, (Date.now() - state.updatedAt) / 1000));
  // Age and lookahead are wall-clock seconds; project them at the host's rate.
  const target =
    state.positionSeconds +
    (state.playing ? (age + SYNC_PLAY_LOOKAHEAD_S) * safeRate(state.speed) : 0);
  return duration > 0 ? Math.min(target, Math.max(0, duration - 0.25)) : target;
}

/** Where to seek so playback lands on the timeline once the seek has taken effect. */
function seekTarget(anchor: TimelineAnchor, now: number, duration: number): number {
  const ahead = anchor.playing ? SYNC_PLAY_LOOKAHEAD_S * anchor.rate : 0;
  const target = expectedPosition(anchor, now) + ahead;
  return duration > 0 ? Math.min(target, Math.max(0, duration - 0.25)) : target;
}

/** The host scheduled the start for a moment that has not come yet. */
function isScheduled(state: SyncState, now: number): boolean {
  return typeof state.playAt === "number" && state.playAt > now + 50;
}

function isDifferentMedia(state: SyncState, src: PlayerSrc): boolean {
  if (!state.mediaId) return false;
  if (state.mediaId !== src.meta.id) return true;
  const se = state.episode;
  const le = src.episode;
  if (!!se !== !!le) return true;
  if (se && le && (se.season !== le.season || se.episode !== le.episode)) return true;
  return false;
}

export function useRoomSync(params: {
  inRoom: boolean;
  isHost: boolean;
  hasStarted: boolean;
  setHasStarted: (v: boolean) => void;
  selfFrameReadyRef: RefObject<boolean>;
  roomSnapshot: RoomSnapshot;
  clientId: string;
  src: PlayerSrc;
  snap: PlayerSnapshot;
  bridgeRef: RefObject<PlayerBridge | null>;
  hostSourceRef: RefObject<SourceDescriptor | null>;
  guestPickRef: RefObject<boolean>;
  publishState: (state: PartialSyncState) => void;
  onIncomingState: (cb: (state: SyncState) => void) => () => void;
  onIncomingCommand: (cb: (from: string, command: RoomCommand) => void) => () => void;
  markReady: (ready: boolean) => void;
  sendStatus?: (phase: ParticipantSyncPhase) => void;
  claimHost?: (fresh: boolean) => void;
  dropPolicy?: DropPolicy;
  suppressOutgoingFor: (ms: number) => void;
  setForeignNotice: (n: ForeignNotice | null) => void;
  cast?: {
    activeRef: RefObject<boolean>;
    play: () => Promise<void> | void;
    pause: () => Promise<void> | void;
    seek: (sec: number) => Promise<void> | void;
    getPosition: () => number;
    isPlaying: () => boolean;
  };
}) {
  const {
    inRoom,
    isHost,
    hasStarted,
    setHasStarted,
    selfFrameReadyRef,
    roomSnapshot,
    clientId,
    src,
    snap,
    bridgeRef,
    hostSourceRef,
    guestPickRef,
    publishState,
    onIncomingState,
    onIncomingCommand,
    markReady,
    sendStatus,
    claimHost,
    dropPolicy,
    suppressOutgoingFor,
    setForeignNotice,
    cast,
  } = params;

  const skipDroppedRef = useRef(false);
  const { startTogether, waitingFor, skipWaiting, countdownAt } = useRoomHostSync({
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
    publishState,
    onIncomingCommand,
    dropPolicy,
    skipDroppedRef,
    cast,
  });

  const inRoomRef = useRef(inRoom);
  inRoomRef.current = inRoom;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const roomStartedRef = useRef(roomSnapshot.started);
  roomStartedRef.current = roomSnapshot.started;
  const hostAwayRef = useRef(roomSnapshot.hostAway);
  hostAwayRef.current = roomSnapshot.hostAway;
  const syncCatchUpRef = useRef(false);
  const lastAppliedStateAtRef = useRef(0);
  const anchorRef = useRef<TimelineAnchor | null>(null);
  const stallSampleRef = useRef<HostSample | null>(null);
  const lastSeekAtRef = useRef(0);
  const factorRef = useRef(1);
  const scheduledPlayRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<RoomSyncNotice | null>(null);
  const noticeRef = useRef<RoomSyncNotice | null>(null);
  const mediaKey = `${src.meta.id}|${src.episode?.season ?? ""}|${src.episode?.episode ?? ""}`;

  const statusRef = useRef(snap.status);
  statusRef.current = snap.status;
  const bufferingRef = useRef(snap.buffering);
  bufferingRef.current = snap.buffering;
  const durationRef = useRef(snap.durationSec);
  durationRef.current = snap.durationSec;
  const rateRef = useRef(snap.rate);
  rateRef.current = snap.rate;
  const initialSyncDoneRef = useRef(false);

  const showNotice = (next: RoomSyncNotice | null) => {
    const cur = noticeRef.current;
    if (cur === next) return;
    if (cur && next && cur.kind === next.kind) {
      if (cur.kind === "host-buffering") return;
      if (next.kind === "countdown" && cur.kind === "countdown" && cur.at === next.at) return;
    }
    noticeRef.current = next;
    setNotice(next);
  };

  const setSyncFactor = (factor: number) => {
    if (Math.abs(factor - factorRef.current) < 0.002) return;
    factorRef.current = factor;
    bridgeRef.current?.setSyncRateFactor?.(factor);
  };

  const cancelScheduledPlay = () => {
    if (scheduledPlayRef.current != null) window.clearTimeout(scheduledPlayRef.current);
    scheduledPlayRef.current = null;
  };

  /** Hold at the anchor's position and start exactly at its scheduled instant. */
  const schedulePlay = (anchor: TimelineAnchor, b: PlayerBridge) => {
    cancelScheduledPlay();
    setSyncFactor(1);
    if (statusRef.current === "playing") b.pause("room");
    if (Math.abs(getPlaybackPosition() - anchor.positionSeconds) > PAUSE_SNAP_S)
      b.seek(anchor.positionSeconds);
    showNotice({ kind: "countdown", at: anchor.startedAt });
    scheduledPlayRef.current = window.setTimeout(
      () => {
        scheduledPlayRef.current = null;
        showNotice(null);
        bridgeRef.current?.play({ reason: "room" }).catch(() => {});
      },
      Math.max(0, anchor.startedAt - Date.now()),
    );
  };

  /** Nudge the speed for small gaps; jump for large ones. */
  const correct = (anchor: TimelineAnchor, b: PlayerBridge) => {
    const now = Date.now();
    if (bufferingRef.current || now - lastSeekAtRef.current < SEEK_SETTLE_MS) {
      setSyncFactor(1);
      return;
    }
    const gapS = expectedPosition(anchor, now, durationRef.current) - getPlaybackPosition();
    const decision = decideCorrection({
      gapS,
      nudging: factorRef.current !== 1,
      canNudge: typeof b.setSyncRateFactor === "function",
    });
    if (decision.kind === "nudge") {
      setSyncFactor(decision.factor);
      return;
    }
    setSyncFactor(1);
    if (decision.kind === "seek") {
      b.seek(seekTarget(anchor, now, durationRef.current));
      lastSeekAtRef.current = now;
      syncCatchUpRef.current = true;
    }
  };

  useEffect(() => {
    syncCatchUpRef.current = false;
    lastAppliedStateAtRef.current = 0;
    anchorRef.current = null;
    stallSampleRef.current = null;
    lastSeekAtRef.current = 0;
    cancelScheduledPlay();
    setSyncFactor(1);
    showNotice(null);
  }, [src.url, mediaKey, inRoom]);
  useEffect(
    () => () => {
      cancelScheduledPlay();
      bridgeRef.current?.setSyncRateFactor?.(1);
    },
    [],
  );

  useEffect(() => {
    if (!inRoom) return;
    return onIncomingState((state) => {
      if (state.updatedBy === clientId) return;
      if (isHostRef.current) return;
      if (cast?.activeRef.current) return;
      const b = bridgeRef.current;
      if (!b) return;
      if (isDifferentMedia(state, src)) {
        setForeignNotice({ title: state.mediaTitle, from: state.updatedBy });
        return;
      }
      if (!state.mediaId) return;
      // Before the start the lobby owns the guest's player ("Play without sync" included).
      if (!roomStartedRef.current) return;
      if (state.updatedAt < lastAppliedStateAtRef.current) return;
      lastAppliedStateAtRef.current = state.updatedAt;
      const now = Date.now();

      // Hosts that predate buffering reports repeat a frozen "playing"
      // position while they wait for data; treat that as stopped.
      let stalled = false;
      if (typeof state.buffering !== "boolean") {
        const sample = { positionSeconds: state.positionSeconds, at: now, playing: state.playing };
        const first = stallSampleRef.current;
        stalled = isHostStalled(first, sample);
        if (
          !first ||
          first.playing !== sample.playing ||
          Math.abs(sample.positionSeconds - first.positionSeconds) >= STALL_MAX_MOVE_S
        )
          stallSampleRef.current = sample;
      } else stallSampleRef.current = null;

      const anchor = anchorFromState(state, stalled);
      anchorRef.current = anchor;
      const hostRate = safeRate(state.speed);
      if (Math.abs(hostRate - rateRef.current) > 0.01) b.setRate(hostRate);
      if (anchor.playing && isScheduled(state, now)) {
        schedulePlay(anchor, b);
        return;
      }
      cancelScheduledPlay();
      // Current hosts say so (buffering, not playing); older ones keep "playing" but stall.
      const hostBuffering = state.buffering === true || (state.playing && !anchor.playing);
      showNotice(hostBuffering ? { kind: "host-buffering" } : null);

      const livePos = getPlaybackPosition();
      const playing = statusRef.current === "playing";
      if (syncCatchUpRef.current) {
        const drift = Math.abs(livePos - seekTarget(anchor, now, durationRef.current));
        if (drift < SYNC_SEEK_JUMP_S) {
          const buffered = getPlaybackBuffered();
          const nearEof =
            durationRef.current > 0 && livePos + buffered >= durationRef.current - 0.5;
          if (!playing || (buffered < 2.0 && !nearEof)) {
            if (anchor.playing !== playing) {
              if (anchor.playing && !playing) b.play({ reason: "room" }).catch(() => {});
              if (!anchor.playing && playing) b.pause("room");
            }
            return;
          }
        }
        syncCatchUpRef.current = false;
      }

      if (!anchor.playing) {
        // Everyone stops on the frame where the host stopped (as SharePlay does);
        // the jump happens while paused, so nothing is shown twice.
        setSyncFactor(1);
        if (playing) b.pause("room");
        const target = expectedPosition(anchor, now, durationRef.current);
        if (Math.abs(livePos - target) > PAUSE_SNAP_S) b.seek(target);
        return;
      }
      if (!playing) {
        if (
          Math.abs(expectedPosition(anchor, now, durationRef.current) - livePos) > RESUME_SEEK_S
        ) {
          b.seek(seekTarget(anchor, now, durationRef.current));
          lastSeekAtRef.current = now;
        }
        b.play({ reason: "room" }).catch(() => {});
        return;
      }
      correct(anchor, b);
    });
  }, [inRoom, onIncomingState, clientId, mediaKey, suppressOutgoingFor, cast]);

  // Between host states the guest keeps closing small gaps on its own.
  useEffect(() => {
    if (!inRoom || isHost || !hasStarted) return;
    const id = window.setInterval(() => {
      if (cast?.activeRef.current) return;
      const anchor = anchorRef.current;
      const b = bridgeRef.current;
      if (!anchor || !b || scheduledPlayRef.current != null) return;
      // With the host gone the last anchor goes stale; never chase it.
      if (hostAwayRef.current || !anchor.playing || statusRef.current !== "playing") {
        setSyncFactor(1);
        return;
      }
      if (syncCatchUpRef.current) {
        const live = getPlaybackPosition();
        const buffered = getPlaybackBuffered();
        const nearEof = durationRef.current > 0 && live + buffered >= durationRef.current - 0.5;
        if (buffered < 2.0 && !nearEof) return;
        syncCatchUpRef.current = false;
      }
      correct(anchor, b);
    }, GUEST_CORRECTION_TICK_MS);
    return () => {
      window.clearInterval(id);
      setSyncFactor(1);
    };
  }, [inRoom, isHost, hasStarted, mediaKey, cast]);

  // The host dropped and asked the room to wait for it: hold on the current frame.
  useEffect(() => {
    if (!inRoom || isHost || !hasStarted || !roomSnapshot.hostAway) return;
    if (roomSnapshot.syncState?.waitOnDrop !== true) return;
    if (statusRef.current === "playing") bridgeRef.current?.pause("room-hold");
  }, [inRoom, isHost, hasStarted, roomSnapshot.hostAway]);

  /** A guest's "Keep watching" while the host is away: take over and carry on. */
  const keepWatching = () => {
    skipDroppedRef.current = true;
    claimHost?.(false);
    bridgeRef.current?.play({ reason: "room-hold" }).catch(() => {});
  };

  // Tell the room when this guest is stuck buffering, so the host can wait (relay v12+).
  const statusSupported = (roomSnapshot.relayVersion ?? 0) >= RELAY_SYNC_STATUS_VERSION;
  useEffect(() => {
    if (!inRoom || isHost || !hasStarted || !statusSupported || !sendStatus) return;
    let sent: ParticipantSyncPhase | null = null;
    let bufferingSince: number | null = null;
    const tick = () => {
      if (cast?.activeRef.current) return;
      const now = Date.now();
      let next = sent;
      if (bufferingRef.current && statusRef.current === "playing") {
        bufferingSince ??= now;
        if (now - bufferingSince >= BUFFERING_REPORT_MS) next = "buffering";
      } else {
        bufferingSince = null;
        if (sent === "buffering") {
          const live = getPlaybackPosition();
          const buffered = getPlaybackBuffered();
          const nearEof = durationRef.current > 0 && live + buffered >= durationRef.current - 0.5;
          if (buffered >= READY_BUFFER_S || nearEof) next = "ready";
        }
      }
      if (next && next !== sent) {
        sent = next;
        sendStatus(next);
      }
    };
    const id = window.setInterval(tick, GUEST_CORRECTION_TICK_MS);
    return () => {
      window.clearInterval(id);
      if (sent === "buffering") sendStatus("ready");
    };
  }, [inRoom, isHost, hasStarted, statusSupported, sendStatus, mediaKey, cast]);

  useEffect(() => {
    if (!inRoom || !cast) return;
    return onIncomingState((state) => {
      if (state.updatedBy === clientId) return;
      if (!cast.activeRef.current) return;
      if (!state.mediaId) return;
      if (isDifferentMedia(state, src)) {
        setForeignNotice({ title: state.mediaTitle, from: state.updatedBy });
        return;
      }
      if (state.updatedAt < lastAppliedStateAtRef.current) return;
      lastAppliedStateAtRef.current = state.updatedAt;
      const target = syncTarget(state, durationRef.current);
      const playing = cast.isPlaying();
      const drift = Math.abs(cast.getPosition() - target);
      const playStateChanged = state.playing !== playing;
      if (!playStateChanged && drift <= SYNC_DRIFT_TOLERANCE_S) return;
      suppressOutgoingFor(SYNC_SUPPRESS_MS);
      if (drift > SYNC_DRIFT_TOLERANCE_S) void cast.seek(target);
      if (state.playing && !playing) void cast.play();
      if (!state.playing && playing) void cast.pause();
    });
  }, [inRoom, cast, onIncomingState, clientId, mediaKey, suppressOutgoingFor, setForeignNotice]);

  const prevMediaKeyRef = useRef(mediaKey);
  useEffect(() => {
    if (prevMediaKeyRef.current === mediaKey) return;
    prevMediaKeyRef.current = mediaKey;
    if (inRoomRef.current) setHasStarted(false);
  }, [mediaKey, setHasStarted]);

  useEffect(() => {
    selfFrameReadyRef.current = false;
    markReady(false);
  }, [mediaKey, inRoom, markReady, selfFrameReadyRef]);
  useEffect(() => {
    if (!inRoom || selfFrameReadyRef.current) return;
    if (snap.videoWidth > 0 && snap.videoHeight > 0 && snap.durationSec > 0) {
      selfFrameReadyRef.current = true;
      markReady(true);
    }
  }, [inRoom, snap.videoWidth, snap.videoHeight, snap.durationSec, markReady, selfFrameReadyRef]);

  useEffect(() => {
    if (!inRoom || hasStarted || roomSnapshot.started) return;
    const seed = roomSnapshot.syncState;
    const hostId = roomSnapshot.hostClientId;
    if (
      !isHost &&
      seed &&
      !isDifferentMedia(seed, src) &&
      !seed.playing &&
      !!hostId &&
      seed.updatedBy === hostId &&
      Math.abs(getPlaybackPosition() - seed.positionSeconds) > 1.5
    ) {
      bridgeRef.current?.seek(seed.positionSeconds);
    }
    if (snap.status === "playing") bridgeRef.current?.pause("room");
  }, [
    inRoom,
    hasStarted,
    snap.status,
    isHost,
    roomSnapshot.started,
    roomSnapshot.syncState,
    roomSnapshot.hostClientId,
  ]);

  useEffect(() => {
    if (!inRoom || isHost || hasStarted) return;
    if (roomSnapshot.started) setHasStarted(true);
  }, [inRoom, isHost, hasStarted, roomSnapshot.started]);

  useEffect(() => {
    initialSyncDoneRef.current = false;
  }, [mediaKey, inRoom]);
  useEffect(() => {
    if (!inRoom || isHost || !hasStarted || initialSyncDoneRef.current) return;
    const state = roomSnapshot.syncState;
    if (!state?.mediaId || isDifferentMedia(state, src)) return;
    const b = bridgeRef.current;
    if (!b) return;
    initialSyncDoneRef.current = true;
    const now = Date.now();
    const anchor = anchorFromState(state);
    anchorRef.current = anchor;
    lastAppliedStateAtRef.current = Math.max(lastAppliedStateAtRef.current, state.updatedAt);
    suppressOutgoingFor(SYNC_SUPPRESS_MS);
    b.setRate(safeRate(state.speed));
    if (anchor.playing && isScheduled(state, now)) {
      schedulePlay(anchor, b);
      return;
    }
    b.seek(seekTarget(anchor, now, durationRef.current));
    lastSeekAtRef.current = now;
    if (anchor.playing) b.play({ reason: "room" }).catch(() => {});
    else b.pause("room");
  }, [inRoom, isHost, hasStarted, roomSnapshot.syncState, mediaKey, suppressOutgoingFor]);

  return {
    inRoomRef,
    isHostRef,
    initialSyncDoneRef,
    startTogether,
    // The host's own countdown, or the guest's.
    syncNotice:
      isHost && countdownAt != null ? { kind: "countdown" as const, at: countdownAt } : notice,
    waitingFor,
    skipWaiting,
    keepWatching,
  };
}
