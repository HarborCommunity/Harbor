import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { HOST_MOVE_ARM_MS, nextHostMove } from "../src/lib/together/host-move.ts";

// Runs the real useLobbyGate with a tiny hooks runtime and fake timers.
function lobby(initial: Record<string, any> = {}) {
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const states: any[] = [];
  const refs: any[] = [];
  const effects: any[] = [];
  const callbacks: any[] = [];
  let cursor = { state: 0, ref: 0, effect: 0, callback: 0 };
  let dirty = false;
  const pending: (() => void)[] = [];
  const react = {
    useState: (init: any) => {
      const i = cursor.state++;
      if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
      const set = (v: any) => {
        const next = typeof v === "function" ? v(states[i]) : v;
        if (!Object.is(next, states[i])) {
          states[i] = next;
          dirty = true;
        }
      };
      return [states[i], set];
    },
    useRef: (current: any) => refs[cursor.ref++] ?? (refs[cursor.ref - 1] = { current }),
    useCallback: (fn: any, deps: any[]) => {
      const i = cursor.callback++;
      const old = callbacks[i];
      if (old && deps.every((v, k) => Object.is(v, old.deps[k]))) return old.fn;
      callbacks[i] = { fn, deps };
      return fn;
    },
    useEffect: (fn: any, deps: any[]) => {
      const i = cursor.effect++;
      const old = effects[i];
      if (old && deps.every((v, k) => Object.is(v, old.deps[k]))) return;
      pending.push(() => {
        old?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  const code = ts.transpileModule(
    readFileSync("src/views/player/hooks/use-lobby-gate.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports: any = {};
  new Function("require", "exports", "window", "Date", code)(
    (name: string) => {
      if (name === "react") return react;
      if (name === "../player-utils") return { GUEST_ESCAPE_MS: 45_000, READY_STALE_MS: 20_000 };
      throw new Error(`unexpected ${name}`);
    },
    exports,
    {
      setTimeout: (fn: () => void, ms: number) => (
        timers.set(++nextTimer, { at: now + ms, fn }),
        nextTimer
      ),
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: (fn: () => void, ms: number) => (
        timers.set(++nextTimer, { at: now + ms, fn, every: ms }),
        nextTimer
      ),
      clearInterval: (id: number) => timers.delete(id),
    },
    { now: () => now },
  );
  const calls: string[] = [];
  const ready = (ids: string[]) => ids.map((id) => ({ id, name: id, ready: true }));
  const params: Record<string, any> = {
    inRoom: true,
    isHost: true,
    hasStarted: false,
    setHasStarted: (v: boolean) => {
      params.hasStarted = v;
      calls.push(`hasStarted ${v}`);
    },
    roomSnapshot: { participants: ready(["alex", "sam"]), started: false },
    startRoom: () => calls.push("startRoom"),
    startTogether: () => calls.push("startTogether"),
    autoStart: true,
    suppressOutgoingFor: () => {},
    bridgeRef: { current: null },
    initialSyncDoneRef: { current: false },
    mediaKey: "tt1||",
    ...initial,
  };
  let api: any;
  const render = (patch: Record<string, any> = {}) => {
    Object.assign(params, patch);
    for (let pass = 0; pass < 10; pass++) {
      dirty = false;
      cursor = { state: 0, ref: 0, effect: 0, callback: 0 };
      api = exports.useLobbyGate(params);
      while (pending.length) pending.shift()!();
      if (!dirty) break;
    }
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      t.fn();
      render();
    }
    now = end;
  };
  render();
  return { render, advance, calls, api: () => api, ready };
}

test("everyone ready starts the room after the 5 s countdown", () => {
  const h = lobby();
  assert.ok(h.api().autoStartAt != null);
  h.advance(4900);
  assert.ok(!h.calls.includes("startTogether"));
  h.advance(100);
  assert.ok(h.calls.includes("startTogether"));
  assert.ok(h.calls.includes("startRoom"));
});

test("Cancel stops it, and switching the setting off and on arms it again", () => {
  const h = lobby();
  h.api().cancelAutoStart();
  h.render();
  assert.equal(h.api().autoStartAt, null);
  h.advance(10_000);
  assert.ok(!h.calls.includes("startTogether"));
  h.render({ autoStart: false });
  h.render({ autoStart: true });
  assert.ok(h.api().autoStartAt != null, "a fresh opt-in counts down again");
  h.advance(5000);
  assert.ok(h.calls.includes("startTogether"));
});

test("someone loading again or a new host clears the countdown", () => {
  const h = lobby();
  h.advance(2000);
  h.render({
    roomSnapshot: {
      participants: [...h.ready(["alex"]), { id: "sam", name: "sam", ready: false }],
      started: false,
    },
  });
  assert.equal(h.api().autoStartAt, null);
  h.advance(10_000);
  assert.ok(!h.calls.includes("startTogether"));
  const g = lobby();
  g.advance(2000);
  g.render({ isHost: false });
  g.advance(10_000);
  assert.ok(!g.calls.includes("startTogether"), "a guest never starts the room");
});

test("play next from the end screen tells the room only if no player follows", () => {
  const none = { picker: null, player: null };
  // Between the closed player and the opened picker nothing is up yet.
  assert.deepEqual(nextHostMove("armed", none, 100), { state: "armed", teardown: false });
  assert.deepEqual(nextHostMove("armed", { picker: {}, player: null }), {
    state: "picking",
    teardown: false,
  });
  // Back from the picker: the room is told the host left.
  assert.deepEqual(nextHostMove("picking", none), { state: "idle", teardown: true });
  // The next title started: nothing to send.
  assert.deepEqual(nextHostMove("picking", { picker: null, player: {} }), {
    state: "idle",
    teardown: false,
  });
  // The picker never appeared at all.
  assert.deepEqual(nextHostMove("armed", none, HOST_MOVE_ARM_MS), {
    state: "idle",
    teardown: true,
  });
  assert.deepEqual(nextHostMove("idle", none), { state: "idle", teardown: false });
});
