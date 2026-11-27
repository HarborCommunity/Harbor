import assert from "node:assert/strict";
import test from "node:test";
import { Room } from "../src-tauri/relay/worker.js";

class FakeSocket {
  sent: any[] = [];
  attachment: any = null;
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {}
  serializeAttachment(value: any) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  last(t: string) {
    return this.sent.filter((m) => m.t === t).at(-1);
  }
}

async function room(shared?: { store: Map<string, unknown>; sockets: FakeSocket[] }) {
  const store = shared?.store ?? new Map<string, unknown>();
  const sockets = shared?.sockets ?? [];
  const writes: string[] = [];
  let alarm: number | null = null;
  let ready: Promise<void> = Promise.resolve();
  const state = {
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
    blockConcurrencyWhile: (fn: () => Promise<void>) => {
      ready = fn();
    },
    storage: {
      get: async (keys: string[]) => new Map(keys.map((k) => [k, store.get(k)])),
      put: (k: string, v: unknown) => {
        writes.push(k);
        store.set(k, v);
      },
      delete: (k: string) => store.delete(k),
      setAlarm: (at: number) => {
        alarm = at;
      },
      deleteAlarm: () => {
        alarm = null;
      },
    },
  };
  const r: any = new Room(state);
  await ready;
  const join = (clientId: string) => {
    const socket = new FakeSocket();
    sockets.push(socket);
    r.onMessage(socket, { t: "hello", clientId, name: clientId });
    return socket;
  };
  return { r, join, writes, alarm: () => alarm, store, sockets };
}

const stateMsg = (patch: object = {}) => ({
  t: "state",
  state: {
    mediaId: "tt1",
    positionSeconds: 10,
    playing: true,
    buffering: false,
    updatedAt: Date.now(),
    updatedBy: "host",
    ...patch,
  },
});

test("guest buffering status reaches everyone and is part of the joined snapshot", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(guest, { t: "status", phase: "buffering" });
  assert.deepEqual(host.last("participant-status"), {
    t: "participant-status",
    clientId: "guest",
    phase: "buffering",
  });
  r.onMessage(guest, { t: "status", phase: "nonsense" });
  assert.equal(host.sent.filter((m) => m.t === "participant-status").length, 1);
  const late = join("late");
  assert.deepEqual(late.last("joined").statuses, { guest: "buffering" });
});

test("a room woken from eviction keeps when its state was received and each guest's status", async () => {
  const first = await room();
  const host = first.join("host");
  const guest = first.join("guest");
  first.r.onMessage(host, stateMsg({ playing: false, positionSeconds: 42 }));
  first.r.onMessage(guest, { t: "status", phase: "buffering" });
  const receivedAt = first.r.syncStateAt;
  assert.ok(receivedAt != null);
  // The Durable Object is evicted; a new instance wakes on the same storage and sockets.
  const woken = await room({ store: first.store, sockets: first.sockets });
  const late = woken.join("late");
  const joined = late.last("joined");
  assert.equal(joined.state.positionSeconds, 42);
  assert.equal(joined.observedAt, receivedAt, "the stored state is not handed out as fresh");
  assert.deepEqual(joined.statuses, { guest: "buffering" });
});

test("a seek while paused is saved at once, and an unchanged status is not re-sent", async () => {
  const { r, join, writes } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(host, stateMsg({ playing: false, positionSeconds: 10 }));
  writes.length = 0;
  r.onMessage(host, stateMsg({ playing: false, positionSeconds: 300 }));
  assert.ok(writes.includes("syncState"), "a paused seek is not left for the periodic save");
  r.onMessage(guest, { t: "status", phase: "buffering" });
  r.onMessage(guest, { t: "status", phase: "buffering" });
  assert.equal(host.sent.filter((m) => m.t === "participant-status").length, 1);
});

test("a host that drops keeps its role through the grace period", async () => {
  const { r, join, alarm } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onClose(host);
  assert.equal(r.hostClientId, "host");
  assert.deepEqual(guest.last("host-away"), { t: "host-away", clientId: "host" });
  assert.ok(alarm() != null);
  const back = join("host");
  assert.equal(r.hostClientId, "host");
  assert.equal(alarm(), null);
  assert.equal(back.last("joined").hostAway, false);
  assert.deepEqual(guest.last("host"), { t: "host", hostClientId: "host" });
});

test("a host that does not return in time is replaced", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onClose(host);
  r.hostAwayUntil = Date.now() - 1;
  await r.alarm();
  assert.equal(r.hostClientId, "guest");
  assert.deepEqual(guest.last("host"), { t: "host", hostClientId: "guest" });
});

test("an explicit leave still hands the host role over immediately", async () => {
  const { r, join } = await room();
  const host = join("host");
  join("guest");
  r.onMessage(host, { t: "leave" });
  assert.equal(r.hostClientId, "guest");
});

test("heartbeats only write storage on changes or every few seconds", async () => {
  const { r, join, writes } = await room();
  const host = join("host");
  join("guest");
  const syncWrites = () => writes.filter((k) => k === "syncState").length;
  r.onMessage(host, stateMsg());
  r.onMessage(host, stateMsg({ positionSeconds: 11 }));
  r.onMessage(host, stateMsg({ positionSeconds: 12 }));
  assert.equal(syncWrites(), 1);
  r.onMessage(host, stateMsg({ positionSeconds: 12, playing: false }));
  assert.equal(syncWrites(), 2);
  assert.equal(r.syncState.positionSeconds, 12);
});

