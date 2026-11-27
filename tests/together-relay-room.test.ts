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

async function room() {
  const store = new Map<string, unknown>();
  const writes: string[] = [];
  let alarm: number | null = null;
  let ready: Promise<void> = Promise.resolve();
  const state = {
    getWebSockets: () => [],
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
    r.onMessage(socket, { t: "hello", clientId, name: clientId });
    return socket;
  };
  return { r, join, writes, alarm: () => alarm };
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
