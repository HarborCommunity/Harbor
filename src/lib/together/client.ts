import type { ListenQueue, ListenSong, SongRequestAction } from "@/lib/listen-together/queue";
import {
  WT_PROTO,
  type ClientMessage,
  type Participant,
  type ParticipantSyncPhase,
  type ParticipantLocation,
  type PlayInvite,
  type RoomCode,
  type RoomCommand,
  type ServerMessage,
  type SummonTarget,
  type SyncState,
} from "./protocol";
import { diagnoseRelayFailure, type RoomEvent, type RoomSnapshot } from "./client-types";

export type { ClientState, RoomEvent, RoomSnapshot } from "./client-types";

const AVATAR_MAX_CHARS = 590_000;
const PING_INTERVAL_MS = 25_000;
const LIVENESS_TIMEOUT_MS = 40_000;
// While a watch party is playing, a dead connection must be noticed quickly.
const PLAYBACK_PING_INTERVAL_MS = 5_000;
const PLAYBACK_LIVENESS_TIMEOUT_MS = 12_000;
// Ignore a host's sample time that disagrees wildly with when it arrived.
const MAX_SAMPLE_SKEW_MS = 10_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RENAME_ATTEMPTS = 8;
const RENAME_RECONNECT_MS = 60;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_FAIL_STREAK = 4;
/** A play, pause or seek queued while offline is dropped once older than this. */
const PENDING_COMMAND_MAX_AGE_MS = 5_000;

/** The key a player and an invite share for "this title, this episode". */
export function playbackKey(
  mediaId: string,
  episode: { season: number; episode: number } | null | undefined,
): string {
  return `${mediaId}|${episode?.season ?? ""}|${episode?.episode ?? ""}`;
}

function capAvatar(avatar: string | null): string | null {
  return avatar && avatar.length > AVATAR_MAX_CHARS ? null : avatar;
}

export type ListenJoin = { listenMode: "host" } | { listenMode: "guest"; sessionId: string };

export class TogetherClient {
  private ws: WebSocket | null = null;
  private url: string;
  private clientId: string;
  private name: string;
  private originalName: string;
  private renameAttempts = 0;
  private room: RoomCode | null = null;
  private listenJoin?: ListenJoin;
  private resume?: { sessionId: string; resumeKey: string };
  private queueTimer: number | null = null;
  private pendingQueue: ListenQueue | null = null;
  private queueRevision = 0;
  private wantedQueueRevision = 0;
  private queueReadTimer: number | null = null;
  private snapshot: RoomSnapshot;
  private listeners = new Set<(e: RoomEvent) => void>();
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private intentional = false;
  private suppressUntil = 0;
  private suppressedState: SyncState | null = null;
  private suppressTimer: number | null = null;
  private outQueue: ClientMessage[] = [];
  private pendingCommand: { command: RoomCommand; at: number } | null = null;
  private activePlaybackKey: string | null = null;
  private playbackActive = false;
  private lastSentInvite: PlayInvite | null = null;
  private claimedHost = false;

  private connectWatchdog: number | null = null;
  private everJoined = false;
  private joinedThisAttempt = false;
  private attemptResolved = false;
  private failStreak = 0;
  private terminal = false;

  private avatar: string | null;
  private color: string | null;

  private relayOffset: number | null = null;
  private haveRttOffset = false;
  private pingSentAt = 0;
  private lastInboundAt = 0;

  constructor(
    url: string,
    clientId: string,
    name: string,
    avatar: string | null = null,
    color: string | null = null,
  ) {
    this.url = url;
    this.clientId = clientId;
    this.name = name;
    this.originalName = name;
    this.avatar = capAvatar(avatar);
    this.color = color;
    this.snapshot = {
      state: "disconnected",
      room: null,
      participants: [],
      syncState: null,
      hostClientId: null,
      started: false,
      relayVersion: null,
      lastError: null,
      participantStatus: {},
      hostAway: false,
    };
  }

  setName(name: string) {
    this.name = name;
    this.originalName = name;
    this.renameAttempts = 0;
    if (this.room && this.snapshot.state === "joined") {
      this.send({
        t: "profile",
        room: this.room,
        clientId: this.clientId,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
      });
    }
  }

