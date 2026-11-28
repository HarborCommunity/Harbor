import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as timeline from "../src/lib/together/timeline.ts";

function harness() {
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
    },
    clientId: "host",
    src: { url: "fixture", meta: { id: "tt100", name: "Fixture" }, episode: null },
    snap: { status: "playing", buffering: false, rate: 1, durationSec: 5000 },
    bridgeRef: { current: bridge },
    hostSourceRef: { current: null },
    guestPickRef: { current: false },
    publishState: (s: any) => published.push(s),
    onIncomingCommand: () => () => {},
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
