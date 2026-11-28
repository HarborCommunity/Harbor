import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as timeline from "../src/lib/together/timeline.ts";

function harness(options: { relayVersion?: number; dropPolicy?: string } = {}) {
  let now = 100_000;
  let position = 50;
  const refs: any[] = [];
  const effects: any[] = [];
  let refIndex = 0;
  let effectIndex = 0;
  const pending: (() => void)[] = [];
  const timers: { id: number; fn: () => void; at: number; every?: number }[] = [];
  let nextTimer = 0;
  const published: any[] = [];
  const calls: string[] = [];
  const bridge = {
    play: async () => {
      calls.push("play");
    },
    pause: () => {
      calls.push("pause");
    },
    seek: () => {
      calls.push("seek");
    },
  };
  const params: any = {
    inRoom: true,
    isHost: true,
    hasStarted: true,
    roomSnapshot: {
      participants: [
        { id: "host", name: "Host" },
        { id: "guest", name: "Guest" },
      ],
      participantStatus: {},
      relayVersion: options.relayVersion ?? 11,
    },
    clientId: "host",
    src: { url: "fixture", meta: { id: "tt100", name: "Fixture" }, episode: null },
    snap: { status: "playing", buffering: false, rate: 1, durationSec: 5000 },
    bridgeRef: { current: bridge },
    hostSourceRef: { current: null },
    guestPickRef: { current: false },
    publishState: (s: any) => published.push(s),
    onIncomingCommand: () => () => {},
    dropPolicy: options.dropPolicy,
  };
  const mocks: Record<string, any> = {
    react: {
      useCallback: (fn: any) => fn,
      useState: (initial: any) => [initial, () => {}],
      useRef: (current: any) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
      useEffect: (fn: any, deps?: any[]) => {
        const index = effectIndex++;
        const old = effects[index];
        if (
          old &&
          deps &&
          deps.length === old.deps.length &&
          deps.every((v: any, i: number) => Object.is(v, old.deps[i]))
        )
          return;
        pending.push(() => {
          old?.cleanup?.();
          effects[index] = { deps: deps ?? [], cleanup: fn() };
        });
      },
    },
    "@/lib/player/playback-clock": { getPlaybackPosition: () => position },
    "@/lib/together/protocol": { RELAY_SYNC_STATUS_VERSION: 12 },
    "@/lib/together/timeline": timeline,
    "../player-utils": { HOST_HEARTBEAT_MS: 1000, SEEK_APPLY_DEBOUNCE_MS: 120 },
  };
  const source = readFileSync("src/views/player/hooks/use-room-host-sync.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  const addTimer = (fn: () => void, ms: number, every?: number) => {
    timers.push({ id: ++nextTimer, fn, at: now + ms, every });
    return nextTimer;
  };
  const removeTimer = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  new Function("require", "exports", "Date", "window", code)(
    (name: string) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    exports,
    { now: () => now },
    {
      setTimeout: (fn: () => void, ms: number) => addTimer(fn, ms),
      clearTimeout: removeTimer,
      setInterval: (fn: () => void, ms: number) => addTimer(fn, ms, ms),
      clearInterval: removeTimer,
    },
  );
  let result: any;
  const render = () => {
    refIndex = effectIndex = 0;
    result = exports.useRoomHostSync(params);
    while (pending.length) pending.shift()!();
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every;
      else removeTimer(due.id);
      due.fn();
    }
    now = target;
  };
  return {
    params,
    published,
    calls,
    render,
    advance,
    start: () => result.startTogether(),
    skip: () => result.skipWaiting(),
    position: (n: number) => {
      position = n;
    },
    now: () => now,
  };
}

test("buffering is published at once as a stopped timeline", () => {
  const h = harness();
  h.render();
  assert.equal(h.published.length, 1);
  h.params.snap = { ...h.params.snap, buffering: true };
  h.render();
  const last = h.published.at(-1);
  assert.equal(last.playing, false);
  assert.equal(last.buffering, true);
  assert.equal(last.sampledAt, h.now());
});

