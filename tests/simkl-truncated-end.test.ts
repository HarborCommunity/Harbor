import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Runs the production hook across renders, as the player drives it.
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
  return (args: any) => {
    ri = ei = 0;
    pending = [];
    exports.useSimklScrobble(args);
    for (const { i } of pending) effects[i]?.cleanup?.();
    for (const { i, fn, deps } of pending) effects[i] = { deps, cleanup: fn() };
  };
}

test("a truncated end reloaded in place still scrobbles the real end", async () => {
  const writes: string[] = [];
  let position = 300;
  const render = host({
    "./provider": { useSimkl: () => ({ isConnected: true }) },
    "./scrobble": {
      simklScrobble: (action: string) => {
        writes.push(action);
        return Promise.resolve(true);
      },
      buildBody: () => ({}),
    },
    "./scrobble-body": { animeIdentity: () => null },
    "./pending-sync": { recordPendingWatch: () => writes.push("queued") },
    "./record-watched": {
      recordWatchedFallback: () => {
        writes.push("watched");
        return Promise.resolve(true);
      },
    },
    "@/lib/player/playback-clock": { getPlaybackPosition: () => position },
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
  const src = {
    meta: { id: "tt0182576", type: "series", name: "Show" },
    episode: { season: 10, episode: 9 },
    url: "https://video.example/episode",
  };
  const snap = (status: string, positionSec: number) => ({
    status,
    positionSec,
    durationSec: 1000,
  });
  render({ src, snap: snap("playing", 300) });
  position = 400;
  render({ src, snap: snap("ended", 400) });
  // The player reopens the same URL at the position the stream died.
  render({ src, snap: snap("loading", 0) });
  render({ src, snap: snap("playing", 400) });
  position = 980;
  render({ src, snap: snap("ended", 980) });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes, ["start", "start", "watched"]);
});
