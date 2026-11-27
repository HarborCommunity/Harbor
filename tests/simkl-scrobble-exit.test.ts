import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Runs the production hook across renders and its unmount cleanup.
function host(mocks: Record<string, any>) {
  const refs: any[] = [];
  const effects: any[] = [];
  let ri = 0,
    ei = 0;
  let pending: any[] = [];
  const same = (a: any[], b: any[]) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value: any) {
      const i = ri++;
      return (refs[i] ??= { current: value });
    },
    useEffect(fn: any, deps: any[]) {
      const i = ei++;
      if (!effects[i] || !same(effects[i].deps, deps)) pending.push({ i, fn, deps });
    },
  };
  const path = "src/lib/simkl/scrobble-hook.ts";
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  const win = { addEventListener: () => {}, removeEventListener: () => {} };
  new Function("require", "exports", "window", "fetch", js)(
    (name: string) => {
      if (name === "react") return react;
      assert.ok(name in mocks, `Unexpected ${name} in ${path}`);
      return mocks[name];
    },
    exports,
    win,
    () => Promise.resolve({ ok: true }),
  );
  return {
    render(args: any) {
      ri = ei = 0;
      pending = [];
      exports.useSimklScrobble(args);
      for (const { i } of pending) effects[i]?.cleanup?.();
      for (const { i, fn, deps } of pending) effects[i] = { deps, cleanup: fn() };
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}

function setup(written = true) {
  const writes: string[] = [];
  const clock = { position: 300, listeners: new Set<() => void>() };
  const queue = new Set<string>();
  const key = (id: string, ep: any) => `${id}|${ep?.season ?? ""}|${ep?.episode ?? ""}`;
  const h = host({
    "./provider": { useSimkl: () => ({ isConnected: true }) },
    "./scrobble": {
      simklScrobble: (action: string) => {
        writes.push(action);
        return Promise.resolve(true);
      },
      buildBody: () => ({}),
    },
    "./scrobble-body": { animeIdentity: () => null },
    "./pending-sync": {
      recordPendingWatch: (id: string, ep: any) => queue.add(key(id, ep)),
      clearPendingWatch: (id: string, ep: any) => queue.delete(key(id, ep)),
    },
    "./record-watched": {
      recordWatchedFallback: () => {
        writes.push("watched");
        return Promise.resolve(written);
      },
    },
    "@/lib/player/playback-clock": {
      getPlaybackPosition: () => clock.position,
      subscribePlaybackClock: (cb: () => void) => {
        clock.listeners.add(cb);
        return () => clock.listeners.delete(cb);
      },
    },
    "@/lib/settings": { useSettings: () => ({ settings: { simklScrobbleEnabled: true } }) },
    "./config": {
      SIMKL_API_BASE: "https://simkl.example",
      SIMKL_CLIENT_ID: "fake",
      SIMKL_APP_NAME: "Harbor",
      SIMKL_APP_VERSION: "1",
      SIMKL_USER_AGENT: "test",
      SIMKL_WATCHED_RATIO: 0.9,
    },
    "./session": { getSession: () => ({ accessToken: "fake" }) },
  });
  const tick = (position: number) => {
    clock.position = position;
    for (const listener of clock.listeners) listener();
  };
  return { h, writes, queue, tick };
}

const src = {
  meta: { id: "tt0182576", type: "series", name: "Show" },
  episode: { season: 10, episode: 9 },
  url: "https://video.example/episode",
};
const snap = { status: "playing", positionSec: 300, durationSec: 1000 };

test("Next from the ending preview records the episode the clock carried past the mark", async () => {
  const { h, writes, queue, tick } = setup();
  h.render({ src, snap });
  tick(950);
  // The player tears down the bridge, which resets the clock, before this hook unmounts.
  tick(0);
  h.unmount();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes, ["start", "watched"]);
  assert.equal(queue.size, 0);
});

test("closing the player keeps the watch queued when the direct write fails", async () => {
  const { h, writes, queue, tick } = setup(false);
  h.render({ src, snap });
  tick(950);
  h.unmount();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes, ["start", "watched"]);
  assert.deepEqual([...queue], ["tt0182576|10|9"]);
});
