import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { CustomStreamFilter } from "@/lib/streams/custom-filters";
import type { StreamMode } from "@/lib/streams/mode";
import type { ScoredStream, Stream } from "@/lib/streams/types";
import type { ModernListProps } from "@/views/play-picker/modern/modern-list";
import type { ModernShellProps } from "@/views/play-picker/modern/modern-shell";
import { LAYOUTS, RESULTS, aggregatorAnswer } from "./helpers/aggregator-results.ts";
import { act, pointer, renderModern, source, type LookProps } from "./helpers/modern-picker.tsx";

const { StreamModeToggle } = await import("@/components/stream-mode-toggle");
const { findRememberedSourceMatch } = await import("@/lib/playback-history");
const { hasCachedMarker, hasUncachedMarker } = await import("@/lib/streams/cached");
const { matchesCustomFilter } = await import("@/lib/streams/custom-filters");
const { filterStreamsByMode } = await import("@/lib/streams/mode");
const { parseStream } = await import("@/lib/streams/parser/parser-stream");
const rules = await import("@/views/play-picker/modern/modern-rules");
const { anyStreamCached, streamIsCached, streamMatchesLangs } =
  await import("@/views/play-picker/picker-utils");
const { FACET_DIMS, facetOptions, matchesFacets } =
  await import("@/views/play-picker/stream-facets");

// --- the page -----------------------------------------------------------------------------------

