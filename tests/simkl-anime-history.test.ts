import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const session = {};

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

function loadHistory(response: unknown = { added: { episodes: 1 }, not_found: {} }) {
  const bodies: any[] = [];
  const api = load("src/lib/simkl/history.ts", {
    "@/lib/active-profile-id": { activeProfileId: () => "a" },
    "./session": { getSession: () => session },
    "@/lib/tracker-resolve": {},
    "./activities/gate": { currentActivitiesAll: async () => null },
    "./client": {
      simklRequest: async (_path: string, opts: { body: unknown }) => {
        bodies.push(opts.body);
        return response;
      },
    },
    "./ids": { simklTargetIds: () => ({}) },
  });
  return { api, bodies };
}

test("show episode writes let Simkl route TVDB seasons to its anime entries", async () => {
  const { api, bodies } = loadHistory();
  assert.equal(await api.markEpisodesWatched({ imdb: "tt0388629" }, 10, [4]), true);
  await api.unmarkEpisodesWatched({ imdb: "tt0388629" }, 10, [4]);
  await api.addToHistory({
    kind: "episode",
    show: { ids: { imdb: "tt0388629" } },
    season: 10,
    number: 4,
  });
  for (const body of bodies) assert.equal(body.shows[0].use_tvdb_anime_seasons, true);
});

test("native anime ids are written in Simkl's anime envelope with entry numbers", async () => {
  const { api, bodies } = loadHistory();
  assert.equal(await api.markAnimeEpisodesWatched({ kitsu: 1555 }, [175]), true);
  assert.deepEqual(bodies[0].anime[0].ids, { kitsu: 1555 });
  assert.equal(bodies[0].anime[0].episodes[0].number, 175);
  assert.equal(bodies[0].anime[0].seasons, undefined);
  assert.equal(bodies[0].shows, undefined);
});

test("an anime write Simkl lists under not_found is a missed write", async () => {
  const { api } = loadHistory({ added: { episodes: 0 }, not_found: { anime: [{}] } });
  assert.equal(await api.markAnimeEpisodesWatched({ kitsu: 1555 }, [175]), false);
});

test("the watched fallback writes a player-named anime entry in the anime envelope", async () => {
  const writes: any[] = [];
  const api = load("src/lib/simkl/record-watched.ts", {
    "@/lib/active-profile-id": { activeProfileId: () => "a" },
    "./session": { getSession: () => session },
    "@/lib/tracker-resolve": { resolveForMeta: async () => ({ ok: false }) },
    "./ids": {
      stremioIdToSimklTarget: () => ({ ok: false }),
      resolveSimklEpisodeTarget: async () => ({
        kind: "anime-episode",
        anime: { ids: { mal: 21 } },
        season: 1,
        number: 403,
      }),
    },
    "./history": {
      addToHistory: async () => false,
      markEpisodesWatched: async (...args: unknown[]) => {
        writes.push(["shows", ...args]);
        return true;
      },
      markAnimeEpisodesWatched: async (...args: unknown[]) => {
        writes.push(["anime", ...args]);
        return true;
      },
    },
    "./scrobble-body": {
      animeIdentity: (ep: any) =>
        ep?.sourceMetaId ? { scheme: "kitsu", id: 1555, number: ep.episode } : null,
    },
    "@/lib/tracker-progress-events": { notifyTrackerProgress: () => {} },
  });
  const named = { season: 1, episode: 175, sourceMetaId: "kitsu:1555" };
  assert.equal(await api.recordWatchedFallback("tt0388629", named), true);
  assert.equal(await api.recordWatchedFallback("mal:21", { season: 1, episode: 403 }), true);
  assert.deepEqual(writes, [
    ["anime", { kitsu: 1555 }, [175]],
    ["anime", { mal: 21 }, [403]],
  ]);
});
