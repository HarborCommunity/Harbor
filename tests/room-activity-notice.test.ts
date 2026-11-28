import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { whoPaused } from "../src/lib/together/who-paused.ts";

function harness(params: Record<string, unknown>) {
  const shown: any[] = [];
  const refs: any[] = [];
  const effects: any[] = [];
  let refIndex = 0;
  let effectIndex = 0;
  const react = {
    useCallback: (fn: any) => fn,
    useState: (initial: any) => [initial, (v: any) => v && shown.push(v)],
    useRef: (current: any) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
    useEffect: (fn: any, deps?: any[]) => {
      const index = effectIndex++;
      const old = effects[index];
      if (old && deps && deps.every((v, i) => Object.is(v, old.deps[i]))) return;
      old?.cleanup?.();
      effects[index] = { deps: deps ?? [], cleanup: fn() };
    },
  };
  const code = ts.transpileModule(
    readFileSync("src/views/player/hooks/use-room-activity-notice.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports: any = {};
  new Function("require", "exports", "window", code)(
    (name: string) => {
      assert.equal(name, "react");
      return react;
    },
    exports,
    { setTimeout: () => 1, clearTimeout: () => {} },
  );
  const base = {
    inRoom: true,
    isHost: false,
    hasStarted: true,
    participants: [{ id: "alex", name: "Alex" }],
    hostClientId: "alex",
    hostOnly: false,
    activity: null,
  };
  const render = (patch: Record<string, unknown> = {}) => {
    Object.assign(params, patch);
    refIndex = effectIndex = 0;
    exports.useRoomActivityNotice({ ...base, ...params });
  };
  return { render, shown };
}

test("a guest hears about the lock once, and not again when the host leaves", () => {
  const h = harness({ hostOnly: true });
  h.render();
  assert.deepEqual(h.shown, [{ kind: "lock", name: "Alex", locked: true }]);
  // The host's leaving state names no media; it is not an unlock.
  h.render({ hostOnly: null });
  h.render({ hostOnly: true });
  assert.equal(h.shown.length, 1);
  h.render({ hostOnly: false });
  assert.deepEqual(h.shown.at(-1), { kind: "lock", name: "Alex", locked: false });
});

test("the pause badge marks only someone who asked to pause", () => {
  const state = (patch: object) =>
    ({ playing: false, buffering: false, updatedBy: "alex", ...patch }) as any;
  assert.equal(whoPaused(state({ cause: { by: "sam", action: "pause", id: 1 } })), "sam");
  assert.equal(whoPaused(state({})), null, "the room waiting for someone is nobody's pause");
  assert.equal(whoPaused(state({ cause: { by: "sam", action: "seek", id: 2 } })), null);
  assert.equal(
    whoPaused(state({ playing: true, cause: { by: "sam", action: "pause", id: 1 } })),
    null,
  );
  assert.equal(whoPaused(null), null);
});
