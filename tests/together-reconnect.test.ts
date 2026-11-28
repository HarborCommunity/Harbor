import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness(avatar: string | null = null) {
  let now = 100000,
    nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void; repeat?: number }>();
  const timer = (fn: () => void, ms: number, repeat?: number) => {
    timers.set(++nextId, { at: now + ms, fn, repeat });
    return nextId;
  };
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent: any[] = [];
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    url: string;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    send(raw: string) {
      assert.equal(this.readyState, 1);
      this.sent.push(JSON.parse(raw));
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    message(msg: any) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
    close() {
      this.readyState = 3;
      timer(() => this.onclose?.(), 0);
    }
  }
  const compiled = ts.transpileModule(
    readFileSync(new URL("../src/lib/together/client.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const exports: any = {};
  new Function("require", "exports", "window", "WebSocket", "Date", "Math", compiled)(
    (name: string) =>
      name === "./protocol"
        ? { WT_PROTO: 1 }
        : { diagnoseRelayFailure: async () => "fixture unavailable" },
    exports,
    {
      setTimeout: timer,
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: (fn: () => void, ms: number) => timer(fn, ms, ms),
      clearInterval: (id: number) => timers.delete(id),
    },
    Socket,
    { now: () => now },
    Object.assign(Object.create(Math), { random: () => 0 }),
  );
  const client = new exports.TogetherClient("https://relay.test", "self", "Fixture", avatar);
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const first = [...timers]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      const [id, t] = first;
      now = t.at;
      if (t.repeat) t.at += t.repeat;
      else timers.delete(id);
      t.fn();
    }
    now = target;
  };
  const joined = (socket = sockets.at(-1)!) => {
    socket.open();
    socket.message({
      t: "joined",
      participants: [{ id: "self", name: "Fixture" }],
      hostClientId: "self",
      state: null,
      started: true,
      srvAt: now,
    });
  };
  return { client, sockets, advance, joined };
}

test("the avatar handshake is the first frame on initial connect and reconnect", () => {
  const avatar = "data:image/png;base64," + "A".repeat(50000);
  const h = harness(avatar);
  h.client.join("ABC123");
  h.joined();
  const first = h.sockets[0];
  assert.ok(JSON.stringify(first.sent[0]).length > 32 * 1024);
  assert.equal(first.sent[0].t, "hello");
  assert.equal(first.sent[0].avatar, avatar);
  assert.equal(first.sent[1].t, "ping");
  first.close();
  h.advance(1000);
  h.joined();
  assert.equal(h.sockets[1].sent[0].t, "hello");
  assert.equal(h.sockets[1].sent[0].avatar, avatar);
});

test("an established room reconnects after the socket drops", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  const first = h.sockets[0];
  h.client.claimHost(false);
  h.client.sendInvite({ mediaId: "tt123", mediaTitle: "Fixture" });
  first.close();
  h.advance(0);
  assert.equal(h.client.getSnapshot().state, "connecting");
  h.advance(1000);
  assert.equal(h.sockets.length, 2);
  h.joined();
  const next = h.sockets[1];
  assert.equal(h.client.getSnapshot().state, "joined");
  assert.equal(h.client.getSnapshot().room, "ABC123");
  assert.equal(next.url, first.url);
  assert.ok(next.sent.some((m) => m.t === "hello" && m.clientId === "self"));
  assert.ok(next.sent.some((m) => m.t === "claim-host"));
  assert.ok(next.sent.some((m) => m.t === "invite" && m.invite.mediaId === "tt123"));
});

test("a silent established connection also reconnects after liveness timeout", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.advance(51000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.client.getSnapshot().state, "connecting");
  h.joined();
  assert.equal(h.client.getSnapshot().state, "joined");
});

test("leaving a joined room does not reconnect", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.client.leave();
  h.advance(60000);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.client.getSnapshot().state, "disconnected");
  assert.equal(h.client.getSnapshot().room, null);
});

test("late events from an old room cannot close or corrupt the new connection", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  const old = h.sockets[0];
  h.client.join("XYZ789");
  const current = h.sockets[1];
  old.onerror?.();
  old.message({ t: "error", message: "old room" });
  h.advance(0);
  assert.equal(current.readyState, 0);
  assert.equal(h.client.getSnapshot().lastError, null);
  h.joined(current);
  h.advance(1000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.client.getSnapshot().room, "XYZ789");
  assert.equal(h.client.getSnapshot().state, "joined");
});

test("initial connection failures still stop after the existing retry limit", async () => {
  const h = harness();
  h.client.join("ABC123");
  for (let i = 0; i < 4; i++) {
    h.sockets.at(-1)!.close();
    h.advance(i === 3 ? 0 : 1000 * 2 ** i);
  }
  await Promise.resolve();
  assert.equal(h.sockets.length, 4);
  assert.equal(h.client.getSnapshot().state, "error");
  assert.equal(h.client.getSnapshot().lastError, "fixture unavailable");
  h.advance(60000);
  assert.equal(h.sockets.length, 4);
});

test("duplicate close callbacks schedule only one reconnect", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  const first = h.sockets[0];
  first.close();
  first.close();
  h.advance(1000);
  assert.equal(h.sockets.length, 2);
  h.joined();
  h.advance(1000);
  assert.equal(h.sockets.length, 2);
});

