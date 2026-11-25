import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { DirEntry } from "@tauri-apps/plugin-fs";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ListToastHost } from "../src/components/lists/list-toast";
import { emptySnapshot, type PlayerBridge } from "../src/lib/player/bridge";
import { clearPlayerPrefs, writePlayerPrefs } from "../src/lib/player-prefs";
import { DEFAULT } from "../src/lib/settings/defaults";
import {
  clearRememberedSub,
  subtitleMediaKey,
  writeRememberedSub,
} from "../src/lib/subtitles/subtitle-memory";
import type { PlayerSrc } from "../src/lib/view";
import { useLocalSubtitleAutoload } from "../src/views/player/hooks/use-local-subtitle-autoload";

type HookProps = Parameters<typeof useLocalSubtitleAutoload>[0];

const movie: PlayerSrc = {
  url: "https://media.example/film",
  title: "The Crossing",
  meta: {
    id: "tt1234567",
    type: "movie",
    name: "The Crossing",
    alternateTitles: ["交差点"],
    releaseDate: "2024-01-22",
  },
};

function file(name: string): DirEntry {
  return { name, isDirectory: false, isFile: true, isSymlink: false };
}

function subtitlePlayer(
  t: TestContext,
  read: (path: string) => DirEntry[] | Promise<DirEntry[]>,
  add: PlayerBridge["addSubtitle"] = async () => true,
) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  Object.defineProperties(dom.window, {
    __TAURI_OS_PLUGIN_INTERNALS__: { value: { platform: "linux" } },
    __TAURI_INTERNALS__: { writable: true, value: { plugins: { path: { sep: "/" } } } },
  });
  const paths: string[] = [];
  mockIPC((command, args) => {
    assert.equal(command, "plugin:fs|read_dir");
    const path = (args as { path: string }).path;
    paths.push(path);
    return read(path);
  });

  let automatic = true;
  const bridge = {
    addSubtitle: t.mock.fn(add),
    canAutoSelectSubtitle: () => automatic,
    capabilities: () => ({ engine: "mpv" }),
    setSubtitleTrack: t.mock.fn(),
  };
  const defaults: HookProps = {
    actorKey: "profile",
    bridgeKey: "mpv",
    bridgeReady: true,
    bridgeRef: { current: bridge as unknown as PlayerBridge },
    hasRememberedSubtitle: false,
    settings: { ...DEFAULT, localSubtitleFolder: "/subs", preferredSubLangs: ["English"] },
    snap: { ...emptySnapshot, status: "playing", firstFrameReady: true },
    src: movie,
  };
  const root = createRoot(document.getElementById("root")!);
  let localSelection: ReturnType<typeof useLocalSubtitleAutoload> | undefined;
  function Player(props: HookProps) {
    localSelection = useLocalSubtitleAutoload(props);
    return <ListToastHost />;
  }
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return {
    bridge,
    paths,
    settings: defaults.settings,
    snap: defaults.snap,
    localSelection: () => localSelection?.current,
    notification: () => document.querySelector("[role='status']")?.textContent,
    pickManually: () => {
      automatic = false;
    },
    render: (props: Partial<HookProps> = {}) =>
      act(async () => root.render(<Player {...defaults} {...props} />)),
  };
}

test("movie playback uses the release year and retries the next subtitle in preference order", async (t) => {
  const player = subtitlePlayer(
    t,
    () => [
      file("交差点.2012.ara.srt"),
      file("交差点.2024.eng.srt"),
      file("交差点.2024.ara.srt"),
      file("交差点.2024.fra.srt"),
    ],
    async (path) => {
      if (path.endsWith(".ara.srt")) throw new Error("Invalid subtitle");
      return true;
    },
  );

  await player.render({
    settings: { ...player.settings, preferredSubLangs: ["Arabic", "English"] },
  });

  assert.deepEqual(player.paths, ["/subs"]);
  assert.deepEqual(
    player.bridge.addSubtitle.mock.calls.map(({ arguments: [path, lang, , select, , origin] }) => [
      path,
      lang,
      select,
      origin,
    ]),
    [
      ["/subs/交差点.2024.ara.srt", "ar", true, "automatic"],
      ["/subs/交差点.2024.eng.srt", "en", true, "automatic"],
    ],
  );
});

