const WORKER_VERSION = 13;
const MAX_AVATAR_LENGTH = 600_000;

function sanitizeAvatar(v) {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > MAX_AVATAR_LENGTH) return null;
  if (!/^data:image\/(png|webp|jpeg|gif);base64,/i.test(v) && !/^https?:\/\//i.test(v)) return null;
  return v;
}

function sanitizeSource(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out = {};
  if (typeof v.title === "string" && v.title.length > 0) out.title = v.title.slice(0, 200);
  if (typeof v.resolution === "string" && v.resolution.length > 0)
    out.resolution = v.resolution.slice(0, 16);
  if (typeof v.infoHash === "string" && /^[0-9a-fA-F]{16,64}$/.test(v.infoHash))
    out.infoHash = v.infoHash.toLowerCase();
  if (typeof v.sizeBytes === "number" && isFinite(v.sizeBytes) && v.sizeBytes >= 0)
    out.sizeBytes = v.sizeBytes;
  if (typeof v.durationSec === "number" && isFinite(v.durationSec) && v.durationSec >= 0)
    out.durationSec = v.durationSec;
  if (typeof v.fileIdx === "number" && isFinite(v.fileIdx) && v.fileIdx >= 0)
    out.fileIdx = v.fileIdx;
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeColor(v) {
  if (typeof v !== "string") return null;
  if (!/^#[0-9a-f]{6}$/i.test(v)) return null;
  return v.toLowerCase();
}
const ALLOWED_PATH = /^\/r\/([A-Z0-9]{4,8})$/;
const PROXY_HOSTS = new Set([
  "api.knaben.org",
  "apibay.org",
  "1337x.bz",
  "yts.mx",
  "eztv.re",
  "nyaa.si",
  "bitsearch.to",
  "rutor.info",
  "torrentio.strem.fun",
  "stremio.torbox.app",
  "v3-cinemeta.strem.io",
  "opensubtitles-v3.strem.io",
  "opensubtitles.strem.io",
  "opensubtitles.stremio.homes",
]);
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const RATE_BUCKET = new Map();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, version: WORKER_VERSION, hosts: [...PROXY_HOSTS] }),
        {
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        },
      );
    }
    if (url.pathname === "/proxy") return handleProxy(req, url);
    const m = url.pathname.match(ALLOWED_PATH);
    if (!m) return new Response("not found", { status: 404 });
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const id = env.ROOM.idFromName(m[1]);
    const stub = env.ROOM.get(id);
    return stub.fetch(req);
  },
};