test("late joiners learn when the stored state was received", async () => {
  const { r, join } = await room();
  const host = join("host");
  r.onMessage(host, stateMsg());
  const late = join("late");
  assert.equal(typeof late.last("joined").observedAt, "number");
});

const dropState = (r: any, host: FakeSocket) => r.onMessage(host, stateMsg({ waitOnDrop: true }));

test("by default a dropped guest leaves the room at once", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(host, stateMsg());
  r.onClose(guest);
  assert.deepEqual(host.last("participant-left")?.clientId, "guest");
  assert.equal(host.last("participant-away"), undefined);
});

test("when the host waits for drops, a crashed guest is held as away and can return", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  dropState(r, host);
  r.onClose(guest);
  assert.deepEqual(host.last("participant-away"), { t: "participant-away", clientId: "guest" });
  assert.equal(host.last("participant-left"), undefined);
  const late = join("late");
  const awayEntry = late.last("joined").participants.find((p: any) => p.id === "guest");
  assert.equal(awayEntry.away, true);
  join("guest");
  assert.equal(r.away.size, 0);
  assert.equal(host.last("participant-joined").participant.id, "guest");
});

test("an away guest that never returns leaves after the grace period", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  dropState(r, host);
  r.onClose(guest);
  r.away.get("guest").until = Date.now() - 1;
  await r.alarm();
  assert.equal(host.last("participant-left").clientId, "guest");
});

test("a crashed host that waits for drops keeps the role while away", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  dropState(r, host);
  r.onClose(host);
  assert.equal(r.hostClientId, "host");
  assert.equal(guest.last("participant-away").clientId, "host");
  const back = join("host");
  assert.equal(r.hostClientId, "host");
  assert.equal(back.last("joined").hostAway, false);
  assert.deepEqual(guest.last("host"), { t: "host", hostClientId: "host" });
});

test("when everyone else leaves too, an away host does not keep the role in an empty room", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  dropState(r, host);
  r.onClose(host);
  r.onClose(guest);
  assert.equal(r.hostClientId, null);
  const back = join("guest");
  assert.equal(back.last("joined").hostClientId, "guest", "whoever comes back first hosts");
});

test("closing the app or page counts as leaving, not as a dropped connection", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  dropState(r, host);
  r.webSocketClose(guest, 1001);
  assert.equal(host.last("participant-left").clientId, "guest");
  assert.equal(host.last("participant-away"), undefined, "nobody waits for someone who quit");
  r.webSocketClose(host, 1006);
  assert.equal(r.away.has("host"), false, "the room is empty, so nobody is held");
});

test("an away host that never returns hands the role over", async () => {
  const { r, join } = await room();
  const host = join("host");
  join("guest");
  dropState(r, host);
  r.onClose(host);
  r.away.get("host").until = Date.now() - 1;
  await r.alarm();
  assert.equal(r.hostClientId, "guest");
});

test("reactions reach everyone else, only from the fixed set, at most five per two seconds", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(guest, { t: "react", emoji: "🔥" });
  const got = host.last("reaction");
  assert.equal(got.from, "guest");
  assert.equal(got.name, "guest");
  assert.equal(got.emoji, "🔥");
  assert.equal(guest.last("reaction"), undefined, "the sender shows its own reaction locally");
  r.onMessage(guest, { t: "react", emoji: "<script>" });
  r.onMessage(guest, { t: "react", emoji: "🍕" });
  assert.equal(host.sent.filter((m) => m.t === "reaction").length, 1);
  for (let i = 0; i < 10; i++) r.onMessage(guest, { t: "react", emoji: "😂" });
  assert.equal(host.sent.filter((m) => m.t === "reaction").length, 5);
});

test("a guest's distance from the host is relayed, kept for late joiners and cleared", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(guest, { t: "status", phase: "ready", offset: -5.04 });
  assert.deepEqual(host.last("participant-status"), {
    t: "participant-status",
    clientId: "guest",
    phase: "ready",
    offset: -5,
  });
  assert.deepEqual(join("late").last("joined").offsets, { guest: -5 });
  r.onMessage(guest, { t: "status", phase: "ready", offset: "far" });
  assert.equal(host.last("participant-status").offset, undefined);
  r.onMessage(guest, { t: "status", phase: "ready", offset: 1e9 });
  assert.equal(host.last("participant-status").offset, 3600);
});

test("the host's cause and lock are passed on only when well formed", async () => {
  const { r, join } = await room();
  const host = join("host");
  const guest = join("guest");
  r.onMessage(
    host,
    stateMsg({
      hostOnly: true,
      cause: { by: "guest", action: "pause", id: 7, extra: "x".repeat(10) },
    }),
  );
  const ok = guest.last("state").state;
  assert.equal(ok.hostOnly, true);
  assert.deepEqual(ok.cause, { by: "guest", action: "pause", id: 7 });
  r.onMessage(
    host,
    stateMsg({ hostOnly: "yes", cause: { by: "guest", action: "explode", id: 8 } }),
  );
  const bad = guest.last("state").state;
  assert.equal(bad.hostOnly, undefined);
  assert.equal(bad.cause, undefined);
});