const pageSource = ts.createSourceFile(
  "play-picker.tsx",
  readFileSync(new URL("../src/views/play-picker.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const pageCode = new Map<string, string>();

/** What the page itself hands to the hook behind a name, or what it reckons the name to be. */
function codeOf(name: string): string {
  const known = pageCode.get(name);
  if (known) return known;
  let code: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(pageSource) === name &&
      node.initializer
    ) {
      const { initializer } = node;
      const own = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer;
      code = own.getText(pageSource);
    }
    ts.forEachChild(node, visit);
  };
  visit(pageSource);
  assert.ok(code, `the page has no ${name}`);
  const { outputText } = ts.transpileModule(`(${code})`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  pageCode.set(name, outputText);
  return outputText;
}

function runPage(name: string, scope: Record<string, unknown>): unknown {
  return new Function(...Object.keys(scope), `return ${codeOf(name)}`)(...Object.values(scope));
}

type Debrids = ModernListProps["debrids"];
type Asked = {
  look: "modern" | "stremio" | "condensed";
  cachedOnly: boolean;
  streamMode: StreamMode;
  debrids: Debrids;
  languages: string[];
  filter: CustomStreamFilter | null;
};
type PageList = {
  all: ScoredStream[];
  ranked: ScoredStream[];
  primary: ScoredStream | null;
  fellBack: boolean;
  noneCached: boolean;
};

const debrids = (...list: { slug: string; name: string }[]) => list as Debrids;
const RD = { slug: "rd", name: "Real-Debrid" };
const ASKED: Asked = {
  look: "modern",
  cachedOnly: false,
  streamMode: "both",
  debrids: debrids(RD),
  languages: [],
  filter: null,
};

const isCachedOnPage = (keys: Debrids) =>
  runPage("isCached", { debrids: keys, hasCachedMarker, hasUncachedMarker }) as (
    s: ScoredStream,
  ) => boolean;

/** The list the page makes of what the add-ons sent. */
function pageList(sent: ScoredStream[], asked: Partial<Asked> = {}): PageList {
  const now = { ...ASKED, ...asked };
  const scope = {
    ...rules,
    result: { picker: { all: sent, primary: sent[0] ?? null } },
    isSeasonDownload: false,
    meta: { id: "tt0000001" },
    episode: undefined,
    settings: { streamMode: now.streamMode },
    filterStreamsByMode,
    langFilter: now.languages.length > 0,
    preferredLangs: now.languages,
    streamMatchesLangs,
    cachedOnly: now.cachedOnly,
    modern: now.look === "modern",
    debrids: now.debrids,
    isCached: isCachedOnPage(now.debrids),
    activeStreamFilter: now.filter,
    matchesCustomFilter,
    hostMatch: null,
  };
  return (runPage("filteredPicker", scope) as () => PageList)();
}

const LOOKS = ["modern", "stremio", "condensed"] as const;

/** What the page starts by itself, opened to resume what was played last or asked by a room's host. */
function byItself(sent: ScoredStream[], asked: Partial<Asked>, last: ScoredStream) {
  const scope = {
    filteredPicker: pageList(sent, asked),
    previousPlayback: { ...last, savedAt: 1 },
    findRememberedSourceMatch,
    isCached: isCachedOnPage(asked.debrids ?? ASKED.debrids),
    continuation: undefined,
    episode: undefined,
    isAnimeMetaId: false,
    inviteKey: "tt0000001||",
    isLiveLikeContent: false,
    isDownload: false,
    roomGuestPick: false,
    inSession: false,
    attempt: undefined,
    autoPlay: false,
    autoCancelled: false,
    autoExhausted: false,
    rememberedAddonPending: false,
    p2pAutoConsent: true,
    resume: true,
    wasInvitedTo: () => false,
  };
  const previousMatch = (runPage("previousMatch", scope) as () => ScoredStream | null)();
  const found = { ...scope, previousMatch };
  const rememberedInstant = runPage("rememberedInstant", found);
  return {
    resumed: runPage("rememberedHandledFirst", { ...found, rememberedInstant })
      ? previousMatch!.releaseGroup
      : null,
    asked: runPage("autoActive", { ...found, wasInvitedTo: () => true }),
  };
}

// --- the look in it -----------------------------------------------------------------------------

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];
const names = () => rows().map((row) => row.querySelector("[data-name]")!.textContent);
const picks = () => document.querySelectorAll("[data-pick]").length;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
const cachedOnly = () => document.querySelector<HTMLButtonElement>('[role="switch"]')!;
const isOn = () => cachedOnly().getAttribute("aria-checked") === "true";
const says = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const list = () => document.querySelector("[data-list]")!.textContent!;

type Page = {
  ask: (next: Partial<Asked>) => Promise<void>;
  /** The add-ons were asked again. */
  refresh: (sent: ScoredStream[]) => Promise<void>;
  filter: (key: "resolution" | "availability", value: string | null) => Promise<void>;
};

/** The look with what the page hands it, and with the page's own switch of the source mode. */
async function inPage(
  sent: ScoredStream[],
  asked: Partial<Asked>,
  run: (page: Page) => Promise<void>,
  more: Partial<ModernListProps> = {},
) {
  let now: Asked = { ...ASKED, ...asked };
  let sources = sent;
  const drawn = (): [LookProps, Partial<ModernShellProps>] => {
    const { all, ranked, primary, noneCached } = pageList(sources, now);
    const modeSwitch = (
      <StreamModeToggle mode={now.streamMode} onChange={(streamMode) => void ask({ streamMode })} />
    );
    return [
      { streams: all, ranked, preferred: primary, debrids: now.debrids, modeSwitch, ...more },
      {
        cachedOnly: now.cachedOnly,
        noneCached,
        onCachedOnly: (on) => void ask({ cachedOnly: on }),
      },
    ];
  };
  const [props, shell] = drawn();
  const view = await renderModern(props, { shell });
  const ask = async (next: Partial<Asked>) => {
    now = { ...now, ...next };
    if (next.streamMode) await view.update({ streamMode: next.streamMode });
    await view.rerender(...drawn());
  };
  try {
    await run({
      ask,
      refresh: async (fresh) => {
        sources = fresh;
        await view.rerender(...drawn());
      },
      filter: (key, value) => act(() => view.state().setFilter(key, value)),
    });
  } finally {
    await view.unmount();
  }
}

const torrent = (group: string, partial: Partial<ScoredStream> = {}) =>
  source(`A.Film.2020.1080p.WEB-DL.H.264-${group}.mkv`, partial);
const link = (group: string, partial: Partial<ScoredStream> = {}) =>
  torrent(group, { infoHash: undefined, url: `https://play.test/${group}`, ...partial });
const notice = (name: string) =>
  link("NOTICE", { name, title: undefined, url: undefined, externalUrl: "https://page.test" });

/** Three that are cached, each in a way of its own, and three torrents that are not. */
const six = () => [
  torrent("ALPHA", { cached: { rd: true } }),
  link("BRAVO", { name: "⚡ Made-up" }),
  link("CHARLIE"),
  torrent("DELTA"),
  torrent("ECHO"),
  torrent("FOXTROT"),
];
const CACHED = ["ALPHA", "BRAVO", "CHARLIE"];
const TORRENTS = ["DELTA", "ECHO", "FOXTROT"];
const torrents = () => six().slice(3);

// --- Cached only --------------------------------------------------------------------------------

test("with Cached only on, a switch to P2P shows no source that is not cached", () =>
  inPage(six(), {}, async () => {
    assert.deepEqual(names(), [...CACHED, ...TORRENTS]);
    await act(() => cachedOnly().click());
    assert.deepEqual(names(), CACHED);
    assert.equal(says("[data-tally]"), "3 sources · 3 ready to start at once");

    await act(() => button("P2P")!.click());
    assert.deepEqual(names(), [], "none of the torrents is cached");
    assert.equal(picks(), 0, "and none of them is the pick");
    assert.equal(says("[data-tally]"), "None of the 3 sources match these filters.");
    assert.match(list(), /All 3 sources are hidden by the active filter\./);
    assert.deepEqual([isOn(), cachedOnly().disabled], [true, false], "the switch is as it was");
    assert.equal(button("P2P")!.getAttribute("aria-pressed"), "true", "the mode keeps its place");

    await act(() => button("Both")!.click());
    assert.deepEqual([names(), isOn()], [CACHED, true], "what is cached is there again");
  }));

const MODES: readonly StreamMode[] = ["both", "addons", "p2p"];
const GERMAN = ["German"];
const saved = (partial: Partial<CustomStreamFilter>) => ({ id: "own", name: "Own", ...partial });
/** A saved filter that only the torrents match, and one that nothing does. */
const SMALL = saved({ maxSizeGb: 1 });
const IN_4K = saved({ resolution: ["4K"] });

type State = [
  what: string,
  sent: ScoredStream[],
  asked: Partial<Asked>,
  /** Who of it is cached, and who with the source mode Direct/debrid, if that is not the same. */
  left: string[],
  direct?: string[],
];
const states = (): State[] => {
  const german = six().map((s, i) => ({ ...s, audioLanguages: i === 3 ? GERMAN : ["English"] }));
  const sized = six().map((s, i) => ({ ...s, size: (i < 3 ? 9 : 0.5) * 1024 ** 3 }));
  return [
    ["some are cached", six(), {}, CACHED],
    ["nothing is cached", torrents(), {}, []],
    ["one source, and it is not cached", six().slice(5), {}, []],
    ["only a web page has a sign", [...torrents(), notice("⚡ Counted")], {}, []],
    ["what is cached speaks another language", german, { languages: GERMAN }, [], CACHED],
    ["a saved filter matches what is not cached", sized, { filter: SMALL }, CACHED],
    ["a saved filter matches nothing", six(), { filter: IN_4K }, CACHED],
    ["a saved filter, and nothing is cached", sized.slice(3), { filter: SMALL }, []],
    ["a saved filter matches nothing, nothing is cached", torrents(), { filter: IN_4K }, []],
  ];
};

test("no state shows a source that is not cached while Cached only is on", async () => {
  for (const [what, sent, asked, left, direct = left] of states()) {
    for (const streamMode of MODES) {
      const here = `${what}, ${streamMode}`;
      // ALPHA is cached on a debrid, so it is no torrent of the mode P2P.
      const expected = { both: left, addons: direct, p2p: [] }[streamMode];
      await inPage(sent, { ...asked, streamMode, cachedOnly: true }, async () => {
        assert.deepEqual(names(), expected, here);
        assert.deepEqual([isOn(), cachedOnly().disabled, !button("Clear")], [true, false, false]);
        const said = says("[data-tally]")!;
        if (expected.length > 0) {
          assert.equal(said, "3 sources · 3 ready to start at once", here);
          return;
        }
        assert.match(said, /^(No source matches|None of the \d+ sources match) these filters\.$/);
        assert.match(list(), /All \d+ sources? (is|are) hidden by the active filter\./, here);
        assert.equal(picks(), 0, here);
      });
    }
  }
});

test("a refresh that brings nothing cached, and one that does", () =>
  inPage(six(), { cachedOnly: true }, async (page) => {
    assert.deepEqual(names(), CACHED);
    await page.refresh(torrents());
    assert.deepEqual([names(), isOn()], [[], true]);
    assert.equal(says("[data-tally]"), "None of the 3 sources match these filters.");
    await page.refresh(six().slice(2));
    assert.deepEqual(names(), ["CHARLIE"]);
    assert.equal(says("[data-tally]"), "1 source · 1 ready to start at once");
  }));

test("a switch of the mode empties a held list too, as everything asked for applies at once", () =>
  inPage(six(), { cachedOnly: true }, async (page) => {
    await pointer("enter", document.querySelector("[data-rows]")!);
    await page.refresh(torrents());
    assert.deepEqual(names(), CACHED, "held, as with every other filter");
    assert.match(says("[data-changed]")!, /The list has changed\./);
    await page.ask({ streamMode: "p2p" });
    assert.deepEqual(names(), []);
  }));

test("the empty list says how many it hides, and its button brings them back", async () => {
  for (const [sent, side, said] of [
    [
      torrents(),
      "None of the 3 sources match these filters.",
      "All 3 sources are hidden by the active filter.Clear filters",
    ],
    [
      six().slice(5),
      "No source matches these filters.",
      "All 1 source is hidden by the active filter.Clear filters",
    ],
  ] as const) {
    await inPage([...sent], { cachedOnly: true }, async () => {
      assert.equal(says("[data-tally]"), side);
      assert.ok(list().endsWith(said), list());
      await act(() => button("Clear filters")!.click());
      assert.deepEqual([rows().length, isOn()], [sent.length, false]);
      assert.equal(cachedOnly().disabled, true, "there is nothing to show alone");
      assert.ok(!button("Clear"));
    });
  }
});

test("Clear lets everything go that hides the sources, with a filter of the look too", async () => {
  for (const label of ["Clear", "Clear filters"]) {
    await inPage(six(), { cachedOnly: true, streamMode: "p2p" }, async (page) => {
      await page.filter("resolution", "4K");
      assert.deepEqual(names(), []);
      await act(() => button(label)!.click());
      assert.deepEqual([names(), isOn()], [TORRENTS, false], label);
    });
  }
});

test("the list's own button leaves Cached only on where something is cached", () =>
  inPage(six(), { cachedOnly: true }, async (page) => {
    await page.filter("resolution", "4K");
    assert.deepEqual(names(), []);
    assert.match(list(), /All 3 sources are hidden by the active filter\./, "the cached ones");
    await act(() => button("Clear filters")!.click());
    assert.deepEqual([names(), isOn()], [CACHED, true]);
  }));

test("the filters stay where they are and offer nothing", () =>
  inPage(
    [torrent("DELTA"), torrent("ECHO", { resolution: "4K" }), torrent("FOXTROT")],
    { cachedOnly: true },
    async (page) => {
      const choices = () =>
        [...document.querySelectorAll<HTMLButtonElement>('[data-group="resolution"] button')].map(
          (b) => `${b.textContent}${b.disabled ? " off" : ""}`,
        );
      assert.deepEqual(choices(), ["Any", "4K0 off", "1080p0 off"]);
      await page.ask({ cachedOnly: false });
      assert.deepEqual(choices(), ["Any", "4K1", "1080p2"]);
    },
  ));

test("the look follows the page's word also when the list is the same one", async () => {
  const streams = torrents();
  const view = await renderModern({ streams });
  try {
    for (const noneCached of [true, false]) {
      await view.rerender({}, { cachedOnly: noneCached, noneCached });
      assert.equal(rows().length, noneCached ? 0 : 3);
      assert.equal(says("[data-tally]")!.startsWith("None of the 3"), noneCached);
    }
  } finally {
    await view.unmount();
  }
});

test("while add-ons still answer the empty list is the same, and something cached comes in", () => {
  const addons = ["a", "b"].map((id) => ({
    transportUrl: `https://${id}.test/manifest.json`,
    manifest: { id, name: id.toUpperCase(), resources: ["stream"] },
  })) as unknown as ModernListProps["addons"];
  return inPage(
    torrents(),
    { cachedOnly: true },
    async (page) => {
      assert.deepEqual(names(), []);
      assert.equal(says("[data-tally]"), "None of the 3 sources match these filters.");
      assert.match(says("[data-waiting]")!, /Waiting for/);
      await page.refresh(six().slice(1));
      assert.deepEqual(names(), ["BRAVO", "CHARLIE"]);
    },
    { pipelineDone: false, addons },
  );
});

test("with no source at all there is nothing that the switch hides", () => {
  for (const look of LOOKS) {
    for (const streamMode of MODES) {
      const { all, noneCached } = pageList([], { look, streamMode, cachedOnly: true });
      assert.deepEqual([all, !noneCached], [[], true], "so the page says what it found");
    }
  }
});

/** What was played last, from an add-on of its own. */
const LAST = { addonId: "made.up.last", infoHash: "f".repeat(40) };
const lastLink = (name: string) => link("GOLF", { ...LAST, infoHash: undefined, name });

test("nothing starts by itself while Cached only hides every source", () => {
  for (const last of [lastLink("⏳ Made-up"), torrent("GOLF", LAST)]) {
    const sent = [...torrents(), last];
    for (const look of LOOKS) {
      for (const streamMode of MODES) {
        const listed = pageList(sent, { look, streamMode }).all.includes(last);
        for (const on of [false, true]) {
          const here = `${look}, ${streamMode}, ${last.url ?? "a torrent"}, ${on}`;
          const hidden = on && look === "modern";
          const starts = byItself(sent, { look, streamMode, cachedOnly: on }, last);
          assert.equal(starts.resumed, listed && !hidden ? "GOLF" : null, here);
          assert.equal(starts.asked, !hidden, here);
        }
      }
    }
  }
});

test("where something is cached only that starts by itself, in every look as before", () => {
  for (const [sign, resumed] of [
    ["⚡", "GOLF"],
    ["⏳", null],
  ]) {
    const last = lastLink(`${sign} Made-up`);
    const sent = [...six(), last];
    for (const look of LOOKS) {
      const on = { look, cachedOnly: true };
      assert.deepEqual(byItself(sent, on, last), { resumed, asked: true }, look);
      assert.deepEqual(byItself(sent, { look }, last), { resumed: "GOLF", asked: true }, look);
    }
  }
});

test("the page says nothing of a list that the modern look does not show", () => {
  const asked = { cachedOnly: true, filter: IN_4K };
  assert.equal(pageList(torrents(), asked).fellBack, false, 'not "Showing all sources."');
  assert.equal(pageList(torrents(), { ...asked, cachedOnly: false }).fellBack, true);
  assert.equal(pageList(torrents(), { ...asked, look: "condensed" }).fellBack, true);
  assert.equal(pageList(six(), asked).fellBack, true, "nor where the cached ones are shown");
  assert.match(
    pageSource.text.replace(/\s+/g, " "),
    /\( !isSeasonDownload && !filteredPicker\?\.noneCached && \( <PickerEmptyLadder /,
    'not "Only 1 source after filtering"',
  );
});

// --- the two other looks ------------------------------------------------------------------------

test("the Stremio and Condensed looks show what they did, whatever is cached", () => {
  for (const [what, sent, asked] of states()) {
    for (const look of ["stremio", "condensed"] as const) {
      for (const keys of [debrids(RD), debrids()]) {
        for (const streamMode of MODES) {
          for (const on of [true, false]) {
            const here = `${look}: ${what}, ${streamMode}, ${keys.length} debrids, ${on}`;
            const set = { ...asked, look, streamMode, debrids: keys, cachedOnly: on };
            const page = pageList(sent, set);
            // The page's lines from before the modern look, on the same sources.
            let all = filterStreamsByMode(sent, streamMode);
            if (asked.languages) {
              const spoken = all.filter((s) => streamMatchesLangs(s, asked.languages!));
              if (spoken.length > 0) all = spoken;
            }
            if (on && keys.length > 0) {
              const cached = all.filter(isCachedOnPage(keys));
              if (cached.length > 0) all = cached;
            }
            let fellBack = false;
            if (asked.filter) {
              const matched = all.filter((s) => matchesCustomFilter(s, asked.filter!));
              if (matched.length > 0) all = matched;
              else fellBack = true;
            }
            assert.equal(page.all.length, all.length, here);
            assert.ok(
              page.all.every((s, i) => s === all[i]),
              here,
            );
            assert.equal(page.fellBack, fellBack, here);
            assert.ok(!page.noneCached, `${here}: nothing of it is told to them`);
          }
        }
      }
    }
  }
});

test("in the other looks the same switch to P2P shows the torrents, as before", () => {
  const sent = six();
  for (const look of ["stremio", "condensed"] as const) {
    const on = { look, cachedOnly: true };
    assert.deepEqual(pageList(sent, on).all, sent.slice(0, 3), look);
    assert.deepEqual(pageList(sent, { ...on, streamMode: "p2p" }).all, sent.slice(3), look);
    assert.deepEqual(pageList(sent, { ...on, debrids: debrids() }).all, sent, "with no debrid");
  }
});

// --- one meaning of cached ----------------------------------------------------------------------

const TB = { slug: "tb", name: "TorBox", queueCache: () => undefined };
const KEYS = debrids(RD, TB);

/** A source as Harbor reads it from what its add-on sends. */
const read = (group: string, stream: Partial<Stream>, known: Partial<ScoredStream> = {}) => {
  const filename = `A.Film.2020.1080p.WEB-DL.H.264-${group}.mkv`;
  const sent = { addonId: "made.up", addonName: "Made-up", name: "Made-up", title: filename };
  const parsed = parseStream({ ...sent, behaviorHints: { filename }, ...stream });
  return { ...parsed, score: 0, reasons: [], tier: "1080p", ...known } as ScoredStream;
};

let hashes = 0;
const hash = () => ({ infoHash: (hashes += 1).toString(16).padStart(40, "c") });
const at = (path: string) => ({ url: `https://made-up.test/${path}` });
const checked = { cached: { rd: true }, cacheVerified: { rd: true } };

type Kind = [
  group: string,
  stream: Partial<Stream>,
  /** What its row says with keys for Real-Debrid and TorBox in Harbor. */
  words: string,
  /** What the Stremio look's filter calls it. */
  facet: "Cached" | "Debrid" | "P2P",
  known?: Partial<ScoredStream>,
];
const KINDS: readonly Kind[] = [
  // What Harbor asked a debrid.
  ["CHECKED", hash(), "Cached on Real-Debrid", "Cached", checked],
  [
    "OWNED",
    hash(),
    "In your Real-Debrid library",
    "Cached",
    { ...checked, inLibrary: { rd: true } },
  ],
  ["SHELVED", hash(), "In your Real-Debrid library", "P2P", { inLibrary: { rd: true } }],
  // Only the add-on says it, by a sign or of a debrid without a key here, so no debrid is named.
  ["SIGNED", { name: "⚡ Made-up 1080p", ...at("signed") }, "Cached", "Debrid"],
  ["TICKED", { name: "Made-up ✅", ...hash() }, "Cached", "Debrid"],
  ["ELSEWHERE", { name: "[AD+] Made-up", ...hash() }, "Cached", "Cached"],
  [
    "CLOCKED",
    { name: "[AD+] Made-up", description: "⏳ 2h", ...at("clocked") },
    "Cached",
    "Cached",
  ],
  // A link starts at once if its add-on does not say otherwise. Its row says nothing of that.
  ["PLAIN", at("plain"), "", "Debrid"],
  // A torrent's own link says nothing of a cache, and without an address there is none.
  ["BOTH", { ...at("both"), ...hash() }, "", "P2P"],
  ["EMPTY", { url: "" }, "Not cached yet", "Debrid"],
  ["WAITING", { name: "⏳ Made-up", ...at("waiting") }, "Not cached yet", "Debrid"],
  ["FETCHED", { name: "[RD download] Made-up", ...hash() }, "Not cached yet", "Debrid"],
  ["TORRENT", hash(), "Not cached yet", "P2P"],
  ["QUEUED", hash(), "Queued on TorBox", "P2P"],
  // What only opens a web page is never cached, not even where its text names a debrid.
  [
    "PAGE",
    { name: "⚡ 24 ready ✅", title: undefined, externalUrl: "https://made-up.test/page" },
    "External",
    "Debrid",
  ],
  [
    "SIGNPOST",
    { name: "[TB+] SIGNPOST", title: undefined, externalUrl: "https://made-up.test/signpost" },
    "External",
    "Cached",
  ],
];
const kinds = () => KINDS.map(([group, stream, , , known]) => read(group, stream, known));
const groupsOf = (which: (kind: Kind) => boolean) => KINDS.filter(which).map(([group]) => group);
const CACHED_WORDS = /^(?:Cached|In your) ?/;
const READY = groupsOf(([group, , words]) => group === "PLAIN" || CACHED_WORDS.test(words));

const groupOf = (row: HTMLElement) => {
  const release = row.querySelector("[data-release]")!.textContent!;
  return KINDS.find(([group]) => release.includes(group))?.[0] ?? "PAGE";
};
const availability = (row: HTMLElement) =>
  row.querySelector('[data-cell="from"] p')?.textContent ?? "";
const callCached = () => rows().filter((row) => CACHED_WORDS.test(availability(row)));
const choices = () =>
  new Map(
    [...document.querySelectorAll('[data-group="availability"] button')].map((b) => [
      b.querySelector("bdi")!.textContent!,
      Number(b.querySelector("span")?.textContent),
    ]),
  );
const ready = () => Number(/(\d+) ready to start at once$/.exec(says("[data-tally]")!)![1]);

test("a source that its add-on calls cached is found under Availability, Cached", () =>
  inPage(kinds(), { debrids: KEYS }, async (page) => {
    await page.filter("availability", "Cached");
    for (const group of ["SIGNED", "TICKED"]) {
      assert.ok(rows().map(groupOf).includes(group), `the row of ${group} says "Cached"`);
    }
  }));

test("a plain link is counted, kept and found as cached, and its row says nothing of it", () =>
  inPage([read("PLAIN", at("plain")), read("TORRENT", hash())], { debrids: KEYS }, async (page) => {
    assert.deepEqual(rows().map(availability), ["", "Not cached yet"]);
    assert.equal(says("[data-tally]"), "2 sources · 1 ready to start at once", "counted");

    await act(() => button("More filters")!.click());
    assert.deepEqual([...choices()].slice(1), [
      ["Cached", 1],
      ["P2P", 1],
    ]);
    await page.filter("availability", "Cached");
    assert.deepEqual(rows().map(groupOf), ["PLAIN"], "found");
    assert.deepEqual(rows().map(availability), [""]);
    await page.filter("availability", null);

    await act(() => cachedOnly().click());
    assert.deepEqual(rows().map(groupOf), ["PLAIN"], "kept");
    assert.deepEqual(rows().map(availability), [""]);
  }));

test("a web page is under no choice of Availability, whatever its text says", () => {
  const sent = kinds();
  const pages = groupsOf(([, stream]) => !!stream.externalUrl);
  const shown = () => pages.filter((group) => rows().map(groupOf).includes(group));
  const signs = sent.filter((_, i) => pages.includes(KINDS[i][0])).map((s) => s.cached);
  assert.deepEqual(signs, [{}, { tb: true }], "what Harbor reads in their texts");
  return inPage(sent, { debrids: KEYS }, async (page) => {
    assert.deepEqual(shown(), pages);
    await act(() => button("More filters")!.click());
    for (const value of ["Cached", "Debrid", "P2P"]) {
      await page.filter("availability", value);
      assert.deepEqual(shown(), [], value);
    }
    await page.filter("availability", null);
    await act(() => cachedOnly().click());
    assert.deepEqual(shown(), [], "Cached only");
  });
});

test("the rows, the count, Cached only and the Availability filter mean the same by cached", async () => {
  for (const keys of [KEYS, debrids(RD), debrids()]) {
    const here = `${keys.length} debrids`;
    const sent = kinds();
    const queuedHash = sent[KINDS.findIndex(([group]) => group === "QUEUED")].infoHash!;
    await inPage(
      sent,
      { debrids: keys },
      async (page) => {
        const words = rows().map(availability);
        if (keys === KEYS)
          assert.deepEqual(
            words,
            KINDS.map(([, , said]) => said),
          );
        // Without its key nobody has asked that debrid, and of a link no row says anything.
        const silent = keys.length > 0 ? ["PLAIN"] : ["PLAIN", "SHELVED"];
        const said = READY.filter((group) => !silent.includes(group));
        assert.deepEqual(callCached().map(groupOf), said, here);
        assert.equal(ready(), READY.length, here);

        await act(() => button("More filters")!.click());
        assert.equal(choices().get("Cached"), READY.length, here);
        for (const [value, count] of choices()) {
          if (value === "Any") continue;
          await page.filter("availability", value);
          assert.equal(rows().length, count, `${here}: ${value}`);
          assert.equal(callCached().length, value === "Cached" ? said.length : 0, value);
          if (value === "Cached") assert.deepEqual(rows().map(groupOf), READY, here);
        }
        await page.filter("availability", null);

        await act(() => cachedOnly().click());
        assert.deepEqual(rows().map(groupOf), READY, `${here}: Cached only`);
        assert.equal(ready(), READY.length, here);
      },
      { queuedHash },
    );
  }
});

test("without a debrid in Harbor the same sources are cached", async () => {
  for (const [what, sent, asked, left, direct = left] of states()) {
    for (const streamMode of MODES) {
      const expected = { both: left, addons: direct, p2p: [] }[streamMode];
      const set = { ...asked, streamMode, debrids: debrids(), cachedOnly: true };
      await inPage(sent, set, async () => {
        assert.deepEqual(names(), expected, `${what}, ${streamMode}`);
      });
    }
  }
});

test("what an aggregator sends is counted, kept and found as cached, or none of it", async () => {
  for (const layout of LAYOUTS) {
    const sent = aggregatorAnswer(layout, RESULTS, "bottom").map(
      (stream) => ({ ...parseStream(stream), score: 0, reasons: [], tier: "SD" }) as ScoredStream,
    );
    for (const keys of [KEYS, debrids()]) {
      const here = `${layout}, ${keys.length} debrids`;
      await inPage(sent, { debrids: keys }, async (page) => {
        const all = ready();
        const called = callCached().length;
        const not = rows().filter((row) => /^(?:Not cached|External)/.test(availability(row)));
        assert.ok(called <= all && all <= rows().length - not.length, here);
        await act(() => button("More filters")!.click());
        assert.equal(choices().get("Cached"), all, here);
        await page.filter("availability", "Cached");
        assert.deepEqual([rows().length, callCached().length], [all, called], here);
        await page.filter("availability", null);
        await act(() => cachedOnly().click());
        assert.deepEqual([rows().length, callCached().length], [all, called], here);
      });
    }
  }
});

test("the words name a debrid with a key, whoever calls the source cached on it", async () => {
  const one = (name: string) => kinds()[KINDS.findIndex(([group]) => group === name)];
  const told = read("TOLD", { name: "[RD+] Made-up", ...hash() });
  assert.deepEqual([told.cached, told.cacheVerified], [{ rd: true }, {}], "its text alone says so");
  assert.deepEqual(one("CHECKED").cacheVerified, { rd: true });
  for (const [stream, row, pick] of [
    [one("OWNED"), "In your Real-Debrid library", "In your Real-Debrid library."],
    [one("CHECKED"), "Cached on Real-Debrid", "Cached on Real-Debrid, so it starts at once."],
    [told, "Cached on Real-Debrid", "Cached on Real-Debrid, so it starts at once."],
    [one("SIGNED"), "Cached", "Cached, so it starts at once."],
    [one("ELSEWHERE"), "Cached", "Cached, so it starts at once."],
    [one("PLAIN"), "", null],
  ] as const) {
    const here = stream.releaseGroup ?? "";
    await inPage([stream], { debrids: KEYS }, async () => {
      assert.equal(availability(rows()[0]), row, here);
      assert.equal(says("[data-pick-why]"), pick, here);
      assert.equal(says("[data-tally]"), "1 source · 1 ready to start at once", here);
    });
  }
});

test("the Stremio look, Big Picture and the page's own test call cached what they did", () => {
  const sent = kinds();
  const dim = FACET_DIMS.find(({ key }) => key === "cached")!;
  const pages = ["PAGE", "SIGNPOST"];
  const badged = [...READY.filter((group) => !/SHELVED|PLAIN/.test(group)), ...pages];
  const onPage = [...READY.filter((group) => !/ELSEWHERE|CLOCKED/.test(group)), "EMPTY", ...pages];
  for (const [i, [group, , , facet]] of KINDS.entries()) {
    assert.equal(dim.valueOf(sent[i]), facet, group);
    assert.equal(isCachedOnPage(KEYS)(sent[i]), onPage.includes(group), group);
    assert.equal(streamIsCached(sent[i], KEYS), onPage.includes(group), group);
    assert.equal(anyStreamCached(sent[i]), badged.includes(group), group);
  }
  assert.deepEqual(facetOptions(sent, dim), [
    { key: "Cached", count: 5 },
    { key: "Debrid", count: 7 },
    { key: "P2P", count: 4 },
  ]);
  for (const value of dim.order) {
    const found = sent.filter((s) => matchesFacets(s, { cached: value }));
    assert.deepEqual(
      found.map((s) => KINDS[sent.indexOf(s)][0]),
      groupsOf(([, , , facet]) => facet === value),
      value,
    );
  }
});
