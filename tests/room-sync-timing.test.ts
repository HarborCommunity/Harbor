import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as timeline from "../src/lib/together/timeline.ts";

function harness(options: { cast?: boolean; started?: boolean; nudge?: boolean } = {}) {
  let now = 100_000;
  const refs: any[] = [],
    effects: any[] = [];
  let refIndex = 0,
    effectIndex = 0;
  const pending: (() => void)[] = [];
  const states = new Set<(state: any) => void>();
  const commands = new Set<(from: string, command: any) => void>();
  const calls: [string, number?][] = [];
  const timers: { fn: () => void; at: number }[] = [];
  let position = 0,
    buffered = 20,
    castPlaying = false;
  const bridge: any = {
    seek: (n: number) => calls.push(["seek", n]),
    play: async () => {
      calls.push(["play"]);
    },
    pause: () => {
      calls.push(["pause"]);
    },
    setRate: (n: number) => calls.push(["rate", n]),
  };
  if (options.nudge) bridge.setSyncRateFactor = (n: number) => calls.push(["factor", n]);
  const params: any = {
    inRoom: true,
    isHost: false,
    hasStarted: options.started ?? true,
    setHasStarted: () => {},
    selfFrameReadyRef: { current: true },
    roomSnapshot: { room: "ABC123", started: true, syncState: null, hostClientId: "host" },
    clientId: "guest",
    src: { url: "fixture", meta: { id: "tt100" }, episode: { season: 1, episode: 1 } },
    snap: {
      status: "playing",
      buffering: false,
      rate: 1,
      durationSec: 5000,
      videoWidth: 1280,
      videoHeight: 720,
    },
    bridgeRef: { current: bridge },
    hostSourceRef: { current: null },
    guestPickRef: { current: false },
    publishState: () => {},
    markReady: () => {},
    suppressOutgoingFor: () => {},
    setForeignNotice: () => {
      calls.push(["foreign"]);
    },
    onIncomingState: (cb: any) => {
      states.add(cb);
      return () => states.delete(cb);
    },
    onIncomingCommand: (cb: any) => {
      commands.add(cb);
      return () => commands.delete(cb);
    },
    cast: options.cast
      ? {
          activeRef: { current: true },
          getPosition: () => position,
          isPlaying: () => castPlaying,
          seek: (n: number) => {
            calls.push(["cast-seek", n]);
          },
          play: () => {
            calls.push(["cast-play"]);
          },
          pause: () => {
            calls.push(["cast-pause"]);
          },
        }
      : undefined,
  };
  const sets: any[] = [];
  const intervals: (() => void)[] = [];
  const mocks: Record<string, any> = {
    react: {
      useState: (initial: any) => [initial, (v: any) => sets.push(v)],
      useRef: (current: any) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
      useEffect: (fn: any, deps: any[]) => {
        const index = effectIndex++,
          old = effects[index];
        if (
          old &&
          deps.length === old.deps.length &&
          deps.every((v, i) => Object.is(v, old.deps[i]))
        )
          return;
        pending.push(() => {
          old?.cleanup?.();
          effects[index] = { deps, cleanup: fn() };
        });
      },
    },
    "@/lib/player/playback-clock": {
      getPlaybackPosition: () => position,
      getPlaybackBuffered: () => buffered,
    },
    "@/lib/together/protocol": { RELAY_SYNC_STATUS_VERSION: 12 },
    "@/lib/together/timeline": timeline,
    "./use-room-host-sync": {
      useRoomHostSync: () => ({
        startTogether: () => {},
        waitingFor: [],
        skipWaiting: () => {},
        countdownAt: null,
      }),
    },
    "../player-utils": {
      HOST_HEARTBEAT_MS: 1000,
      SEEK_APPLY_DEBOUNCE_MS: 120,
      SYNC_DRIFT_TOLERANCE_S: 0.6,
      SYNC_MAX_AGE_S: 30,
      SYNC_PLAY_LOOKAHEAD_S: 0.4,
      SYNC_SEEK_JUMP_S: 10,
      SYNC_SUPPRESS_MS: 1400,
    },
  };
  const source = readFileSync("src/views/player/hooks/use-room-sync.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", "Date", "window", code)(
    (name: string) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    exports,
    { now: () => now },
    {
      setInterval: (fn: () => void) => (intervals.push(fn), intervals.length),
      clearInterval: (id: number) => {
        intervals[id - 1] = () => {};
      },
      setTimeout: (fn: () => void, ms: number) => timers.push({ fn, at: now + ms }),
      clearTimeout: () => {},
    },
  );
  const render = () => {
    refIndex = effectIndex = 0;
    exports.useRoomSync(params);
    while (pending.length) pending.shift()!();
  };
  const state = (patch: any = {}) => ({
    mediaId: "tt100",
    mediaTitle: "Fixture",
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    speed: 1,
    playing: true,
    updatedAt: now - 2000,
    updatedBy: "host",
    hostClientId: "host",
    ...patch,
  });
  return {
    params,
    notices: () => sets.filter((v) => v && typeof v === "object" && "kind" in v),
    tick: () => {
      for (const fn of intervals) fn();
    },
    calls,
    render,
    state,
    emit: (patch: any = {}) => {
      for (const cb of states) cb(state(patch));
    },
    position: (n: number) => {
      position = n;
    },
    buffered: (n: number) => {
      buffered = n;
    },
    castPlaying: (v: boolean) => {
      castPlaying = v;
    },
    advance: (ms: number) => {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers.splice(0, timers.length, ...timers.filter((t) => t.at > now));
      for (const timer of due) timer.fn();
    },
    now: () => now,
    clear: () => {
      calls.length = 0;
    },
    dispose: () => {
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}

const seek = (h: ReturnType<typeof harness>, name = "seek") =>
  h.calls.find((c) => c[0] === name)?.[1];

test("playing-state projection respects the host speed and elapsed time", () => {
  for (const speed of [0.5, 1, 1.5, 2]) {
    const h = harness();
    h.render();
    h.emit({ speed });
    assert.equal(seek(h), 100 + 2.4 * speed, `speed ${speed}`);
  }
});

test("a guest joining a paused room seeks without starting playback", () => {
  const h = harness();
  h.params.roomSnapshot.syncState = h.state({ playing: false });
  h.render();
  assert.equal(seek(h), 100);
  assert.ok(h.calls.some((c) => c[0] === "pause"));
  assert.ok(!h.calls.some((c) => c[0] === "play"));
});

test("initial playing sync uses the same rate-aware projection", () => {
  const h = harness();
  h.params.roomSnapshot.syncState = h.state({ speed: 2 });
  h.render();
  assert.equal(seek(h), 104.8);
  assert.ok(h.calls.some((c) => c[0] === "play"));
});

test("switching episodes of the same series refreshes incoming media identity", () => {
  const h = harness();
  h.render();
  h.params.src = { ...h.params.src, episode: { season: 1, episode: 2 } };
  h.render();
  h.emit({ episode: { season: 1, episode: 2 } });
  assert.equal(seek(h), 102.4);
  assert.ok(!h.calls.some((c) => c[0] === "foreign"));
  h.clear();
  h.emit();
  assert.deepEqual(h.calls, [["foreign"]]);
});

test("same-series episode changes refresh the initial paused seed", () => {
  const h = harness();
  h.params.roomSnapshot.syncState = h.state({ playing: false });
  h.render();
  h.clear();
  h.params.src = { ...h.params.src, episode: { season: 1, episode: 2 } };
  h.params.roomSnapshot = {
    ...h.params.roomSnapshot,
    syncState: h.state({
      playing: false,
      positionSeconds: 240,
      episode: { season: 1, episode: 2 },
    }),
  };
  h.render();
  assert.equal(seek(h), 240);
  assert.ok(!h.calls.some((c) => c[0] === "play"));
});

test("paused heartbeats do not extrapolate time", () => {
  const h = harness();
  h.render();
  h.emit({ playing: false, speed: 2 });
  assert.equal(seek(h), 100);
});

test("future clocks, old states and end-of-file stay bounded", () => {
  const future = harness();
  future.render();
  future.emit({ updatedAt: 110000, speed: 2 });
  assert.equal(seek(future), 100.8);
  const old = harness();
  old.render();
  old.emit({ updatedAt: 0, speed: 2 });
  assert.equal(seek(old), 160.8);
  const end = harness();
  end.render();
  end.emit({ positionSeconds: 4999, speed: 2 });
  assert.equal(seek(end), 4999.75);
});

test("cast correction projects the host rate and follows same-title episode changes", () => {
  const h = harness({ cast: true });
  h.render();
  h.params.src = { ...h.params.src, episode: { season: 2, episode: 1 } };
  h.render();
  h.emit({ episode: { season: 2, episode: 1 }, speed: 2 });
  assert.equal(seek(h, "cast-seek"), 104.8);
  assert.ok(!h.calls.some((c) => c[0] === "foreign"));
});

test("states without media cannot start playback or seek", () => {
  for (const cast of [false, true]) {
    const h = harness({ cast });
    h.params.roomSnapshot.syncState = h.state({ mediaId: null });
    h.render();
    h.emit({ mediaId: null });
    assert.deepEqual(h.calls, []);
  }
});

test("leaving the room unregisters callbacks", () => {
  const h = harness();
  h.render();
  h.params.inRoom = false;
  h.render();
  h.emit();
  assert.deepEqual(h.calls, []);
});

test("small drift is left alone but host rate changes still apply", () => {
  const h = harness();
  h.render();
  h.position(104.3);
  h.emit({ speed: 2 });
  assert.deepEqual(h.calls, [["rate", 2]]);
});

test("missing or unusable rates safely fall back to normal speed", () => {
  for (const speed of [undefined, null, 0, -1, Infinity, NaN]) {
    const h = harness();
    h.params.snap.rate = 2;
    h.render();
    h.emit({ speed });
    assert.equal(seek(h), 102.4);
    assert.ok(h.calls.some((c) => c[0] === "rate" && c[1] === 1));
  }
});

test("self echoes and older states cannot seek backwards", () => {
  const h = harness();
  h.render();
  h.emit({ updatedBy: "guest" });
  assert.deepEqual(h.calls, []);
  h.emit({ updatedAt: 99000 });
  h.clear();
  h.emit({ updatedAt: 98000 });
  assert.deepEqual(h.calls, []);
});

test("changing episode retires catch-up and timestamp state from the old episode", () => {
  const h = harness();
  h.render();
  h.emit({ updatedAt: 100000, positionSeconds: 499 });
  h.clear();
  h.params.src = { ...h.params.src, episode: { season: 1, episode: 2 } };
  h.render();
  h.emit({ episode: { season: 1, episode: 2 }, updatedAt: 99000, positionSeconds: 20 });
  assert.equal(seek(h), 21.4);
});

test("catch-up does not repeatedly seek while the player is still buffering", () => {
  const h = harness();
  h.render();
  h.emit({ positionSeconds: 100 });
  h.clear();
  h.buffered(0);
  h.position(99);
  h.params.snap.status = "loading";
  h.render();
  h.emit({ positionSeconds: 100 });
  assert.equal(seek(h), undefined);
  assert.ok(h.calls.some((c) => c[0] === "play"));
});

test("a guest reports buffering after 1 s of stalling and ready once 2 s are buffered", () => {
  const h = harness();
  const sent: string[] = [];
  h.params.roomSnapshot = { ...h.params.roomSnapshot, relayVersion: 12 };
  h.params.sendStatus = (phase: string) => sent.push(phase);
  h.render();
  h.params.snap.buffering = true;
  h.render();
  h.tick();
  h.advance(500);
  h.tick();
  assert.deepEqual(sent, [], "a short hiccup is not reported");
  h.advance(600);
  h.tick();
  assert.deepEqual(sent, ["buffering"]);
  h.params.snap.buffering = false;
  h.render();
  h.buffered(1);
  h.tick();
  assert.deepEqual(sent, ["buffering"], "1 s buffered is not enough to hold up again");
  h.buffered(2.5);
  h.tick();
  assert.deepEqual(sent, ["buffering", "ready"]);
});

test("a buffering host stops guests once instead of replaying the same second", () => {
  const h = harness();
  h.render();
  h.position(100.9);
  // What a current host sends while it waits for data: a stopped timeline.
  h.emit({ positionSeconds: 100, updatedAt: 100_000, playing: false, buffering: true });
  assert.ok(h.calls.some((c) => c[0] === "pause"));
  assert.deepEqual(h.notices().at(-1), { kind: "host-buffering" }, "the guest is told why");
  assert.equal(seek(h), 100);
  h.clear();
  h.params.snap.status = "paused";
  h.render();
  h.position(100);
  for (let i = 0; i < 3; i++) {
    h.advance(1000);
    h.emit({ positionSeconds: 100, updatedAt: h.now(), playing: false, buffering: true });
  }
  assert.deepEqual(h.calls, []);
});

test("an older host that repeats a frozen playing position is treated as buffering", () => {
  const h = harness();
  h.render();
  h.position(100);
  h.emit({ positionSeconds: 100, updatedAt: h.now() });
  h.clear();
  h.advance(1000);
  h.position(101);
  h.emit({ positionSeconds: 100, updatedAt: h.now() });
  assert.ok(h.calls.some((c) => c[0] === "pause"));
  assert.equal(seek(h), 100);
});

test("a host pause snaps guests to the paused frame and resume does not seek again", () => {
  const h = harness();
  h.render();
  h.position(100.4);
  h.emit({ positionSeconds: 100.2, playing: false, updatedAt: h.now() });
  assert.equal(seek(h), 100.2);
  h.clear();
  h.params.snap.status = "paused";
  h.render();
  h.position(100.2);
  h.advance(5000);
  h.emit({ positionSeconds: 100.2, playing: true, updatedAt: h.now() });
  assert.deepEqual(h.calls, [["play"]]);
});

test("small gaps nudge the speed when the player supports it instead of seeking", () => {
  const h = harness({ nudge: true });
  h.render();
  h.position(101.5);
  h.emit({ positionSeconds: 100, updatedAt: h.now() - 2000 });
  assert.equal(seek(h), undefined);
  const factor = h.calls.find((c) => c[0] === "factor")?.[1];
  assert.ok(factor !== undefined && factor > 1 && factor <= 1.05);
});

test("a scheduled start holds guests and plays exactly at playAt", () => {
  const h = harness();
  h.render();
  h.position(100);
  h.emit({ positionSeconds: 100, updatedAt: h.now(), playAt: h.now() + 1500 });
  assert.ok(h.calls.some((c) => c[0] === "pause"));
  assert.ok(!h.calls.some((c) => c[0] === "play"));
  h.advance(1400);
  assert.ok(!h.calls.some((c) => c[0] === "play"));
  h.advance(100);
  assert.ok(h.calls.some((c) => c[0] === "play"));
});

test("guests ignore host states until the room has started", () => {
  const h = harness();
  h.params.roomSnapshot = { ...h.params.roomSnapshot, started: false };
  h.render();
  h.emit({ playing: false });
  assert.ok(!h.calls.some((c) => c[0] === "seek"));
});
