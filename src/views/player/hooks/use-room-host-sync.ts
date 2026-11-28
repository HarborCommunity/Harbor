import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import type { PartialSyncState } from "@/lib/together/provider";
import type { RoomCommand, SourceDescriptor } from "@/lib/together/protocol";
import { anchorChange, expectedPosition, type PublishedAnchor } from "@/lib/together/timeline";
import type { PlayerSrc } from "@/lib/view";
import { HOST_HEARTBEAT_MS, SEEK_APPLY_DEBOUNCE_MS } from "../player-utils";

/** How often the host compares live playback with the anchor it published. */
const PUBLISH_TICK_MS = 250;
/** Rapid seeks (held arrow keys) settle for this long before going out once. */
const SEEK_SETTLE_MS = 300;
/** Countdown before a synchronized start, long enough for every viewer to receive it. */
export const START_COUNTDOWN_MS = 1500;
const CAST_PUBLISH_MS = 1000;

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
 * speed, or a seek from any source) plus a heartbeat, and applies guest
 * requests.
 */
export function useRoomHostSync(params: {
  inRoom: boolean;
  isHost: boolean;
  hasStarted: boolean;
  src: PlayerSrc;
  snap: PlayerSnapshot;
  bridgeRef: RefObject<PlayerBridge | null>;
  hostSourceRef: RefObject<SourceDescriptor | null>;
  guestPickRef: RefObject<boolean>;
  publishState: (state: PartialSyncState) => void;
  onIncomingCommand: (cb: (from: string, command: RoomCommand) => void) => () => void;
  cast?: CastSync;
}): {
  startTogether: () => void;
  /** When the host's own scheduled start happens, so the host sees the countdown too. */
  countdownAt: number | null;
} {
  const {
    inRoom,
    isHost,
    hasStarted,
    src,
    snap,
    bridgeRef,
    hostSourceRef,
    guestPickRef,
    publishState,
    onIncomingCommand,
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
    };
  };

  const publishAnchor = (anchor: PublishedAnchor, now: number, playAt?: number) => {
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
      publishAnchor(current, now);
      return;
    }
    if (change === "position") {
      const settle = seekSettleRef.current;
      if (!settle || Math.abs(current.positionSeconds - expectedPosition(settle.probe, now)) > 0.5)
        seekSettleRef.current = { since: now, probe: current };
      else seekSettleRef.current = { since: settle.since, probe: current };
      if (now - seekSettleRef.current.since >= SEEK_SETTLE_MS) {
        seekSettleRef.current = null;
        publishAnchor(current, now);
      }
      return;
    }
    seekSettleRef.current = null;
    if (now - lastPublishedAtRef.current >= HOST_HEARTBEAT_MS) publishAnchor(current, now);
  };

  useEffect(() => {
    lastPublishedRef.current = null;
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

  // Guest requests (play, pause, seek) arrive as commands; the host applies them.
  const seekSeqRef = useRef<Map<string, number>>(new Map());
  const pendingSeekRef = useRef<number | null>(null);
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
    const fireTimer = () => {
      seekApplyTimerRef.current = null;
      const pos = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pos == null) return;
      if (!inRoomRef.current || !isHostRef.current) return;
      applySeek(pos);
    };
    const flushPending = () => {
      if (seekApplyTimerRef.current != null) {
        window.clearTimeout(seekApplyTimerRef.current);
        seekApplyTimerRef.current = null;
      }
      const pos = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pos != null) applySeek(pos);
    };
    const off = onIncomingCommand((from, command) => {
      if (cast?.activeRef.current) return;
      const b = bridgeRef.current;
      if (!b) return;
      if (command.action === "play") {
        flushPending();
        cancelScheduledPlay();
        b.play({ reason: "room" }).catch(() => {});
      } else if (command.action === "pause") {
        flushPending();
        cancelScheduledPlay();
        b.pause("room");
      } else if (command.action === "seek") {
        if (typeof command.seq === "number") {
          const last = seekSeqRef.current.get(from);
          if (last != null && command.seq <= last) return;
          seekSeqRef.current.set(from, command.seq);
        }
        pendingSeekRef.current = command.positionSeconds;
        if (seekApplyTimerRef.current != null) window.clearTimeout(seekApplyTimerRef.current);
        seekApplyTimerRef.current = window.setTimeout(fireTimer, SEEK_APPLY_DEBOUNCE_MS);
      }
    });
    return off;
  }, [inRoom, isHost, onIncomingCommand, bridgeRef, cast]);

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
    publishState({
      ...baseState(),
      positionSeconds: getPlaybackPosition(),
      playing: false,
      buffering: false,
      speed: rateRef.current,
      sampledAt: Date.now(),
    });
  }, [inRoom, isHost, hasStarted, snap.durationSec, publishState, mediaKey]);

  return { startTogether, countdownAt };
}
