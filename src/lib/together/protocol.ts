export type RoomCode = string;

export type Participant = {
  id: string;
  name: string;
  joinedAt: number;
  ready: boolean;
  avatar?: string | null;
  color?: string | null;
};

export type EpisodeRef = {
  season: number;
  episode: number;
  name?: string;
  kitsuStreamId?: string;
  imdbId?: string;
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteNumber?: number;
  tvdbEpisodeId?: number;
};

export type SourceDescriptor = {
  title?: string;
  resolution?: string;
  sizeBytes?: number;
  infoHash?: string;
  fileIdx?: number;
  durationSec?: number;
};

export const WT_PROTO = 2;

export type SyncState = {
  mediaId: string | null;
  mediaTitle: string | null;
  episode: EpisodeRef | null;
  posterUrl: string | null;
  positionSeconds: number;
  playing: boolean;
  speed?: number;
  source?: SourceDescriptor;
  guestPick?: boolean;
  /** The host is waiting for data; the timeline is stopped. Sent by newer hosts. */
  buffering?: boolean;
  /** When the host read positionSeconds (relay ms on the wire, local ms in the app). */
  sampledAt?: number;
  /** Playback starts at this instant (relay ms on the wire, local ms in the app). */
  playAt?: number;
  updatedAt: number;
  updatedBy: string;
  hostClientId: string | null;
};

export type RoomCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionSeconds: number; seq?: number; at?: number };

export type PlayInvite = {
  mediaId: string;
  mediaType: "movie" | "series";
  mediaTitle: string;
  releaseInfo?: string;
  posterUrl?: string;
  backgroundUrl?: string;
  logoUrl?: string;
  episode?: EpisodeRef;
  proto?: number;
  guestPick?: boolean;
  source?: SourceDescriptor;
};

export type SummonView = "home" | "discover" | "anime" | "queue" | "addons";

export type SummonTarget = {
  mediaId?: string;
  mediaType?: "movie" | "series";
  mediaTitle?: string;
  posterUrl?: string;
  backgroundUrl?: string;
  releaseInfo?: string;
  view?: SummonView;
  addonId?: string;
  label?: string;
};

export type ParticipantLocationMeta = {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  releaseInfo?: string;
  logo?: string;
};

export type ParticipantLocation =
  | { kind: "home" | "discover" | "anime" | "queue" | "addons" | "settings" }
  | { kind: "service"; service: string }
  | { kind: "addon-detail"; addonId: string }
  | { kind: "person"; personId: number }
  | { kind: "meta"; meta: ParticipantLocationMeta }
  | {
      kind: "picker";
      meta: ParticipantLocationMeta;
      episode?: { season: number; episode: number; name?: string };
    }
  | {
      kind: "player";
      meta: ParticipantLocationMeta;
      episode?: { season: number; episode: number; name?: string };
    };

import type {
  ListenQueue,
  ListenSong,
  SongRequestAction,
  ListenSuggestion,
} from "@/lib/listen-together/queue";

export type ClientMessage =
  | { t: "listen-song-request"; action: SongRequestAction; track: ListenSong }
  | { t: "listen-permission"; allowed: boolean }
  | {
      t: "hello";
      songRequests?: boolean;
      listenMode?: "host" | "resume" | "guest";
      sessionId?: string;
      resumeKey?: string;
      room: RoomCode;
      clientId: string;
      name: string;
      avatar?: string | null;
      color?: string | null;
    }
  | {
      t: "profile";
      room: RoomCode;
      clientId: string;
      name: string;
      avatar?: string | null;
      color?: string | null;
    }
  | { t: "listen-queue"; queue: ListenQueue }
  | { t: "get-listen-queue" }
  | { t: "leave"; room: RoomCode; clientId: string }
  | { t: "state"; room: RoomCode; clientId: string; state: SyncState }
  | { t: "cmd"; room: RoomCode; clientId: string; command: RoomCommand }
  | { t: "chat"; room: RoomCode; clientId: string; text: string }
  | { t: "invite"; room: RoomCode; clientId: string; invite: PlayInvite }
  | { t: "ready"; room: RoomCode; clientId: string; ready: boolean }
  | { t: "host-leaving"; room: RoomCode; clientId: string }
  | { t: "claim-host"; room: RoomCode; clientId: string; fresh: boolean }
  | { t: "start"; room: RoomCode; clientId: string }
  | { t: "summon"; room: RoomCode; clientId: string; target: SummonTarget }
  | {
      t: "cursor";
      room: RoomCode;
      clientId: string;
      x: number;
      y: number;
      visible: boolean;
      path: string;
    }
  | {
      t: "draw";
      room: RoomCode;
      clientId: string;
      strokeId: string;
      phase: "start" | "point" | "end" | "clear";
      x?: number;
      y?: number;
      color?: string;
      path: string;
    }
  | {
      t: "presence";
      room: RoomCode;
      clientId: string;
      activeAt: number;
      location?: ParticipantLocation;
    }
  | { t: "ping"; room: RoomCode; clientId: string };

export type ServerMessage =
  | { t: "listen-permission"; allowed: boolean }
  | ({ t: "listen-song-request"; action: SongRequestAction } & ListenSuggestion)
  | { t: "listen-request-status"; delivered: boolean; action?: SongRequestAction }
  | {
      t: "joined";
      sessionId?: string;
      resumeKey?: string;
      queue?: ListenQueue | null;
      allowGuestQueue?: boolean;
      observedAt?: number;
      room: RoomCode;
      participants: Participant[];
      state: SyncState | null;
      hostClientId: string | null;
      started?: boolean;
      srvAt?: number;
      relayVersion?: number;
    }
  | { t: "participant-joined"; participant: Participant }
  | { t: "participant-left"; clientId: string; name?: string }
  | { t: "started"; started: boolean }
  | { t: "participant-ready"; clientId: string; ready: boolean }
  | {
      t: "participant-profile";
      participant: { id: string; name: string; avatar?: string | null; color?: string | null };
    }
  | { t: "host"; hostClientId: string | null }
  | { t: "host-leaving"; from: string; name: string; at: number }
  | { t: "summon"; from: string; name: string; target: SummonTarget; at: number }
  | { t: "listen-queue"; queue: ListenQueue | null }
  | { t: "queue-changed" | "queue-accepted"; revision: number }
  | { t: "session-ended" }
  | { t: "state"; state: SyncState; srvAt?: number; observedAt?: number }
  | { t: "cmd"; from: string; command: RoomCommand }
  | { t: "chat"; from: string; name: string; text: string; at: number }
  | { t: "invite"; from: string; name: string; invite: PlayInvite; at: number }
  | {
      t: "cursor";
      from: string;
      name: string;
      x: number;
      y: number;
      visible: boolean;
      path: string;
    }
  | {
      t: "draw";
      from: string;
      name: string;
      strokeId: string;
      phase: "start" | "point" | "end" | "clear";
      x?: number;
      y?: number;
      color?: string;
      path: string;
    }
  | { t: "presence"; from: string; activeAt: number; location?: ParticipantLocation }
  | { t: "error"; code: string; message: string }
  | { t: "pong"; srvAt?: number };

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(): RoomCode {
  let out = "";
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[buf[i] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeRoomCode(input: string): RoomCode {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}