test("local files stay available without selecting over off, remembered, or preselected choices", async (t) => {
  const player = subtitlePlayer(t, () => [file("交差点.2024.eng.srt")]);
  await player.render({ settings: { ...player.settings, subtitlesOffByDefault: true } });
  await player.render({ src: { ...movie, subtitlePreselect: { off: false, url: "/chosen.srt" } } });

  const key = subtitleMediaKey(movie.meta.id);
  writeRememberedSub(key, { source: "/remembered.srt" });
  try {
    await player.render({ src: { ...movie, url: "https://media.example/remembered" } });
  } finally {
    clearRememberedSub(key);
  }

  writePlayerPrefs(movie.meta.id, { subsOff: true });
  try {
    await player.render({ src: { ...movie, url: "https://media.example/off" } });
  } finally {
    clearPlayerPrefs(movie.meta.id);
  }

  assert.deepEqual(player.paths, ["/subs", "/subs", "/subs", "/subs"]);
  assert.deepEqual(
    player.bridge.addSubtitle.mock.calls.map(({ arguments: [path, , , selected, metadata] }) => [
      path,
      selected,
      metadata?.imported,
    ]),
    Array.from({ length: 4 }, () => ["/subs/交差点.2024.eng.srt", false, true]),
  );
  assert.equal(player.bridge.setSubtitleTrack.mock.callCount(), 0);
});

test("attaches a local subtitle as Imported without replacing a restored selection", async (t) => {
  const player = subtitlePlayer(t, () => [file("交差点.2024.eng.srt")]);
  await player.render({ hasRememberedSubtitle: true });
  assert.deepEqual(player.bridge.addSubtitle.mock.calls[0]?.arguments, [
    "/subs/交差点.2024.eng.srt",
    "en",
    "交差点.2024.eng",
    false,
    { forced: undefined, imported: true },
    "automatic",
  ]);
  assert.equal(player.bridge.setSubtitleTrack.mock.callCount(), 0);
});

test("auto-selects the Arabic file from the matching season pack over embedded English", async (t) => {
  const pack = "re-zero-starting-life-in-another-world-season-3-2016_arabic_123-[SubSource]";
  const filename = "[Group] ReZero kara Hajimeru Isekai Seikatsu S03 - 02.ass";
  const player = subtitlePlayer(t, (path) =>
    path === "/subs"
      ? [{ name: pack, isDirectory: true, isFile: false, isSymlink: false }]
      : [file(filename)],
  );
  await player.render({
    src: {
      ...movie,
      meta: {
        id: "tt5607616",
        type: "series",
        name: "Re:ZERO -Starting Life in Another World-",
      },
      episode: { season: 1, episode: 2, imdbSeason: 3, imdbEpisode: 2 },
      isAnime: true,
    },
    settings: {
      ...player.settings,
      preferredSubLangs: ["Arabic", "English"],
      preferEmbeddedSubs: true,
    },
    snap: {
      ...player.snap,
      subtitleTracks: [{ id: "1", label: "English", lang: "en", kind: "subtitle", selected: true }],
    },
  });
  const [path, language, , selected, metadata] = player.bridge.addSubtitle.mock.calls[0].arguments;
  assert.equal(path, `/subs/${pack}/${filename}`);
  assert.equal(language, "ar");
  assert.equal(selected, true);
  assert.equal(metadata?.imported, true);
});

test("selects an untagged anime subtitle over embedded English and confirms the import", async (t) => {
  const title = "[Crunchyroll] Watashi wo Tabetai, Hitodenashi - 02";
  const load = Promise.withResolvers<boolean>();
  const player = subtitlePlayer(
    t,
    () => [file(`${title}.ass`)],
    () => load.promise,
  );
  const src: PlayerSrc = {
    ...movie,
    meta: {
      id: "kitsu:123",
      type: "series",
      name: "This Monster Wants to Eat Me",
      alternateTitles: ["Watashi o Tabetai, Hitodenashi"],
    },
    episode: { season: 1, episode: 2 },
  };
  const snap = {
    ...player.snap,
    subtitleTracks: [
      { id: "1", label: "English", lang: "en", kind: "subtitle" as const, selected: true },
    ],
  };
  await player.render({ src, snap });
  assert.deepEqual(player.bridge.addSubtitle.mock.calls[0]?.arguments, [
    `/subs/${title}.ass`,
    undefined,
    title,
    true,
    { forced: undefined, imported: true },
    "automatic",
  ]);
  assert.equal(player.notification(), undefined);

  await act(async () => load.resolve(true));
  assert.equal(player.notification(), `Loaded ${title}`);
  assert.equal(player.localSelection()?.pending, true);

  await player.render({
    src: { ...src },
    snap: {
      ...snap,
      subtitleTracks: [
        {
          id: "2",
          label: title,
          kind: "subtitle",
          external: true,
          imported: true,
          url: `/subs/${title}.ass`,
          selected: true,
        },
      ],
    },
  });
  assert.equal(player.bridge.addSubtitle.mock.callCount(), 1);
  assert.equal(player.bridge.setSubtitleTrack.mock.callCount(), 0);
  assert.equal(player.localSelection()?.pending, false);
});