test("a pause goes out immediately instead of on the next heartbeat", () => {
  const h = harness();
  h.render();
  h.advance(300);
  h.position(50.3);
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  assert.equal(h.published.length, 2);
  assert.equal(h.published.at(-1).playing, false);
  assert.equal(h.published.at(-1).positionSeconds, 50.3);
});

test("matching playback sends only the heartbeat", () => {
  const h = harness();
  h.render();
  for (let i = 1; i <= 8; i++) {
    h.position(50 + i * 0.25);
    h.advance(250);
  }
  assert.equal(h.published.length, 3);
});

test("rapid seeks settle before one anchor goes out", () => {
  const h = harness();
  h.render();
  h.position(60);
  h.advance(250);
  h.position(70);
  h.advance(250);
  const before = h.published.length;
  h.advance(250);
  h.advance(250);
  assert.equal(h.published.length, before + 1);
  assert.ok(Math.abs(h.published.at(-1).positionSeconds - 70) < 0.01);
});

test("start schedules the host and the room for the same instant", () => {
  const h = harness();
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  h.published.length = 0;
  h.start();
  const scheduled = h.published.at(-1);
  assert.equal(scheduled.playing, true);
  assert.equal(scheduled.playAt, h.now() + 1500);
  h.advance(1400);
  assert.ok(!h.calls.includes("play"));
  assert.equal(h.published.length, 1);
  h.advance(100);
  assert.ok(h.calls.includes("play"));
});

test("a buffering guest pauses the room and everyone resumes together", () => {
  const h = harness({ relayVersion: 12 });
  h.render();
  h.params.roomSnapshot = {
    ...h.params.roomSnapshot,
    participantStatus: { guest: "buffering" },
  };
  h.render();
  assert.ok(h.calls.includes("pause"));
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  h.params.roomSnapshot = { ...h.params.roomSnapshot, participantStatus: { guest: "ready" } };
  h.render();
  const resume = h.published.at(-1);
  assert.equal(resume.playing, true);
  assert.equal(resume.playAt, h.now() + 600);
  h.advance(600);
  assert.ok(h.calls.includes("play"));
});

test("older relays never pause the room for guests", () => {
  const h = harness({ relayVersion: 11 });
  h.render();
  h.params.roomSnapshot = {
    ...h.params.roomSnapshot,
    participantStatus: { guest: "buffering" },
  };
  h.render();
  assert.ok(!h.calls.includes("pause"));
});

const bufferingGuest = (h: ReturnType<typeof harness>) => {
  h.params.roomSnapshot = { ...h.params.roomSnapshot, participantStatus: { guest: "buffering" } };
  h.render();
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
};

test("a buffering guest that leaves releases the room at once", () => {
  const h = harness({ relayVersion: 12 });
  h.params.roomSnapshot.participants.push({ id: "third", name: "Third" });
  h.render();
  bufferingGuest(h);
  h.params.roomSnapshot = {
    ...h.params.roomSnapshot,
    participants: h.params.roomSnapshot.participants.filter((p: any) => p.id !== "guest"),
    participantStatus: {},
  };
  h.render();
  assert.equal(h.published.at(-1).playAt, h.now() + 600);
  h.advance(600);
  assert.ok(h.calls.includes("play"));
});

test("the host resumes on its own when the only waiting guest leaves the room", () => {
  const h = harness({ relayVersion: 12 });
  h.render();
  bufferingGuest(h);
  h.params.inRoom = false;
  h.render();
  assert.ok(h.calls.includes("play"));
});

test("a crashed guest stops holding the room after the wait limit", () => {
  const h = harness({ relayVersion: 12 });
  h.render();
  bufferingGuest(h);
  h.advance(15_000);
  assert.ok(!h.calls.includes("play"));
  h.advance(1000);
  h.advance(600);
  assert.ok(h.calls.includes("play"));
});