  setProfile(avatar: string | null, color: string | null) {
    this.avatar = capAvatar(avatar);
    this.color = color;
    if (this.room && this.snapshot.state === "joined") {
      this.send({
        t: "profile",
        room: this.room,
        clientId: this.clientId,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
      });
    }
  }

  on(listener: (e: RoomEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ kind: "snapshot", snapshot: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RoomSnapshot {
    return this.snapshot;
  }

  suppressOutgoingFor(ms: number) {
    this.suppressUntil = Date.now() + ms;
    if (this.suppressTimer != null) {
      window.clearTimeout(this.suppressTimer);
      this.suppressTimer = null;
    }
    if (ms <= 0) {
      this.flushSuppressedState();
      return;
    }
    if (this.suppressedState) {
      this.suppressTimer = window.setTimeout(() => {
        this.suppressTimer = null;
        this.flushSuppressedState();
      }, ms);
    }
  }

  private flushSuppressedState() {
    const state = this.suppressedState;
    this.suppressedState = null;
    if (state) this.publishState(state);
  }

  /**
   * The media this client is playing right now, or null. An invite for media
   * that is already playing must never pull the viewer out to the picker, and
   * while something plays the connection is checked more often.
   */
  setActivePlayback(key: string | null) {
    this.activePlaybackKey = key;
    const active = key != null;
    if (active === this.playbackActive) return;
    this.playbackActive = active;
    if (this.pingTimer != null) this.startPing();
  }

  private isActivePlayback(invite: PlayInvite): boolean {
    return (
      this.activePlaybackKey != null &&
      this.activePlaybackKey === playbackKey(invite.mediaId, invite.episode)
    );
  }

  join(room: RoomCode, listenJoin?: ListenJoin): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.room && this.room !== room) {
      this.sendNow({ t: "leave", room: this.room, clientId: this.clientId });
    }
    this.cleanup();
    this.outQueue = [];
    this.pendingCommand = null;
    this.lastSentInvite = null;
    this.reconnectAttempt = 0;
    this.intentional = false;
    this.room = room;
    this.listenJoin = listenJoin;
    this.resume = undefined;
    this.claimedHost = false;
    this.everJoined = false;
    this.failStreak = 0;
    this.terminal = false;
    this.update({
      state: "connecting",
      room,
      listenSessionId: undefined,
      syncState: null,
      lastError: null,
      started: false,
      relayVersion: null,
      participantStatus: {},
      hostAway: false,
    });
    this.openSocket();
  }

