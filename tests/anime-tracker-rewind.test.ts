import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import "./_localstorage-stub.ts";
import { airedOnly } from "../src/views/detail/helpers.ts";
import { animeSeasonKey } from "../src/views/detail/anime-episodes/anime-season-key.ts";

function load(path: string, mocks: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", code)((id: string) => {
    assert.ok(id in mocks, `Unexpected import: ${id}`);
    return mocks[id];
  }, exports);
  return exports;
}

function routing(calls: unknown[][]) {
  const { useAnimeWatchedRouting } = load(
    "src/views/detail/anime-episodes/use-anime-watched-routing.ts",
    {
      react: { useMemo: (fn: () => unknown) => fn() },
      "@/lib/manual-watched": {
        recordManualWatchedMeta: () => {},
        setManualWatchedMany: () => {},
      },
      "@/lib/anilist/sync": {
        syncAnimeProgress: (...a: unknown[]) => calls.push(["anilist-sync", ...a]),
        rewindAnimeProgress: (...a: unknown[]) => calls.push(["anilist-rewind", ...a]),
      },
      "@/lib/mal/sync": {
        syncMalProgress: (...a: unknown[]) => calls.push(["mal-sync", ...a]),
        rewindMalProgress: (...a: unknown[]) => calls.push(["mal-rewind", ...a]),
      },
      "@/lib/settings": {
        useSettings: () => ({ settings: { anilistAutoSync: true, malAutoSync: true } }),
      },
      "@/lib/nuvio/nuvio-client": {
        isNuvioSignedIn: () => false,
        isNuvioProviderActive: () => false,
      },
      "@/lib/nuvio/nuvio-sync": {},
      "@/lib/cw-dismiss": { undismissCw: () => {} },
      "../helpers": { airedOnly },
      "./anime-season-key": { animeSeasonKey },
    },
  );
  return useAnimeWatchedRouting({ id: "kitsu:11", type: "series", name: "Show" }, []);
}

const ep = (number: number) => ({ id: number, number, seasonNumber: 1, airdate: "2020-01-01" });

test("unmarking episodes rewinds MAL and AniList to the last episode still watched", () => {
  const calls: unknown[][] = [];
  const rows = [1, 2, 3, 4, 5, 6].map(ep);
  // Episode 2 was never watched, so unmarking 5-6 must not claim 1-4.
  const watched = new Set([1, 3, 4, 5, 6]);
  routing(calls).markMany(rows.slice(4), false, {
    rows,
    isWatched: (e: { number: number }) => watched.has(e.number),
  });
  assert.deepEqual(calls, [
    ["anilist-rewind", "kitsu:11", 4],
    ["mal-rewind", "kitsu:11", 4],
  ]);
});

test("unmarking without the shown rows leaves tracker progress alone", () => {
  const calls: unknown[][] = [];
  routing(calls).markMany([ep(3)], false);
  assert.deepEqual(calls, []);
});

test("MAL rewind lowers the count but never touches a completed entry", async () => {
  const writes: string[] = [];
  let status = "watching";
  const session = {};
  const api = load("src/lib/mal/sync.ts", {
    "@/lib/active-profile-id": { activeProfileId: () => "a" },
    "./client": {
      MalApiError: class extends Error {},
      malRequest: async (path: string, opts?: { body: URLSearchParams }) => {
        if (opts) {
          writes.push(opts.body.toString());
          return { num_episodes_watched: 4 };
        }
        return {
          num_episodes: 12,
          my_list_status: { num_episodes_watched: 6, status, is_rewatching: false },
        };
      },
    },
    "./mutations": { resolveMalMediaId: async () => 21 },
    "./session": { isAuthenticated: () => true, getSession: () => session },
  });
  await api.rewindMalProgress("kitsu:11", 4);
  status = "completed";
  await api.rewindMalProgress("kitsu:11", 4);
  assert.deepEqual(writes, ["num_watched_episodes=4"]);
});

test("AniList rewind keeps the entry's status and skips re-watching entries", async () => {
  const writes: unknown[] = [];
  let status = "CURRENT";
  const session = {};
  const api = load("src/lib/anilist/sync.ts", {
    "@/lib/active-profile-id": { activeProfileId: () => "a" },
    "@/lib/providers/anime-mapping": { kitsuToAnilist: async () => 99 },
    "./client": {
      AnilistApiError: class extends Error {},
      anilistRequest: async (query: string, vars: Record<string, unknown>) => {
        if (query.startsWith("mutation")) {
          writes.push(vars);
          return { SaveMediaListEntry: { id: 1, progress: 4, status } };
        }
        return { Media: { id: 99, episodes: 12, mediaListEntry: { id: 1, progress: 6, status } } };
      },
    },
    "./session": { isAuthenticated: () => true, getSession: () => session },
  });
  await api.rewindAnimeProgress("kitsu:11", 4);
  status = "REPEATING";
  await api.rewindAnimeProgress("kitsu:11", 4);
  assert.deepEqual(writes, [{ mediaId: 99, progress: 4, status: "CURRENT" }]);
});