test("a viewer already playing the room's media is not invited again on rejoin", () => {
  const h = harness();
  const invites: any[] = [];
  h.client.on((e: any) => {
    if (e.kind === "invite") invites.push(e.invite);
  });
  h.client.setActivePlayback("tt9|1|2");
  h.client.join("ABC123");
  const socket = h.sockets.at(-1)!;
  socket.open();
  const joinedWith = (episode: number) =>
    socket.message({
      t: "joined",
      participants: [
        { id: "self", name: "Fixture" },
        { id: "host", name: "Host" },
      ],
      hostClientId: "host",
      state: {
        mediaId: "tt9",
        mediaTitle: "Show",
        episode: { season: 1, episode },
        posterUrl: null,
        positionSeconds: 10,
        playing: true,
        updatedAt: 0,
        updatedBy: "host",
        hostClientId: "host",
      },
      started: true,
      srvAt: 100000,
    });
  joinedWith(2);
  assert.equal(invites.length, 0);
  socket.message({
    t: "invite",
    from: "host",
    name: "Host",
    invite: { mediaId: "tt9", episode: { season: 1, episode: 2 } },
    at: 1,
  });
  assert.equal(invites.length, 0);
  joinedWith(3);
  assert.equal(invites.length, 1);
});

test("guest commands sent while disconnected go out once the room is back", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.sockets[0].close();
  h.advance(0);
  h.client.sendCommand({ action: "seek", positionSeconds: 5 });
  h.client.sendCommand({ action: "pause" });
  h.advance(1000);
  h.joined();
  const commands = h.sockets[1].sent.filter((m) => m.t === "cmd");
  assert.deepEqual(
    commands.map((m) => m.command),
    [{ action: "pause" }],
  );
});

test("a state held back after a sync is not published into the next room", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.client.suppressOutgoingFor(1400);
  h.client.publishState({
    mediaId: "tt1",
    mediaTitle: "Old room",
    episode: null,
    posterUrl: null,
    positionSeconds: 42,
    playing: true,
    updatedAt: 100000,
    updatedBy: "self",
    hostClientId: null,
  });
  h.client.leave();
  h.client.join("XYZ789");
  h.joined();
  h.advance(2000);
  assert.deepEqual(
    h.sockets.at(-1)!.sent.filter((m) => m.t === "state"),
    [],
  );
});

test("a command queued while offline never reaches a room joined afterwards", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.sockets[0].close();
  h.advance(0);
  h.client.sendCommand({ action: "pause" });
  h.client.leave();
  h.client.join("XYZ789");
  h.joined();
  assert.deepEqual(
    h.sockets.at(-1)!.sent.filter((m) => m.t === "cmd"),
    [],
  );
});

test("a command queued during a long outage is dropped instead of moving the room back", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  h.sockets[0].close();
  h.advance(0);
  h.client.sendCommand({ action: "seek", positionSeconds: 600 });
  h.advance(30_000);
  h.joined();
  assert.deepEqual(
    h.sockets.at(-1)!.sent.filter((m) => m.t === "cmd"),
    [],
  );
});

test("while something plays the connection is pinged every 5 s and a silent one dropped within 15 s", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  const socket = h.sockets[0];
  const pings = () => socket.sent.filter((m) => m.t === "ping").length;
  h.client.setActivePlayback("tt1||");
  const before = pings();
  h.advance(10_000);
  assert.ok(pings() - before >= 2, "about one ping every 5 s");
  assert.equal(socket.readyState, 1, "12 s of silence have not passed yet");
  // The check runs on the next 5 s tick after 12 s, so well inside the old 40 s.
  h.advance(5_000);
  assert.equal(socket.readyState, 3, "a silent socket is closed and replaced");
  h.client.setActivePlayback(null);
});

test("host sample and start times are sent in relay time", () => {
  const h = harness();
  h.client.join("ABC123");
  const socket = h.sockets.at(-1)!;
  socket.open();
  socket.message({
    t: "joined",
    participants: [{ id: "self", name: "Fixture" }],
    hostClientId: "self",
    state: null,
    started: true,
    srvAt: 105000,
  });
  h.client.publishState({
    mediaId: "tt1",
    mediaTitle: null,
    episode: null,
    posterUrl: null,
    positionSeconds: 1,
    playing: true,
    sampledAt: 100000,
    playAt: 101000,
    updatedAt: 100000,
    updatedBy: "self",
    hostClientId: null,
  });
  const sent = socket.sent.find((m) => m.t === "state").state;
  assert.equal(sent.sampledAt, 105000);
  assert.equal(sent.playAt, 106000);
});

test("a guest that reconnects after a crash no longer counts as buffering", () => {
  const h = harness();
  h.client.join("ABC123");
  h.joined();
  const socket = h.sockets[0];
  socket.message({ t: "participant-joined", participant: { id: "guest", name: "Guest" } });
  socket.message({ t: "participant-status", clientId: "guest", phase: "buffering" });
  assert.equal(h.client.getSnapshot().participantStatus.guest, "buffering");
  socket.message({ t: "participant-joined", participant: { id: "guest", name: "Guest" } });
  assert.equal(h.client.getSnapshot().participantStatus.guest, undefined);
  socket.message({ t: "participant-status", clientId: "guest", phase: "buffering" });
  socket.message({ t: "participant-left", clientId: "guest" });
  assert.equal(h.client.getSnapshot().participantStatus.guest, undefined);
});