test("a guest who keeps stalling stops pausing the room once its budget for the title is spent", () => {
  const h = harness({ relayVersion: 12 });
  h.render();
  const status = (phase: string) => {
    h.params.roomSnapshot = { ...h.params.roomSnapshot, participantStatus: { guest: phase } };
    h.render();
  };
  bufferingGuest(h);
  h.advance(10_000);
  // Recovers after 10 s: the room resumes together.
  status("ready");
  h.advance(1000);
  h.params.snap = { ...h.params.snap, status: "playing" };
  h.render();
  // Stalls again: 5 s of the 15 s budget are left.
  h.calls.length = 0;
  status("buffering");
  assert.ok(h.calls.includes("pause"), "a later stall still waits while budget remains");
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  h.calls.length = 0;
  h.advance(6000);
  h.advance(600);
  assert.ok(h.calls.includes("play"), "the budget ran out and the room carries on");
  h.params.snap = { ...h.params.snap, status: "playing" };
  status("ready");
  h.calls.length = 0;
  status("buffering");
  h.advance(2000);
  assert.ok(!h.calls.includes("pause"), "a skipped guest no longer stops everyone");
  // A new title gives the budget back.
  h.params.src = { ...h.params.src, meta: { id: "tt200", name: "Next" } };
  status("ready");
  status("buffering");
  h.advance(1000);
  assert.ok(h.calls.includes("pause"));
});

const withGuest = (h: ReturnType<typeof harness>, patch: object) => {
  h.params.roomSnapshot = {
    ...h.params.roomSnapshot,
    participants: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest", ...patch },
    ],
  };
  h.render();
};

test("the host announces whether the room waits for people who drop", () => {
  const keep = harness({ relayVersion: 12, dropPolicy: "keep-playing" });
  keep.render();
  assert.equal(keep.published.at(-1).waitOnDrop, undefined);
  const auto = harness({ relayVersion: 12, dropPolicy: "auto" });
  auto.render();
  assert.equal(auto.published.at(-1).waitOnDrop, true);
  const oldRelay = harness({ relayVersion: 11, dropPolicy: "always" });
  oldRelay.render();
  assert.equal(oldRelay.published.at(-1).waitOnDrop, undefined);
  const big = harness({ relayVersion: 12, dropPolicy: "auto" });
  for (const id of ["a", "b", "c"]) big.params.roomSnapshot.participants.push({ id, name: id });
  big.render();
  assert.equal(big.published.at(-1).waitOnDrop, undefined);
});

test("by default a dropped guest does not pause the room", () => {
  const h = harness({ relayVersion: 12 });
  h.render();
  withGuest(h, { away: true });
  assert.ok(!h.calls.includes("pause"));
});

test("with waiting on, the room pauses for a dropped guest until it is back and loaded", () => {
  const h = harness({ relayVersion: 12, dropPolicy: "always" });
  h.render();
  withGuest(h, { away: true });
  assert.ok(h.calls.includes("pause"));
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  withGuest(h, { away: false, ready: false });
  assert.ok(!h.calls.includes("play"));
  h.advance(5000);
  assert.ok(!h.calls.includes("play"));
  withGuest(h, { away: false, ready: true });
  assert.equal(h.published.at(-1).playAt, h.now() + 600);
  h.advance(600);
  assert.ok(h.calls.includes("play"));
});

test("keep watching stops waiting for a dropped guest", () => {
  const h = harness({ relayVersion: 12, dropPolicy: "always" });
  h.render();
  withGuest(h, { away: true });
  h.params.snap = { ...h.params.snap, status: "paused" };
  h.render();
  h.skip();
  h.advance(600);
  assert.ok(h.calls.includes("play"));
  h.calls.length = 0;
  h.advance(5000);
  assert.ok(!h.calls.includes("pause"));
});
