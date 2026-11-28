import assert from "node:assert/strict";
import test from "node:test";
import {
  REJOIN_WINDOW_MS,
  clearSavedRoom,
  loadRecentRoom,
  saveRoom,
} from "../src/lib/together/rejoin.ts";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

const state = {
  mediaId: "tt9",
  mediaTitle: "Show",
  episode: { season: 1, episode: 2 },
  posterUrl: null,
  positionSeconds: 10,
  playing: true,
  updatedAt: 0,
  updatedBy: "host",
  hostClientId: "host",
};

test("a recent room on the same relay is offered with what it was watching", () => {
  saveRoom("wss://relay", "ABC123", state);
  const saved = loadRecentRoom("wss://relay");
  assert.equal(saved?.room, "ABC123");
  assert.deepEqual(saved?.media, {
    id: "tt9",
    type: "series",
    name: "Show",
    episode: { season: 1, episode: 2 },
  });
});

test("old rooms, other relays and deliberate leaves are not offered", () => {
  saveRoom("wss://relay", "ABC123", null);
  assert.equal(loadRecentRoom("wss://other"), null);
  assert.equal(loadRecentRoom("wss://relay", Date.now() + REJOIN_WINDOW_MS + 1), null);
  clearSavedRoom();
  assert.equal(loadRecentRoom("wss://relay"), null);
});

// Runs the real useRejoinOffer with a tiny hooks runtime.
async function rejoinHook(initial: Record<string, any>) {
  const ts = (await import("typescript")).default;
  const { readFileSync } = await import("node:fs");
  const rejoin = await import("../src/lib/together/rejoin.ts");
  const states: any[] = [];
  const refs: any[] = [];
  const effects: any[] = [];
  const callbacks: any[] = [];
  let cursor = { s: 0, r: 0, e: 0, c: 0 };
  let dirty = false;
  const pending: (() => void)[] = [];
  const intervals: (() => void)[] = [];
  const react = {
    useState: (init: any) => {
      const i = cursor.s++;
      if (!(i in states)) states[i] = init;
      return [
        states[i],
        (v: any) => {
          if (!Object.is(v, states[i])) {
            states[i] = v;
            dirty = true;
          }
        },
      ];
    },
    useRef: (current: any) => refs[cursor.r++] ?? (refs[cursor.r - 1] = { current }),
    useCallback: (fn: any, deps: any[]) => {
      const i = cursor.c++;
      const old = callbacks[i];
      if (old && deps.every((v, k) => Object.is(v, old.deps[k]))) return old.fn;
      callbacks[i] = { fn, deps };
      return fn;
    },
    useEffect: (fn: any, deps: any[]) => {
      const i = cursor.e++;
      const old = effects[i];
      if (old && deps.every((v, k) => Object.is(v, old.deps[k]))) return;
      pending.push(() => {
        old?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  const code = ts.transpileModule(readFileSync("src/lib/together/use-rejoin-offer.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", "window", code)(
    (name: string) => (name === "react" ? react : name === "./rejoin" ? rejoin : {}),
    exports,
    {
      setInterval: (fn: () => void) => (intervals.push(fn), intervals.length),
      clearInterval: () => {},
    },
  );
  const joins: string[] = [];
  const params: Record<string, any> = { join: (room: string) => joins.push(room), ...initial };
  let api: any;
  const render = (patch: Record<string, any> = {}) => {
    Object.assign(params, patch);
    for (let pass = 0; pass < 10; pass++) {
      dirty = false;
      cursor = { s: 0, r: 0, e: 0, c: 0 };
      api = exports.useRejoinOffer(params);
      while (pending.length) pending.shift()!();
      if (!dirty) break;
    }
  };
  render();
  return { render, api: () => api, joins };
}

const snap = (patch: Record<string, any> = {}) => ({
  state: "joined",
  room: "ABC123",
  listenSessionId: undefined,
  syncState: { ...state, positionSeconds: 1 },
  ...patch,
});

test("the saved room is written when the room or title changes, not on every heartbeat", async () => {
  clearSavedRoom();
  let writes = 0;
  const setItem = localStorage.setItem;
  (globalThis as any).localStorage.setItem = (k: string, v: string) => {
    writes++;
    setItem(k, v);
  };
  try {
    const h = await rejoinHook({
      relayUrl: "wss://relay.test",
      snapshot: snap(),
      pendingInvite: null,
    });
    assert.equal(writes, 1);
    for (let i = 2; i < 6; i++)
      h.render({ snapshot: snap({ syncState: { ...state, positionSeconds: i } }) });
    assert.equal(writes, 1, "position changes alone don't touch storage");
    h.render({ snapshot: snap({ syncState: { ...state, episode: { season: 1, episode: 3 } } }) });
    assert.equal(writes, 2);
  } finally {
    (globalThis as any).localStorage.setItem = setItem;
  }
});

test("a pending invite suppresses the rejoin offer, and dismissing forgets the room", async () => {
  saveRoom("wss://relay.test", "ABC123", state as any);
  const idle = snap({ state: "disconnected", room: null, syncState: null });
  const invited = await rejoinHook({
    relayUrl: "wss://relay.test",
    snapshot: idle,
    pendingInvite: {},
  });
  assert.equal(invited.api().rejoinOffer, null);
  const offered = await rejoinHook({
    relayUrl: "wss://relay.test",
    snapshot: idle,
    pendingInvite: null,
  });
  assert.equal(offered.api().rejoinOffer.room, "ABC123");
  offered.api().dismissRejoin();
  offered.render();
  assert.equal(offered.api().rejoinOffer, null);
  assert.equal(loadRecentRoom("wss://relay.test"), null, "the room is forgotten");
});