function checkRate(ip) {
  if (!ip) return true;
  const now = Date.now();
  for (const [k, e] of RATE_BUCKET) {
    if (now - e.windowStart > RATE_WINDOW_MS) RATE_BUCKET.delete(k);
  }
  const entry = RATE_BUCKET.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    RATE_BUCKET.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

async function handleProxy(req, url) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  const ip = req.headers.get("cf-connecting-ip");
  if (!checkRate(ip)) {
    return new Response("rate limit exceeded", {
      status: 429,
      headers: { "access-control-allow-origin": "*", "retry-after": "60" },
    });
  }
  const target = url.searchParams.get("u");
  if (!target) return new Response("missing u", { status: 400 });
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("bad u", { status: 400 });
  }
  if (parsed.protocol !== "https:" || !PROXY_HOSTS.has(parsed.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }
  const init = {
    method: req.method,
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      accept: req.headers.get("accept") || "application/json",
    },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    const ct = req.headers.get("content-type");
    if (ct) init.headers["content-type"] = ct;
  }
  let upstream;
  try {
    upstream = await fetch(parsed.toString(), init);
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

const ROOM_IDLE_MS = 1000 * 60 * 60 * 6;
// A host whose connection drops keeps the role this long, so a Wi-Fi blip
// does not hand playback to a guest.
const HOST_GRACE_MS = 10_000;
// When the host chose to wait for people who drop, a crashed participant stays
// in the room as "away" this long, so the room can wait for them to rejoin.
const AWAY_GRACE_MS = 120_000;
// Unchanged playback is written to storage at most this often.
const SYNC_SAVE_MS = 10_000;
const SYNC_PHASES = new Set(["ready", "buffering"]);
// Reactions are a fixed set, so nothing but these few characters is relayed.
const REACTIONS = new Set(["😂", "😮", "😍", "😢", "🔥", "👏", "💀", "👍"]);
// Each person may send this many reactions per window; extra taps are dropped.
const REACTION_BURST = 5;
const REACTION_WINDOW_MS = 2_000;
// A guest's distance from the host's timeline, in seconds, as it reports it.
const MAX_SYNC_OFFSET_S = 3_600;
const PLAYBACK_ACTIONS = new Set(["play", "pause", "seek"]);

function sanitizeOffset(v) {
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  return Math.round(Math.max(-MAX_SYNC_OFFSET_S, Math.min(MAX_SYNC_OFFSET_S, v)) * 10) / 10;
}

function sanitizeCause(v) {
  if (!v || typeof v !== "object") return undefined;
  if (typeof v.by !== "string" || v.by.length === 0 || v.by.length > 64) return undefined;
  if (!PLAYBACK_ACTIONS.has(v.action)) return undefined;
  if (typeof v.id !== "number" || !isFinite(v.id)) return undefined;
  return { by: v.by, action: v.action, id: v.id };
}

function peerAttachment(p) {
  return {
    clientId: p.clientId,
    name: p.name,
    joinedAt: p.joinedAt,
    ready: p.ready,
    color: p.color,
    status: p.status,
    offset: p.offset,
  };
}

export class Room {
  constructor(state) {
    this.state = state;
    this.peers = new Map();
    this.syncState = null;
    this.hostClientId = null;
    this.started = false;
    this.syncStateAt = null;
    this.lastSyncSaveAt = 0;
    this.hostAwayUntil = null;
    this.away = new Map();
    this.lastActivity = Date.now();
    for (const ws of state.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.clientId) this.peers.set(ws, { ...att, avatar: null, lastStateAt: 0 });
    }
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get([
        "syncState",
        "hostClientId",
        "started",
        "hostAwayUntil",
        "syncStateAt",
        "away",
      ]);
      this.syncState = stored.get("syncState") ?? null;
      this.hostClientId = stored.get("hostClientId") ?? null;
      this.started = stored.get("started") ?? false;
      this.hostAwayUntil = stored.get("hostAwayUntil") ?? null;
      // When the stored state was received, so a room woken from eviction
      // does not hand it out as fresh.
      this.syncStateAt = stored.get("syncStateAt") ?? null;
      this.away = new Map(stored.get("away") ?? []);
    });
  }

  saveHost() {
    if (this.hostClientId == null) this.state.storage.delete("hostClientId");
    else this.state.storage.put("hostClientId", this.hostClientId);
  }
  saveStarted() {
    this.state.storage.put("started", this.started);
  }
  saveSync() {
    this.lastSyncSaveAt = Date.now();
    if (this.syncState == null) {
      this.state.storage.delete("syncState");
      this.state.storage.delete("syncStateAt");
    } else {
      this.state.storage.put("syncState", this.syncState);
      if (this.syncStateAt != null) this.state.storage.put("syncStateAt", this.syncStateAt);
    }
  }
  saveAway() {
    if (this.away.size === 0) this.state.storage.delete("away");
    else this.state.storage.put("away", [...this.away]);
  }
  scheduleAlarm() {
    const due = [...this.away.values()].map((a) => a.until);
    if (this.hostAwayUntil != null) due.push(this.hostAwayUntil);
    if (due.length > 0) this.state.storage.setAlarm(Math.min(...due));
    else this.state.storage.deleteAlarm();
  }
  isPresent(clientId) {
    return [...this.peers.values()].some((p) => p.clientId === clientId);
  }
  startHostGrace() {
    this.hostAwayUntil = Date.now() + HOST_GRACE_MS;
    this.state.storage.put("hostAwayUntil", this.hostAwayUntil);
    this.scheduleAlarm();
    this.broadcast({ t: "host-away", clientId: this.hostClientId });
  }
  endHostGrace() {
    if (this.hostAwayUntil == null) return;
    this.hostAwayUntil = null;
    this.state.storage.delete("hostAwayUntil");
    this.scheduleAlarm();
  }
  async alarm() {
    const now = Date.now();
    let hostGone = false;
    for (const [clientId, entry] of this.away) {
      if (entry.until > now) continue;
      this.away.delete(clientId);
      this.broadcast({ t: "participant-left", clientId, name: entry.name });
      if (clientId === this.hostClientId) hostGone = true;
    }
    this.saveAway();
    if (this.hostAwayUntil != null && now >= this.hostAwayUntil) {
      this.hostAwayUntil = null;
      this.state.storage.delete("hostAwayUntil");
      hostGone = true;
    }
    if (hostGone && !this.isPresent(this.hostClientId) && !this.away.has(this.hostClientId))
      this.reassignHost();
    this.scheduleAlarm();
  }
  attach(ws, peer) {
    try {
      ws.serializeAttachment(peerAttachment(peer));
    } catch {
      /* attachment too large or unsupported */
    }
  }

  async fetch(_req) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    let msg;
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      msg = JSON.parse(text);
    } catch {
      return;
    }
    this.onMessage(ws, msg);
  }

  webSocketClose(ws, code) {
    // 1001 is the browser or app closing the page: a quit, not a dropped
    // connection, so nobody should be held up waiting for them.
    if (code === 1001) this.handleLeave(ws);
    else this.onClose(ws);
  }

  webSocketError(ws) {
    this.onClose(ws);
  }

  onMessage(socket, msg) {
    this.lastActivity = Date.now();
    switch (msg.t) {
      case "hello":
        return this.handleHello(socket, msg);
      case "profile":
        return this.handleProfile(socket, msg);
      case "leave":
        return this.handleLeave(socket);
      case "state":
        return this.handleState(socket, msg);
      case "cmd":
        return this.handleCommand(socket, msg);
      case "chat":
        return this.handleChat(socket, msg);
      case "invite":
        return this.handleInvite(socket, msg);
      case "ready":
        return this.handleReady(socket, msg);
      case "host-leaving":
        return this.handleHostLeaving(socket);
      case "claim-host":
        return this.handleClaimHost(socket, msg);
      case "start":
        return this.handleStart(socket);
      case "summon":
        return this.handleSummon(socket, msg);
      case "cursor":
        return this.handleCursor(socket, msg);
      case "draw":
        return this.handleDraw(socket, msg);
      case "presence":
        return this.handlePresence(socket, msg);
      case "status":
        return this.handleStatus(socket, msg);
      case "react":
        return this.handleReact(socket, msg);
      case "ping":
        return this.send(socket, { t: "pong", srvAt: Date.now() });
    }
  }

  handleReady(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    peer.ready = !!msg.ready;
    this.attach(socket, peer);
    this.broadcast({ t: "participant-ready", clientId: peer.clientId, ready: peer.ready });
  }

  handleStatus(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !SYNC_PHASES.has(msg.phase)) return;
    const offset = sanitizeOffset(msg.offset);
    // Nothing new to tell the room: same phase and the same distance from the host.
    if (peer.status === msg.phase && peer.offset === offset) return;
    peer.status = msg.phase;
    peer.offset = offset;
    this.attach(socket, peer);
    this.broadcast({
      t: "participant-status",
      clientId: peer.clientId,
      phase: peer.status,
      ...(peer.offset != null && { offset: peer.offset }),
    });
  }

  handleReact(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !REACTIONS.has(msg.emoji)) return;
    const now = Date.now();
    peer.reactedAt = (peer.reactedAt ?? []).filter((at) => now - at < REACTION_WINDOW_MS);
    if (peer.reactedAt.length >= REACTION_BURST) return;
    peer.reactedAt.push(now);
    this.broadcast(
      { t: "reaction", from: peer.clientId, name: peer.name, emoji: msg.emoji, at: now },
      socket,
    );
  }

  handleClaimHost(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (this.hostClientId === peer.clientId && !msg.fresh) return;
    this.endHostGrace();
    this.hostClientId = peer.clientId;
    this.saveHost();
    this.broadcast({ t: "host", hostClientId: this.hostClientId });
    if (msg.fresh) {
      this.started = false;
      this.saveStarted();
      this.broadcast({ t: "started", started: false });
      for (const [s, p] of this.peers) {
        p.ready = false;
        this.attach(s, p);
        this.broadcast({ t: "participant-ready", clientId: p.clientId, ready: false });
      }
    }
  }

  handleStart(socket) {
    const peer = this.peers.get(socket);
    if (!peer || this.hostClientId !== peer.clientId) return;
    this.started = true;
    this.saveStarted();
    this.broadcast({ t: "started", started: true });
  }

  handleSummon(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !msg.target) return;
    const t = msg.target;
    const okMeta = typeof t.mediaId === "string" && t.mediaId.length > 0 && t.mediaId.length <= 256;
    const okView =
      typeof t.view === "string" &&
      ["home", "discover", "anime", "queue", "addons"].includes(t.view);
    if (!okMeta && !okView) return;
    this.broadcast(
      {
        t: "summon",
        from: peer.clientId,
        name: peer.name,
        target: t,
        at: Date.now(),
      },
      socket,
    );
  }

  handleCursor(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
    this.broadcast(
      {
        t: "cursor",
        from: peer.clientId,
        name: peer.name,
        x: msg.x,
        y: msg.y,
        visible: !!msg.visible,
        path: typeof msg.path === "string" ? msg.path : "",
      },
      socket,
    );
  }

  handleDraw(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    const phase =
      msg.phase === "start" || msg.phase === "point" || msg.phase === "end" || msg.phase === "clear"
        ? msg.phase
        : null;
    if (!phase) return;
    const strokeId = typeof msg.strokeId === "string" ? msg.strokeId : "";
    if (phase !== "clear" && (strokeId.length === 0 || strokeId.length > 64)) return;
    this.broadcast(
      {
        t: "draw",
        from: peer.clientId,
        name: peer.name,
        strokeId,
        phase,
        x: typeof msg.x === "number" ? msg.x : undefined,
        y: typeof msg.y === "number" ? msg.y : undefined,
        color: typeof msg.color === "string" ? msg.color.slice(0, 32) : undefined,
        path: typeof msg.path === "string" ? msg.path : "",
      },
      socket,
    );
  }

  handlePresence(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.broadcast(
      {
        t: "presence",
        from: peer.clientId,
        activeAt: Date.now(),
        location: msg && typeof msg.location === "object" ? msg.location : undefined,
      },
      socket,
    );
  }

  handleHostLeaving(socket) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (this.hostClientId !== peer.clientId) return;
    this.broadcast(
      { t: "host-leaving", from: peer.clientId, name: peer.name, at: Date.now() },
      socket,
    );
    this.reassignHost(peer.clientId);
  }

  reassignHost(excludeClientId) {
    this.endHostGrace();
    let next = null;
    for (const p of this.peers.values()) {
      if (excludeClientId && p.clientId === excludeClientId) continue;
      if (!next || p.joinedAt < next.joinedAt) next = p;
    }
    this.hostClientId = next ? next.clientId : null;
    this.saveHost();
    this.broadcast({ t: "host", hostClientId: this.hostClientId });
  }

  handleHello(socket, msg) {
    if (!msg.clientId) {
      this.send(socket, { t: "error", code: "missing_client_id", message: "clientId required" });
      try {
        socket.close(1008, "missing_client_id");
      } catch {}
      return;
    }
    const name = (msg.name || "Guest").toString().slice(0, 32);
    const avatar = sanitizeAvatar(msg.avatar);
    const color = sanitizeColor(msg.color);
    const peer = {
      clientId: msg.clientId,
      name,
      joinedAt: Date.now(),
      ready: false,
      avatar,
      color,
      lastStateAt: 0,
    };
    for (const [s, p] of this.peers) {
      if (p.clientId === msg.clientId && s !== socket) {
        try {
          s.close(1000, "replaced");
        } catch {}
        this.peers.delete(s);
      }
    }
    this.peers.set(socket, peer);
    this.attach(socket, peer);
    const becameHost = !this.hostClientId;
    if (becameHost) {
      this.hostClientId = peer.clientId;
      this.saveHost();
    }
    const wasAway = this.away.delete(peer.clientId);
    if (wasAway) {
      this.saveAway();
      this.scheduleAlarm();
    }
    const hostReturned =
      peer.clientId === this.hostClientId && (wasAway || this.hostAwayUntil != null);
    if (hostReturned) this.endHostGrace();
    const statuses = {};
    const offsets = {};
    for (const p of this.peers.values()) {
      if (p.status) statuses[p.clientId] = p.status;
      if (p.offset != null) offsets[p.clientId] = p.offset;
    }
    const participants = Array.from(this.peers.values()).map((p) => ({
      id: p.clientId,
      name: p.name,
      joinedAt: p.joinedAt,
      ready: !!p.ready,
      avatar: p.avatar ?? null,
      color: p.color ?? null,
    }));
    for (const [clientId, entry] of this.away)
      participants.push({
        id: clientId,
        name: entry.name,
        joinedAt: entry.joinedAt,
        ready: false,
        avatar: null,
        color: entry.color ?? null,
        away: true,
      });
    this.send(socket, {
      t: "joined",
      room: "",
      participants,
      state: this.syncState,
      hostClientId: this.hostClientId,
      started: this.started,
      srvAt: Date.now(),
      ...(this.syncStateAt != null && { observedAt: this.syncStateAt }),
      statuses,
      offsets,
      hostAway: this.hostAwayUntil != null || this.away.has(this.hostClientId),
      relayVersion: WORKER_VERSION,
    });
    this.broadcast(
      {
        t: "participant-joined",
        participant: {
          id: peer.clientId,
          name: peer.name,
          joinedAt: peer.joinedAt,
          ready: false,
          avatar: peer.avatar,
          color: peer.color,
        },
      },
      socket,
    );
    if (becameHost || hostReturned)
      this.broadcast({ t: "host", hostClientId: this.hostClientId }, socket);
  }

  handleProfile(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (typeof msg.name === "string") peer.name = msg.name.slice(0, 32);
    peer.avatar = sanitizeAvatar(msg.avatar);
    peer.color = sanitizeColor(msg.color);
    this.attach(socket, peer);
    this.broadcast({
      t: "participant-profile",
      participant: {
        id: peer.clientId,
        name: peer.name,
        avatar: peer.avatar,
        color: peer.color,
      },
    });
  }

  handleLeave(socket) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    // The throttle may be holding back the newest state; keep it if the room goes idle.
    if (this.syncState && this.lastSyncSaveAt < (this.syncStateAt ?? 0)) this.saveSync();
    this.broadcast({ t: "participant-left", clientId: peer.clientId, name: peer.name });
    if (this.hostClientId === peer.clientId) this.reassignHost();
    try {
      socket.close(1000, "left");
    } catch {}
  }

  handleState(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !msg.state) return;
    const s = msg.state;
    if (
      typeof s.positionSeconds !== "number" ||
      !isFinite(s.positionSeconds) ||
      s.positionSeconds < 0
    )
      return;
    if (typeof s.updatedAt !== "number" || !isFinite(s.updatedAt)) return;
    if (typeof s.playing !== "boolean") return;
    if (s.mediaId != null && typeof s.mediaId !== "string") return;
    if (s.mediaTitle != null && typeof s.mediaTitle !== "string") return;
    if (s.posterUrl != null && typeof s.posterUrl !== "string") return;
    if (
      s.episode != null &&
      !(
        typeof s.episode === "object" &&
        typeof s.episode.season === "number" &&
        typeof s.episode.episode === "number"
      )
    )
      return;
    if (typeof s.updatedBy !== "string" || s.updatedBy !== peer.clientId) return;
    const cleanSource = sanitizeSource(s.source);
    if (cleanSource) s.source = cleanSource;
    else delete s.source;
    if (s.guestPick !== true) delete s.guestPick;
    if (s.waitOnDrop !== true) delete s.waitOnDrop;
    if (s.hostOnly !== true) delete s.hostOnly;
    const cause = sanitizeCause(s.cause);
    if (cause) s.cause = cause;
    else delete s.cause;
    const isHostWrite = this.hostClientId != null && peer.clientId === this.hostClientId;
    if (this.hostClientId != null && !isHostWrite) return;
    const now = Date.now();
    if (!isHostWrite) {
      if (now - peer.lastStateAt < 500) return;
      if (this.syncState && s.updatedAt < this.syncState.updatedAt - 2000) return;
    }
    peer.lastStateAt = now;
    const stamped = { ...s, hostClientId: this.hostClientId };
    const prev = this.syncState;
    const changed =
      !prev ||
      prev.mediaId !== stamped.mediaId ||
      prev.playing !== stamped.playing ||
      prev.buffering !== stamped.buffering ||
      prev.waitOnDrop !== stamped.waitOnDrop ||
      prev.episode?.season !== stamped.episode?.season ||
      prev.episode?.episode !== stamped.episode?.episode ||
      // A seek while paused changes nothing else and no heartbeat moves it on.
      (!stamped.playing && prev.positionSeconds !== stamped.positionSeconds);
    this.syncState = stamped;
    this.syncStateAt = now;
    if (changed || now - this.lastSyncSaveAt >= SYNC_SAVE_MS) this.saveSync();
    this.broadcast({ t: "state", state: stamped, srvAt: now }, socket);
  }

  handleCommand(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !msg.command || typeof msg.command.action !== "string") return;
    const c = msg.command;
    if (c.action !== "play" && c.action !== "pause" && c.action !== "seek") return;
    if (
      c.action === "seek" &&
      (typeof c.positionSeconds !== "number" ||
        !isFinite(c.positionSeconds) ||
        c.positionSeconds < 0)
    )
      return;
    if (c.seq != null && (typeof c.seq !== "number" || !isFinite(c.seq))) delete c.seq;
    if (c.at != null && (typeof c.at !== "number" || !isFinite(c.at))) delete c.at;
    if (!this.hostClientId || peer.clientId === this.hostClientId) return;
    for (const [s, p] of this.peers) {
      if (p.clientId === this.hostClientId) {
        this.send(s, { t: "cmd", from: peer.clientId, command: c });
        return;
      }
    }
  }

  handleChat(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    const text = (msg.text || "").toString().trim().slice(0, 500);
    if (!text) return;
    this.broadcast({ t: "chat", from: peer.clientId, name: peer.name, text, at: Date.now() });
  }

  handleInvite(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer || !msg.invite || !msg.invite.mediaId) return;
    const inv = msg.invite;
    if (typeof inv.mediaId !== "string" || inv.mediaId.length > 256) return;
    if ((inv.posterUrl?.length ?? 0) > 2000) return;
    if ((inv.backgroundUrl?.length ?? 0) > 2000) return;
    if ((inv.logoUrl?.length ?? 0) > 2000) return;
    if ((inv.mediaTitle?.length ?? 0) > 300) return;
    const cleanSource = sanitizeSource(inv.source);
    if (cleanSource) inv.source = cleanSource;
    else delete inv.source;
    if (inv.guestPick !== true) delete inv.guestPick;
    if (!Number.isInteger(inv.proto) || inv.proto < 0 || inv.proto > 99) delete inv.proto;
    this.broadcast(
      { t: "invite", from: peer.clientId, name: peer.name, invite: inv, at: Date.now() },
      socket,
    );
  }

  onClose(socket) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    // The throttle may be holding back the newest state; keep it if the room goes idle.
    if (this.syncState && this.lastSyncSaveAt < (this.syncStateAt ?? 0)) this.saveSync();
    if (this.peers.size === 0 && this.away.size > 0) {
      // Nobody is left to wait; an away host must not keep the role in an empty room.
      const hostWasAway = this.away.has(this.hostClientId);
      this.away.clear();
      this.saveAway();
      this.scheduleAlarm();
      if (hostWasAway) this.reassignHost();
    }
    // The host chose to wait for people who drop: keep this one in the room
    // (and in the host role) for a while instead of announcing that they left.
    if (this.peers.size > 0 && this.syncState?.waitOnDrop === true) {
      const until = Date.now() + AWAY_GRACE_MS;
      this.away.set(peer.clientId, { ...peerAttachment(peer), until });
      this.saveAway();
      this.scheduleAlarm();
      this.broadcast({ t: "participant-away", clientId: peer.clientId });
      return;
    }
    this.broadcast({ t: "participant-left", clientId: peer.clientId, name: peer.name });
    if (this.hostClientId === peer.clientId) {
      if (this.peers.size > 0) this.startHostGrace();
      else this.reassignHost();
    }
    if (this.peers.size === 0 && Date.now() - this.lastActivity > ROOM_IDLE_MS) {
      this.syncState = null;
      this.hostClientId = null;
      this.saveSync();
      this.saveHost();
    }
  }

  send(socket, msg) {
    try {
      socket.send(JSON.stringify(msg));
    } catch {}
  }

  broadcast(msg, except) {
    const payload = JSON.stringify(msg);
    for (const [s] of this.peers) {
      if (s === except) continue;
      try {
        s.send(payload);
      } catch (e) {
        console.error("[relay] broadcast send failed", e);
      }
    }
  }
}