  leave(): void {
    this.intentional = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.room) {
      this.sendNow({ t: "leave", room: this.room, clientId: this.clientId });
    }
    this.cleanup();
    this.reconnectAttempt = 0;
    this.room = null;
    this.listenJoin = undefined;
    this.resume = undefined;
    // A state held back by a recent sync belongs to this room, not the next one.
    this.suppressedState = null;
    if (this.suppressTimer != null) window.clearTimeout(this.suppressTimer);
    this.suppressTimer = null;
    this.suppressUntil = 0;
    this.outQueue = [];
    this.pendingCommand = null;
    this.lastSentInvite = null;
    this.claimedHost = false;
    this.update({
      state: "disconnected",
      room: null,
      participants: [],
      syncState: null,
      hostClientId: null,
      started: false,
      relayVersion: null,
      listenSessionId: undefined,
      lastError: null,
      participantStatus: {},
      hostAway: false,
    });
  }

  retry(): void {
    if (!this.room) return;
    this.terminal = false;
    this.failStreak = 0;
    this.reconnectAttempt = 0;
    this.everJoined = false;
    this.update({ state: "connecting", lastError: null });
    this.openSocket();
  }

  requestListenSong(track: ListenSong, action: SongRequestAction): void {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.snapshot.state === "joined" &&
      this.listenJoin?.listenMode === "guest" &&
      typeof this.snapshot.allowGuestQueue === "boolean" &&
      (action === "suggest" || this.snapshot.allowGuestQueue)
    ) {
      this.sendNow({ t: "listen-song-request", track, action });
    }
  }

  allowListenerQueue(allowed: boolean): void {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.resume &&
      typeof this.snapshot.allowGuestQueue === "boolean"
    )
      this.sendNow({ t: "listen-permission", allowed });
  }

  takeSuggestion(id: string) {
    const list = this.snapshot.suggestions ?? [];
    const request = list.find((item) => item.id === id);
    if (this.snapshot.state !== "joined" || !this.resume || !request) return;
    this.update({ suggestions: list.filter((item) => item.id !== id) });
    return request;
  }

  publishListenQueue(queue: ListenQueue): void {
    if (!this.resume || this.snapshot.state !== "joined") return;
    this.pendingQueue = { ...queue, revision: ++this.queueRevision };
    if (this.queueTimer === null) this.scheduleListenQueue(150);
  }

  private scheduleListenQueue(delay: number): void {
    this.queueTimer = window.setTimeout(() => {
      this.queueTimer = null;
      if (
        !this.pendingQueue ||
        this.ws?.readyState !== WebSocket.OPEN ||
        this.snapshot.state !== "joined"
      )
        return;
      this.sendNow({ t: "listen-queue", queue: this.pendingQueue });
      this.scheduleListenQueue(2000);
    }, delay);
  }

  private fetchListenQueue(): void {
    if (
      this.queueReadTimer !== null ||
      this.ws?.readyState !== WebSocket.OPEN ||
      this.wantedQueueRevision <= (this.snapshot.listenQueue?.revision ?? 0)
    )
      return;
    this.sendNow({ t: "get-listen-queue" });
    this.queueReadTimer = window.setTimeout(() => {
      this.queueReadTimer = null;
      this.fetchListenQueue();
    }, 1000);
  }

  private clearListenQueue(): void {
    if (this.queueTimer !== null) window.clearTimeout(this.queueTimer);
    this.queueTimer = null;
    this.pendingQueue = null;
  }

  publishState(state: SyncState): void {
    if (!this.room) return;
    if (Date.now() < this.suppressUntil) {
      // Keep the newest state instead of dropping it: a host's anchor must
      // still reach the room once the suppression window ends.
      this.suppressedState = state;
      if (this.suppressTimer == null) {
        this.suppressTimer = window.setTimeout(
          () => {
            this.suppressTimer = null;
            this.flushSuppressedState();
          },
          Math.max(0, this.suppressUntil - Date.now()),
        );
      }
      return;
    }
    this.send({
      t: "state",
      room: this.room,
      clientId: this.clientId,
      state: this.toRelayClock(state),
    });
    this.update({ syncState: state });
  }

  sendCommand(command: RoomCommand): void {
    if (!this.room) return;
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // Only the newest request matters; it is sent if the room is back soon.
      this.pendingCommand = { command, at: Date.now() };
      return;
    }
    this.sendNow({ t: "cmd", room: this.room, clientId: this.clientId, command });
  }

  sendStatus(phase: ParticipantSyncPhase): void {
    if (!this.room || this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendNow({ t: "status", room: this.room, clientId: this.clientId, phase });
  }

  /** Converts the app's local sample and start times to relay time for the wire. */
  private toRelayClock(state: SyncState): SyncState {
    if (state.sampledAt == null && state.playAt == null) return state;
    const out = { ...state };
    if (this.relayOffset == null) {
      delete out.sampledAt;
      delete out.playAt;
      return out;
    }
    if (out.sampledAt != null) out.sampledAt += this.relayOffset;
    if (out.playAt != null) out.playAt += this.relayOffset;
    return out;
  }

  sendChat(text: string): void {
    if (!this.room || !text.trim()) return;
    this.send({ t: "chat", room: this.room, clientId: this.clientId, text: text.trim() });
  }

  sendInvite(invite: PlayInvite): void {
    if (!this.room || !invite.mediaId) return;
    this.lastSentInvite = invite;
    this.send({ t: "invite", room: this.room, clientId: this.clientId, invite });
  }

  clearInvite(): void {
    this.lastSentInvite = null;
  }

  markReady(ready: boolean): void {
    if (!this.room) return;
    this.send({ t: "ready", room: this.room, clientId: this.clientId, ready });
  }

  claimHost(fresh: boolean): void {
    if (!this.room) return;
    this.claimedHost = true;
    this.send({ t: "claim-host", room: this.room, clientId: this.clientId, fresh });
  }

  private reconcileHostClaim(hostClientId: string | null): void {
    if (!hostClientId) return;
    this.claimedHost = hostClientId === this.clientId;
  }

  startRoom(): void {
    if (!this.room) return;
    this.send({ t: "start", room: this.room, clientId: this.clientId });
  }

  notifyHostLeaving(): void {
    if (!this.room) return;
    this.send({ t: "host-leaving", room: this.room, clientId: this.clientId });
  }

  sendSummon(target: SummonTarget): void {
    if (!this.room) return;
    this.send({ t: "summon", room: this.room, clientId: this.clientId, target });
  }

  sendCursor(x: number, y: number, visible: boolean, path: string): void {
    if (!this.room) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendNow({ t: "cursor", room: this.room, clientId: this.clientId, x, y, visible, path });
  }

  sendDraw(
    strokeId: string,
    phase: "start" | "point" | "end" | "clear",
    path: string,
    x?: number,
    y?: number,
    color?: string,
  ): void {
    if (!this.room) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendNow({
      t: "draw",
      room: this.room,
      clientId: this.clientId,
      strokeId,
      phase,
      x,
      y,
      color,
      path,
    });
  }

  sendPresence(location?: ParticipantLocation): void {
    if (!this.room) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendNow({
      t: "presence",
      room: this.room,
      clientId: this.clientId,
      activeAt: Date.now(),
      location,
    });
  }

  private openSocket() {
    if (!this.room) return;
    this.attemptResolved = false;
    this.joinedThisAttempt = false;
    try {
      const base = this.url
        .trim()
        .replace(/^https:\/\//i, "wss://")
        .replace(/^http:\/\//i, "ws://")
        .replace(/\/+$/, "");
      const wsBase = /^wss?:\/\//i.test(base) ? base : `wss://${base}`;
      const endpoint = new URL(wsBase);
      endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/r/" + this.room;
      if (this.listenJoin?.listenMode === "guest")
        endpoint.searchParams.set("listenSession", this.listenJoin.sessionId);
      this.ws = new WebSocket(endpoint.toString());
    } catch {
      this.failAttempt();
      return;
    }
    const socket = this.ws;
    this.armWatchdog();
    socket.onopen = () => {
      if (this.ws !== socket || !this.room) return;
      this.reconnectAttempt = 0;
      this.lastInboundAt = Date.now();
      // The relay reserves its larger avatar payload allowance for the first frame.
      this.sendNow({
        t: "hello",
        ...(this.listenJoin?.listenMode === "host" && { songRequests: true }),
        ...(this.resume ? { listenMode: "resume" as const, ...this.resume } : this.listenJoin),
        room: this.room,
        clientId: this.clientId,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
      });
      this.sendPing();
      this.flushOutQueue();
      if (this.claimedHost && !this.listenJoin) {
        this.sendNow({ t: "claim-host", room: this.room, clientId: this.clientId, fresh: false });
      }
      if (this.lastSentInvite) {
        this.sendNow({
          t: "invite",
          room: this.room,
          clientId: this.clientId,
          invite: this.lastSentInvite,
        });
      }
      this.startPing();
    };
    socket.onmessage = (ev) => {
      if (this.ws !== socket) return;
      this.lastInboundAt = Date.now();
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        this.handleServer(msg);
      } catch {
        // ignore malformed
      }
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.stopPing();
      this.resetClockState();
      this.clearWatchdog();
      if (this.intentional || this.terminal) return;
      // Joining resolves the handshake, but a later disconnect is a new failure.
      // Keep failed handshakes idempotent while allowing established rooms to retry.
      if (this.joinedThisAttempt) {
        this.joinedThisAttempt = false;
        this.attemptResolved = false;
      }
      this.failAttempt();
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };
  }

  private handleServer(msg: ServerMessage) {
    switch (msg.t) {
      case "joined":
        if (
          this.listenJoin?.listenMode === "guest" &&
          (msg.sessionId !== this.listenJoin.sessionId || msg.hostClientId === this.clientId)
        ) {
          this.endListen("Listening session ended");
          return;
        }
        if (this.listenJoin?.listenMode === "host" && msg.sessionId && msg.resumeKey)
          this.resume = { sessionId: msg.sessionId, resumeKey: msg.resumeKey };
        if (!this.listenJoin && this.handleNameCollision(msg.participants)) return;
        this.renameAttempts = 0;
        this.everJoined = true;
        this.joinedThisAttempt = true;
        this.attemptResolved = true;
        this.failStreak = 0;
        this.clearWatchdog();
        if (typeof msg.srvAt === "number" && this.relayOffset == null)
          this.relayOffset = msg.srvAt - Date.now();
        if (msg.state) this.localizeStateClock(msg.state, msg.srvAt, msg.observedAt);
        this.clearListenQueue();
        this.queueRevision = msg.queue?.revision ?? 0;
        this.update({
          allowGuestQueue: msg.allowGuestQueue,
          suggestions:
            msg.sessionId && msg.sessionId === this.snapshot.listenSessionId
              ? this.snapshot.suggestions
              : [],
          listenQueue: msg.queue ?? null,
          state: "joined",
          listenSessionId: this.listenJoin ? msg.sessionId : undefined,
          room: this.room,
          participants: msg.participants,
          syncState: msg.state,
          hostClientId: msg.hostClientId,
          started: msg.started ?? false,
          relayVersion: typeof msg.relayVersion === "number" ? msg.relayVersion : null,
          participantStatus: { ...msg.statuses },
          hostAway: msg.hostAway === true,
        });
        this.reconcileHostClaim(msg.hostClientId);
        if (msg.state) {
          this.emit({ kind: "incoming-state", state: msg.state });
          const stateAuthorPresent =
            !!msg.state.updatedBy && msg.participants.some((p) => p.id === msg.state!.updatedBy);
          if (
            msg.state.mediaId &&
            msg.state.updatedBy !== this.clientId &&
            stateAuthorPresent &&
            this.activePlaybackKey !== playbackKey(msg.state.mediaId, msg.state.episode)
          ) {
            const hostName =
              msg.participants.find((p) => p.id === msg.state!.updatedBy)?.name ?? "Host";
            this.emit({
              kind: "invite",
              from: msg.state.updatedBy,
              name: hostName,
              invite: {
                mediaId: msg.state.mediaId,
                mediaType: msg.state.episode ? "series" : "movie",
                mediaTitle: msg.state.mediaTitle ?? "Watch Together",
                posterUrl: msg.state.posterUrl ?? undefined,
                episode: msg.state.episode ?? undefined,
                proto: msg.state.source ? WT_PROTO : undefined,
                guestPick: msg.state.guestPick === true ? true : undefined,
              },
              at: msg.state.updatedAt ?? Date.now(),
            });
          }
        }
        return;
      case "host":
        this.update({ hostClientId: msg.hostClientId, hostAway: false });
        this.reconcileHostClaim(msg.hostClientId);
        return;
      case "started":
        this.update({ started: msg.started });
        this.emit({ kind: "started", started: msg.started });
        return;
      case "participant-joined": {
        const nextParticipants = [
          ...this.snapshot.participants.filter((p) => p.id !== msg.participant.id),
          msg.participant,
        ];
        const incoming = msg.participant;
        if (
          incoming.id !== this.clientId &&
          !this.listenJoin &&
          incoming.name === this.name &&
          this.clientId > incoming.id &&
          this.handleNameCollision(nextParticipants)
        ) {
          return;
        }
        // A (re)joining connection has reported nothing yet; a stale "buffering"
        // from a crashed connection must not keep the room waiting.
        const participantStatus = { ...this.snapshot.participantStatus };
        delete participantStatus[incoming.id];
        this.update({
          participants: nextParticipants,
          participantStatus,
          ...(incoming.id === this.snapshot.hostClientId && { hostAway: false }),
        });
        if (incoming.id !== this.clientId && this.room && this.ws?.readyState === WebSocket.OPEN) {
          this.sendNow({
            t: "profile",
            room: this.room,
            clientId: this.clientId,
            name: this.name,
            avatar: this.avatar,
            color: this.color,
          });
        }
        if (
          incoming.id !== this.clientId &&
          this.lastSentInvite &&
          this.snapshot.hostClientId === this.clientId &&
          this.room &&
          this.ws?.readyState === WebSocket.OPEN
        ) {
          this.sendNow({
            t: "invite",
            room: this.room,
            clientId: this.clientId,
            invite: this.lastSentInvite,
          });
        }
        return;
      }
      case "participant-left": {
        const left = this.snapshot.participants.find((p) => p.id === msg.clientId);
        const leftName = msg.name ?? left?.name ?? "Someone";
        this.emit({
          kind: "participant-left",
          clientId: msg.clientId,
          name: leftName,
          avatar: left?.avatar ?? null,
          color: left?.color ?? null,
        });
        const participantStatus = { ...this.snapshot.participantStatus };
        delete participantStatus[msg.clientId];
        this.update({
          participants: this.snapshot.participants.filter((p) => p.id !== msg.clientId),
          participantStatus,
        });
        return;
      }
      case "participant-status":
        if (msg.phase !== "ready" && msg.phase !== "buffering") return;
        this.update({
          participantStatus: { ...this.snapshot.participantStatus, [msg.clientId]: msg.phase },
        });
        return;
      case "participant-away":
        this.update({
          participants: this.snapshot.participants.map((p) =>
            p.id === msg.clientId ? { ...p, away: true, ready: false } : p,
          ),
          ...(msg.clientId === this.snapshot.hostClientId && { hostAway: true }),
        });
        return;
      case "host-away":
        if (msg.clientId === this.snapshot.hostClientId) this.update({ hostAway: true });
        return;
      case "participant-ready":
        this.update({
          participants: this.snapshot.participants.map((p) =>
            p.id === msg.clientId ? { ...p, ready: msg.ready } : p,
          ),
        });
        return;
      case "participant-profile":
        this.update({
          participants: this.snapshot.participants.map((p) =>
            p.id === msg.participant.id
              ? {
                  ...p,
                  name: msg.participant.name,
                  avatar: msg.participant.avatar,
                  color: msg.participant.color,
                }
              : p,
          ),
        });
        return;
      case "state":
        this.localizeStateClock(msg.state, msg.srvAt, msg.observedAt);
        this.update({ syncState: msg.state });
        this.emit({ kind: "incoming-state", state: msg.state });
        return;
      case "cmd":
        this.emit({ kind: "incoming-command", from: msg.from, command: msg.command });
        return;
      case "chat":
        this.emit({ kind: "chat", from: msg.from, name: msg.name, text: msg.text, at: msg.at });
        return;
      case "invite":
        if (msg.from === this.clientId) return;
        // Hosts re-send their invite on reconnect and whenever someone joins;
        // a viewer already playing that media must stay in the player.
        if (this.isActivePlayback(msg.invite)) return;
        this.emit({
          kind: "invite",
          from: msg.from,
          name: msg.name,
          invite: msg.invite,
          at: msg.at,
        });
        return;
      case "host-leaving":
        this.emit({ kind: "host-leaving", from: msg.from, name: msg.name, at: msg.at });
        return;
      case "summon":
        this.emit({
          kind: "summon",
          from: msg.from,
          name: msg.name,
          target: msg.target,
          at: msg.at,
        });
        return;
      case "cursor":
        this.emit({
          kind: "cursor",
          from: msg.from,
          name: msg.name,
          x: msg.x,
          y: msg.y,
          visible: msg.visible,
          path: msg.path,
        });
        return;
      case "draw":
        this.emit({
          kind: "draw",
          from: msg.from,
          name: msg.name,
          strokeId: msg.strokeId,
          phase: msg.phase,
          x: msg.x,
          y: msg.y,
          color: msg.color,
          path: msg.path,
        });
        return;
      case "presence":
        this.emit({
          kind: "presence",
          from: msg.from,
          activeAt: msg.activeAt,
          location: msg.location,
        });
        return;
      case "listen-queue":
        if (
          this.snapshot.listenSessionId &&
          msg.queue &&
          msg.queue.revision > (this.snapshot.listenQueue?.revision ?? 0)
        )
          this.update({ listenQueue: msg.queue });
        return;
      case "queue-changed":
        if (
          this.snapshot.listenSessionId &&
          msg.revision > (this.snapshot.listenQueue?.revision ?? 0)
        ) {
          this.wantedQueueRevision = Math.max(this.wantedQueueRevision, msg.revision);
          this.fetchListenQueue();
        }
        return;
      case "queue-accepted":
        if (this.pendingQueue && msg.revision === this.pendingQueue.revision)
          this.clearListenQueue();
        return;
      case "listen-permission":
        if (this.snapshot.listenSessionId && typeof msg.allowed === "boolean")
          this.update({ allowGuestQueue: msg.allowed });
        return;
      case "listen-song-request": {
        if (
          !this.resume ||
          !this.snapshot.listenSessionId ||
          typeof this.snapshot.allowGuestQueue !== "boolean"
        )
          return;
        const request = { id: msg.id, name: msg.name, track: msg.track };
        if (msg.action === "suggest")
          this.update({ suggestions: [...(this.snapshot.suggestions ?? []).slice(-49), request] });
        else if (msg.action !== "enqueue" || !this.snapshot.allowGuestQueue) return;
        this.emit({ kind: "listen-request", request, action: msg.action });
        return;
      }
      case "listen-request-status":
        this.emit({ kind: "listen-request-status", delivered: msg.delivered, action: msg.action });
        return;
      case "session-ended":
        if (this.listenJoin) this.endListen("Listening session ended");
        return;
      case "error":
        if (this.resume && msg.code === "queue_busy") return;
        if (this.resume && msg.code === "invalid_queue" && this.pendingQueue) {
          // The acknowledgement may have been lost. Retry the latest snapshot at a fresh revision.
          this.pendingQueue = { ...this.pendingQueue, revision: ++this.queueRevision };
          return;
        }
        if (this.listenJoin && msg.code === "session_ended") {
          this.endListen("Listening session ended");
          return;
        }
        this.update({ state: "error", lastError: msg.message });
        return;
      case "pong":
        this.recordPong(msg.srvAt);
        return;
    }
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendNow(msg);
      return;
    }
    if (
      msg.t === "cursor" ||
      msg.t === "draw" ||
      msg.t === "ping" ||
      msg.t === "presence" ||
      msg.t === "leave" ||
      msg.t === "hello" ||
      msg.t === "profile" ||
      msg.t === "claim-host"
    ) {
      return;
    }
    if (msg.t === "state") {
      this.outQueue = this.outQueue.filter((m) => m.t !== "state");
    }
    this.outQueue.push(msg);
  }

  private sendNow(msg: ClientMessage) {
    this.ws?.send(JSON.stringify(msg));
  }

  private flushOutQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const queue = this.outQueue;
    this.outQueue = [];
    for (const m of queue) this.sendNow(m);
    const pending = this.pendingCommand;
    this.pendingCommand = null;
    // After a long outage the room has moved on; an old seek would drag everyone back.
    if (pending && this.room && Date.now() - pending.at <= PENDING_COMMAND_MAX_AGE_MS)
      this.sendNow({
        t: "cmd",
        room: this.room,
        clientId: this.clientId,
        command: pending.command,
      });
  }

  private handleNameCollision(participants: Participant[]): boolean {
    if (this.renameAttempts >= MAX_RENAME_ATTEMPTS) return false;
    const others = participants.filter((p) => p.id !== this.clientId);
    const taken = new Set(others.map((p) => p.name));
    if (!taken.has(this.name)) return false;
    let n = 2;
    let candidate = `${this.originalName} (${n})`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${this.originalName} (${n})`;
    }
    this.name = candidate;
    this.renameAttempts += 1;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.room) {
      this.send({ t: "leave", room: this.room, clientId: this.clientId });
    }
    this.intentional = true;
    this.cleanup();
    this.intentional = false;
    if (this.room) {
      window.setTimeout(() => this.openSocket(), RENAME_RECONNECT_MS);
    }
    return true;
  }

  private sendPing() {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.room) return;
    this.pingSentAt = Date.now();
    this.sendNow({ t: "ping", room: this.room, clientId: this.clientId });
  }

  private startPing() {
    this.stopPing();
    const liveness = this.playbackActive ? PLAYBACK_LIVENESS_TIMEOUT_MS : LIVENESS_TIMEOUT_MS;
    this.pingTimer = window.setInterval(
      () => {
        if (this.lastInboundAt && Date.now() - this.lastInboundAt > liveness) {
          try {
            this.ws?.close();
          } catch {
            /* ignore */
          }
          return;
        }
        this.sendPing();
      },
      this.playbackActive ? PLAYBACK_PING_INTERVAL_MS : PING_INTERVAL_MS,
    );
  }

  private recordPong(srvAt: number | undefined) {
    if (typeof srvAt !== "number" || this.pingSentAt === 0) return;
    const rtt = Date.now() - this.pingSentAt;
    if (rtt < 0 || rtt > 10_000) return;
    const sample = srvAt - (this.pingSentAt + rtt / 2);
    if (!this.haveRttOffset) {
      this.relayOffset = sample;
      this.haveRttOffset = true;
    } else {
      this.relayOffset = this.relayOffset! * 0.7 + sample * 0.3;
    }
    this.pingSentAt = 0;
  }

  private localizeStateClock(state: SyncState, srvAt: number | undefined, observedAt?: number) {
    if (typeof srvAt !== "number") {
      delete state.sampledAt;
      delete state.playAt;
      return;
    }
    if (this.relayOffset == null) this.relayOffset = srvAt - Date.now();
    const offset = this.relayOffset;
    state.updatedAt =
      (typeof observedAt === "number" ? Math.min(srvAt, observedAt) : srvAt) - offset;
    if (typeof state.sampledAt === "number" && Number.isFinite(state.sampledAt)) {
      state.sampledAt -= offset;
      // The host sampled before the relay received it; a later or far earlier
      // sample means one of the clocks is unreliable, so use the relay's time.
      if (
        state.sampledAt > state.updatedAt + 1000 ||
        state.updatedAt - state.sampledAt > MAX_SAMPLE_SKEW_MS
      )
        delete state.sampledAt;
    } else delete state.sampledAt;
    if (typeof state.playAt === "number" && Number.isFinite(state.playAt)) state.playAt -= offset;
    else delete state.playAt;
  }

  private resetClockState() {
    this.pingSentAt = 0;
    this.relayOffset = null;
    this.haveRttOffset = false;
  }

  private stopPing() {
    if (this.pingTimer != null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.intentional || this.terminal) return;
    if (this.reconnectTimer != null) return;
    const exp = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    const jitter = Math.random() * 0.3 * exp;
    const delay = exp + jitter;
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private endListen(message: string) {
    this.leave();
    this.update({ state: "error", lastError: message });
  }

  private failAttempt() {
    if (this.attemptResolved) return;
    this.attemptResolved = true;
    this.clearWatchdog();
    this.failStreak += 1;
    const limit = this.everJoined ? MAX_FAIL_STREAK * 3 : MAX_FAIL_STREAK;
    if (this.failStreak >= limit) {
      if (this.listenJoin?.listenMode === "guest")
        this.endListen("Listening session ended or unavailable");
      else void this.goTerminal();
      return;
    }
    this.update({ state: "connecting" });
    this.scheduleReconnect();
  }

  private armWatchdog() {
    this.clearWatchdog();
    this.connectWatchdog = window.setTimeout(() => {
      this.connectWatchdog = null;
      if (this.joinedThisAttempt || this.attemptResolved) return;
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
      this.failAttempt();
    }, CONNECT_TIMEOUT_MS);
  }

  private clearWatchdog() {
    if (this.connectWatchdog != null) {
      window.clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }
  }

  private async goTerminal() {
    this.terminal = true;
    this.stopPing();
    this.clearWatchdog();
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.update({ state: "error", lastError: await diagnoseRelayFailure(this.httpBase()) });
  }

  private httpBase(): string {
    const b = this.url
      .trim()
      .replace(/^wss:\/\//i, "https://")
      .replace(/^ws:\/\//i, "http://")
      .replace(/\/+$/, "");
    return /^https?:\/\//i.test(b) ? b : `https://${b}`;
  }

  private cleanup() {
    this.wantedQueueRevision = 0;
    if (this.queueReadTimer !== null) window.clearTimeout(this.queueReadTimer);
    this.queueReadTimer = null;
    this.clearListenQueue();
    this.stopPing();
    this.clearWatchdog();
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }

  private update(patch: Partial<RoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit({ kind: "snapshot", snapshot: this.snapshot });
  }

  private emit(event: RoomEvent) {
    for (const l of this.listeners) l(event);
  }
}