test("does not announce a failed import or an import from a previous video", async (t) => {
  const load = Promise.withResolvers<boolean>();
  let attempts = 0;
  const player = subtitlePlayer(
    t,
    () => [file("The Crossing.2024.srt")],
    () => (attempts++ === 0 ? load.promise : Promise.resolve(false)),
  );
  await player.render();
  await player.render({ src: { ...movie, url: "https://media.example/other" } });
  await act(async () => load.resolve(true));
  assert.equal(player.bridge.addSubtitle.mock.callCount(), 2);
  assert.equal(player.notification(), undefined);
  assert.equal(player.localSelection(), null);
});

test("keeps the embedded selection when preferred and still confirms the import", async (t) => {
  const player = subtitlePlayer(t, () => [file("The Crossing.2024.srt")]);
  await player.render({
    settings: { ...player.settings, preferEmbeddedSubs: true },
    snap: {
      ...player.snap,
      subtitleTracks: [{ id: "1", label: "English", lang: "en", kind: "subtitle", selected: true }],
    },
  });
  assert.equal(player.bridge.addSubtitle.mock.calls[0]?.arguments[3], false);
  assert.equal(player.notification(), "Loaded The Crossing.2024");
});

test("loads the season-wide subtitle when a split anime part starts its numbering over", async (t) => {
  const pack = "re-zero-starting-life-in-another-world-season-2-2016_arabic_123-[SubSource]";
  const episodeFour = "[Rhythm] Re Zero kara Hajimeru Isekai Seikatsu - 29 [S2-04][BD].ass";
  const episodeSeventeen = "[Rhythm] Re Zero kara Hajimeru Isekai Seikatsu - 42 [S2-17][BD].ass";
  const player = subtitlePlayer(t, (path) =>
    path === "/subs"
      ? [{ name: pack, isDirectory: true, isFile: false, isSymlink: false }]
      : [file(episodeFour), file(episodeSeventeen)],
  );
  const src: PlayerSrc = {
    ...movie,
    meta: {
      id: "kitsu:123",
      type: "series",
      name: "Re:ZERO -Starting Life in Another World- Season 2 Part 2",
    },
    episode: { season: 2, episode: 4, absoluteNumber: 42 },
    isAnime: true,
  };
  const settings = { ...player.settings, preferredSubLangs: ["Arabic"] };

  await player.render({ src, settings });
  assert.equal(player.bridge.addSubtitle.mock.callCount(), 0);

  await player.render({
    src: { ...src, episode: { season: 2, episode: 4, imdbSeason: 2, imdbEpisode: 17 } },
    settings,
  });
  assert.equal(player.bridge.addSubtitle.mock.callCount(), 1);
  const [path, language, , selected, metadata] = player.bridge.addSubtitle.mock.calls[0].arguments;
  assert.equal(path, `/subs/${pack}/${episodeSeventeen}`);
  assert.equal(language, "ar");
  assert.equal(selected, true);
  assert.equal(metadata?.imported, true);
});

test("a manual selection while the folder is being scanned takes precedence", async (t) => {
  const files = Promise.withResolvers<DirEntry[]>();
  const player = subtitlePlayer(t, () => files.promise);
  await player.render();
  assert.deepEqual(player.paths, ["/subs"]);

  player.pickManually();
  await act(async () => files.resolve([file("交差点.2024.eng.srt")]));

  assert.equal(player.bridge.addSubtitle.mock.callCount(), 1);
  assert.equal(player.bridge.addSubtitle.mock.calls[0].arguments[3], false);
  assert.equal(player.bridge.setSubtitleTrack.mock.callCount(), 0);
});

test("lists an exact local match outside the preferred languages without selecting it", async (t) => {
  const player = subtitlePlayer(t, () => [file("交差点.2024.ara.srt")]);
  await player.render();
  const [path, language, , selected, metadata] = player.bridge.addSubtitle.mock.calls[0].arguments;
  assert.equal(path, "/subs/交差点.2024.ara.srt");
  assert.equal(language, "ar");
  assert.equal(selected, false);
  assert.equal(metadata?.imported, true);
});

test("switching movies invalidates a pending scan even when the player bridge is reused", async (t) => {
  const oldFiles = Promise.withResolvers<DirEntry[]>();
  const player = subtitlePlayer(t, (path) => {
    if (path === "/old-subs") return oldFiles.promise;
    assert.equal(path, "/subs");
    return [file("Another Film.2022.eng.srt")];
  });
  await player.render({ settings: { ...player.settings, localSubtitleFolder: "/old-subs" } });
  await player.render({
    src: {
      url: "https://media.example/another",
      title: "Another Film",
      meta: { id: "tt7654321", type: "movie", name: "Another Film", releaseInfo: "2022" },
    },
  });
  await act(async () => oldFiles.resolve([file("交差点.2024.eng.srt")]));

  assert.deepEqual(player.paths, ["/old-subs", "/subs"]);
  assert.deepEqual(
    player.bridge.addSubtitle.mock.calls.map(({ arguments: [path] }) => path),
    ["/subs/Another Film.2022.eng.srt"],
  );
});
