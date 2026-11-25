import assert from "node:assert/strict";
import test from "node:test";
import { streamDubSub } from "../src/components/dub-sub-pill.tsx";
import { enhanceAnimeStreams } from "../src/lib/streams/anitomy.ts";
import { qualityConfidence } from "../src/components/format-badge.tsx";
import { parseStream } from "../src/lib/streams/parser/parser-stream.ts";
import type { ScoredStream, Stream } from "../src/lib/streams/types.ts";
import {
  applyModernFilters,
  dimValues,
  hasAtmos,
  holdRows,
  knownResolution,
  modernGroups,
  nextModernSort,
  pickModern,
  pickReasons,
  readModernSort,
  sortModern,
  sourceLine,
  sourceName,
  sourceTitle,
  type ModernContext,
  type ModernDimKey,
  type ModernGroup,
  type ModernSort,
  type ModernSortKey,
} from "../src/views/play-picker/modern/modern-rules.ts";

const GB = 1024 ** 3;

const mk = (partial: Partial<ScoredStream> = {}): ScoredStream =>
  ({
    addonId: "addon",
    addonName: "Addon",
    resolution: "1080p",
    hdrFormat: null,
    codec: "AVC",
    source: "WEB-DL",
    audio: { codec: "AAC", channels: 2 },
    audioLanguages: [],
    size: null,
    seeders: null,
    cached: {},
    cacheVerified: {},
    inLibrary: {},
    releaseGroup: null,
    remux: false,
    seasonPack: false,
    score: 0,
    reasons: [],
    tier: "1080p",
    ...partial,
  }) as ScoredStream;

/** The source as Harbor's own parser reads it, so "not read" means what it means in the app. */
const read = (partial: Partial<Stream>): ScoredStream => ({
  ...parseStream({ addonId: "addon", addonName: "Addon", ...partial }),
  score: 0,
  reasons: [],
  tier: "SD",
});

const groups = (list: ScoredStream[]) => list.map((s) => s.releaseGroup);
const by = (key: ModernSortKey, dir: ModernSort["dir"]): ModernSort => ({ key, dir });

test("a source is named by its release group", () => {
  assert.equal(sourceName(mk({ releaseGroup: "SubsPlease" })), "SubsPlease");
});

test("without a release group the first line of the add-on's label is the name", () => {
  assert.equal(
    sourceName(mk({ releaseGroup: null, name: "Torrentio\n4k DV", addonName: "Other" })),
    "Torrentio",
  );
  assert.equal(sourceName(mk({ releaseGroup: " ", name: "\n  Comet 1080p \nx" })), "Comet 1080p");
});

test("without a group and a label the add-on's name is the name", () => {
  assert.equal(sourceName(mk({ releaseGroup: null, name: "  ", addonName: "Comet" })), "Comet");
  assert.equal(sourceName(mk({ releaseGroup: null, addonName: "Comet" })), "Comet");
});

test("a heading goes through its usual direction, the other one, and back to the page's order", () => {
  const seeders = nextModernSort(null, "seeders");
  assert.deepEqual(seeders, { key: "seeders", dir: "desc" });
  const turned = nextModernSort(seeders, "seeders");
  assert.deepEqual(turned, { key: "seeders", dir: "asc" });
  assert.equal(nextModernSort(turned, "seeders"), null);
});

test("names start from A to Z", () => {
  const name = nextModernSort(null, "name");
  assert.deepEqual(name, { key: "name", dir: "asc" });
  const turned = nextModernSort(name, "name");
  assert.deepEqual(turned, { key: "name", dir: "desc" });
  assert.equal(nextModernSort(turned, "name"), null);
});

test("another heading starts with its own first direction", () => {
  assert.deepEqual(nextModernSort(by("seeders", "asc"), "size"), by("size", "desc"));
  assert.deepEqual(nextModernSort(by("size", "desc"), "name"), by("name", "asc"));
  assert.deepEqual(nextModernSort(by("name", "asc"), "resolution"), by("resolution", "desc"));
});

test("without a sort the list is handed back untouched", () => {
  const list = [mk({ seeders: 1 }), mk({ seeders: 3 }), mk({ seeders: 2 })];
  assert.equal(sortModern(list, null), list);
});

test("seeders sort both ways and an unknown count stays last", () => {
  const list = [5, null, 100, 20].map((seeders) => mk({ seeders }));
  const seeders = (sorted: ScoredStream[]) => sorted.map((s) => s.seeders);
  assert.deepEqual(seeders(sortModern(list, by("seeders", "desc"))), [100, 20, 5, null]);
  assert.deepEqual(seeders(sortModern(list, by("seeders", "asc"))), [5, 20, 100, null]);
  assert.deepEqual(seeders(list), [5, null, 100, 20], "the incoming list is not changed");
});

test("no seeders at all is a count, a number below zero is not", () => {
  const list = [-1, 0, 7].map((seeders) => mk({ seeders }));
  const seeders = (sorted: ScoredStream[]) => sorted.map((s) => s.seeders);
  assert.deepEqual(seeders(sortModern(list, by("seeders", "desc"))), [7, 0, -1]);
  assert.deepEqual(seeders(sortModern(list, by("seeders", "asc"))), [0, 7, -1]);
});

test("sizes sort both ways and a size of nothing stays last", () => {
  const list = [0, 2 * GB, null, 40 * GB, -5].map((size) => mk({ size }));
  const sizes = (sorted: ScoredStream[]) => sorted.map((s) => s.size);
  assert.deepEqual(sizes(sortModern(list, by("size", "desc"))), [40 * GB, 2 * GB, 0, null, -5]);
  assert.deepEqual(sizes(sortModern(list, by("size", "asc"))), [2 * GB, 40 * GB, 0, null, -5]);
});

test("resolutions sort from 4K down to SD, and back", () => {
  const list = (["720p", "SD", "4K", "480p", "1080p"] as const).map((resolution) =>
    mk({ resolution, source: "DVDRip" }),
  );
  const order = (sorted: ScoredStream[]) => sorted.map((s) => s.resolution);
  assert.deepEqual(order(sortModern(list, by("resolution", "desc"))), [
    "4K",
    "1080p",
    "720p",
    "480p",
    "SD",
  ]);
  assert.deepEqual(order(sortModern(list, by("resolution", "asc"))), [
    "SD",
    "480p",
    "720p",
    "1080p",
    "4K",
  ]);
});

test("a resolution Harbor could not read stays last both ways", () => {
  const unread = read({ name: "Addon", title: "Some Show 04" });
  const missing = mk({ resolution: undefined });
  const low = mk({ resolution: "480p" });
  const high = mk({ resolution: "4K" });
  const list = [unread, missing, low, high];
  assert.deepEqual(sortModern(list, by("resolution", "desc")), [high, low, unread, missing]);
  assert.deepEqual(sortModern(list, by("resolution", "asc")), [low, high, unread, missing]);
});

test("a resolution counts as not read exactly where Harbor shows no quality label", () => {
  const sources = [
    read({ name: "Addon", title: "Some Show 04" }),
    read({ name: "Addon", title: "Some.Show.S01E04.DVDRip.XviD-GRP.avi" }),
    read({ name: "Addon", title: "Some.Show.S01E04.x265.mkv" }),
    read({ name: "Addon", title: "Some.Show.S01E04.480p.mkv" }),
    read({ name: "Addon", title: "Some.Show.S01E04.FLAC.mkv" }),
    read({ name: "Addon", title: "Some.Show.S01E04.HDR10.mkv" }),
    read({ name: "Addon", title: "Some.Show.S01E04.1080p.mkv" }),
    read({ name: "Plugin", url: "https://example.test/video.mp4" }),
  ];
  assert.deepEqual(
    sources.map((s) => knownResolution(s) === null),
    sources.map((s) => qualityConfidence(s) === "unlabeled"),
  );
  assert.deepEqual(
    sources.map((s) => knownResolution(s)),
    [null, "SD", "SD", "480p", "SD", "SD", "1080p", null],
  );
});

/** A source whose resolution Harbor's parser does not read, with this text of the add-on. */
const unread = (partial: Partial<Stream>) => {
  const source = read({ title: "🎥 WEB-DL 🎞️ HEVC", url: "https://example.test/a", ...partial });
  assert.equal(source.resolution, "SD", `${partial.name}: what the parser reads has changed`);
  assert.notEqual(source.source, "Other", `${partial.name}: what the parser reads has changed`);
  return source;
};

test("a resolution that nobody read is the one that the add-on's label says", () => {
  for (const [name, resolution] of [
    ["Addon 1080p", "1080p"],
    ["[TB⚡] Addon 2160p", "4K"],
    ["Addon (720p)", "720p"],
    ["Addon 480p", "480p"],
    ["Addon 1080i", "1080p"],
    ["Addon 2160i", "4K"],
    ["Addon 4k", "4K"],
    ["Addon\nDV\n720p", "720p"],
    ["🔥 4K UHD", "4K"],
    ["Addon UHD", "4K"],
    ["Ultra HD", "4K"],
    ["UltraHD", "4K"],
    ["🚀 FHD", "1080p"],
    ["1080p Full HD", "1080p"],
    ["FullHD", "1080p"],
    ["Full-HD", "1080p"],
    ["1080p | 1080p", "1080p"],
    ["720p\n👤 1.4k ★ 3,4k ↓ 1.2k", "720p"],
    ["Addon SD", "SD"],
    ["Addon 576p", "SD"],
  ] as const) {
    assert.equal(knownResolution(unread({ name })), resolution, name);
    const nothing = { ...read({ name: "Addon", title: "Some Show 04" }), name };
    assert.equal(qualityConfidence(nothing), "unlabeled");
    assert.equal(knownResolution(nothing), resolution, `${name}, with nothing else read`);
  }
});

test("only a resolution that the label alone says, and only one, stands for one nobody read", () => {
  for (const name of [
    "720p or 1080p",
    "Addon 4K\n1080p",
    "4K, else 1440p",
    "1080p 8K",
    "QHD 720p",
    "FHD 4320p",
    "FHD 2K",
    "Unknown, perhaps 720p",
    "[TB⚡] UHD Movies | Unknown",
  ]) {
    assert.equal(knownResolution(unread({ name })), null, `${name}: which of them?`);
  }
  assert.equal(
    knownResolution(read({ name: "Addon 4K", title: "Some.Show.S01E04.1080p.mkv" })),
    "1080p",
    "what Harbor read stays",
  );
  const page = { ...unread({ name: "Addon 4K" }), url: undefined, externalUrl: "https://a.test" };
  assert.equal(knownResolution(page), null, "a web page has none");
  for (const [addonName, name, resolution] of [
    ["Cinema 4K", "Cinema 4K 1080p", "1080p"],
    ["Cinema 4K", "Cinema 4K\n4K", "4K"],
    ["Cinema 4K", "Cinema 4K", null],
    ["All in 1080p", "[TB⚡] Addon 1080p", "1080p"],
    ["All in 4K", "[TB⚡] Addon 2160p", "4K"],
    ["Movies", "UHDMovies", "SD"],
    ["", "Label\n4K", "4K"],
  ] as const) {
    const source = unread({ addonName, name });
    assert.equal(knownResolution(source), resolution, `${name} of ${addonName}`);
  }
});

test("a number elsewhere in the add-on's texts has to be the one that its label says", () => {
  for (const [name, elsewhere, resolution] of [
    ["Addon 4K", "1080p", null],
    ["Addon FHD", "1440p", null],
    ["Addon FHD", "720p", null],
    ["Addon FHD", "2160i", null],
    ["Addon FHD", "1080p | 2160P", null],
    ["Addon 4K", "2160p", "4K"],
    ["Addon FHD", "1080i | 1080p", "1080p"],
    ["Addon FHD", "12160p 2160pp", "1080p"],
    ["Addon FHD", "SD Show 04", "1080p"],
    ["Addon SD", "540p", "SD"],
  ] as const) {
    const title = "🎥 WEB-DL 🎞️ HEVC";
    for (const says of [{ title: `${title}\n🎬 ${elsewhere}` }, { description: elsewhere }]) {
      const source = unread({ name, ...says });
      assert.equal(knownResolution(source), resolution, `${name} and ${elsewhere}`);
    }
  }
});

test("SD is no answer where the add-on's own text names a resolution that nobody read", () => {
  for (const name of ["Addon 1440p", "✨ QHD", "💿 HD", "Addon 2K", "Addon 8K", "Addon 4320p"]) {
    assert.equal(knownResolution(unread({ name })), null, `${name}: Harbor has no such value`);
  }
  const title = "🎥 WEB-DL 🎞️ HEVC";
  assert.equal(knownResolution(unread({ title: `${title}\n🎬 1080p` })), null);
  assert.equal(knownResolution(unread({ title, description: "1080p" })), null);
  for (const field of ["filename", "fileName"]) {
    const behaviorHints = { [field]: "FHD" };
    assert.equal(knownResolution(unread({ title: `${title} AAC`, behaviorHints })), null, field);
  }
});

test("SD stays where the add-on names none, or one that Harbor calls SD", () => {
  for (const name of [
    "Addon",
    "Addon SD",
    "SD, not HD",
    "Addon 576p",
    "Addon 360p",
    "576p, upscaled to 1080p",
    "360i, upscaled to 4K",
    "DTS-HD",
    "DTS HD MA",
    "TrueHD",
    "True HD",
    "HD Audio",
    "HDTV",
    "HD-TV",
    "HDRip",
    "HD CAM",
    "HD-TS",
    "Addon 1080",
    "Addon 10800",
    "4Kids",
    "X1080",
    "Addon 👤 1.4k",
    "Addon 👤 4,8k",
  ]) {
    assert.equal(knownResolution(unread({ name })), "SD", name);
  }
  for (const facts of [
    "👤 1080 💾 700 MB",
    "👤 45 💾 1080 MB",
    "👤 720 💾 2160 MB",
    "480 peers",
    "👤 1.4k",
  ]) {
    const title = `🎥 WEB-DL 🎞️ HEVC\n${facts}`;
    assert.equal(knownResolution(unread({ title })), "SD", `${facts}: how many and how large`);
  }
  const nulls = null as unknown as undefined;
  const bare = { ...unread({}), name: nulls, description: nulls, behaviorHints: nulls };
  assert.equal(knownResolution(bare), "SD");
});

test("SD is no answer where the add-on's label says that it is unknown", () => {
  for (const name of ["Unknown", "Addon unknown", "Addon\n❔ Unknown", "[TB⚡] Addon (UNKNOWN)"]) {
    assert.equal(knownResolution(unread({ name })), null, name);
  }
  for (const name of ["Unknowns", "Addon 576p, else unknown", "SD or unknown"]) {
    assert.equal(knownResolution(unread({ name })), "SD", name);
  }
  const title = "🎥 WEB-DL 🎞️ HEVC\nUploader: unknown";
  assert.equal(knownResolution(unread({ name: "Addon", title })), "SD", "of something else");
  for (const [addonName, name, resolution] of [
    ["Into the Unknown", "Into the Unknown", "SD"],
    ["Into the Unknown", "Into the Unknown\nUnknown", null],
    ["", "Unknown", null],
  ] as const) {
    const source = unread({ addonName, name });
    assert.equal(knownResolution(source), resolution, `${name} of ${addonName}`);
  }
  assert.equal(knownResolution(read({ name: "Unknown", title: "A.Show.720p.mkv" })), "720p");
});

test("one rule for the sort and the reasons: a resolution that nobody read is none", () => {
  const named = unread({ name: "Addon 1440p" });
  const sd = unread({ name: "Addon" });
  for (const dir of ["asc", "desc"] as const) {
    assert.deepEqual(sortModern([named, sd], by("resolution", dir)), [sd, named], dir);
  }
  const leads = { ...named, seeders: 100 };
  const also = { ...named, seeders: 1 };
  assert.deepEqual(seeding(leads, [also]), [], "not the most seeders at SD");
  assert.deepEqual(
    seeding({ ...sd, seeders: 100 }, [also, { ...sd, seeders: 1 }]),
    [{ kind: "most-seeders", resolution: "SD" }],
    "and it is no rival of one that is SD",
  );
  assert.deepEqual(seeding({ ...sd, seeders: 100 }, [also]), []);
});

test("a resolution that the label says counts for the sort, the filter and Most seeders", () => {
  const named = unread({ name: "Addon 1080p" });
  const [high, same, low] = (["4K", "1080p", "720p"] as const).map((resolution) =>
    mk({ resolution }),
  );
  const list = [low, named, high, unread({ name: "Addon HD" })];
  assert.deepEqual(sortModern(list, by("resolution", "desc")), [high, named, low, list[3]]);
  assert.deepEqual(sortModern(list, by("resolution", "asc")), [low, named, high, list[3]]);
  assert.deepEqual(dimValues(named, "resolution", ctx()), ["1080p"]);
  assert.deepEqual(applyModernFilters([...list, same], { resolution: "1080p" }, ctx()), [
    named,
    same,
  ]);
  const leads = { ...named, seeders: 100 };
  assert.deepEqual(seeding(leads, [{ ...same, seeders: 1 }]), [
    { kind: "most-seeders", resolution: "1080p" },
  ]);
  assert.deepEqual(seeding({ ...same, seeders: 1 }, [leads]), [], "and it is a rival there");
});

test("Atmos comes on top of DD+ and TrueHD where one of the source's texts says it", () => {
  for (const [file, codec, atmos] of [
    ["A.Film.2020.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP.mkv", "DD+", true],
    ["A.Film.2020.2160p.BluRay.REMUX.TrueHD.7.1.ATMOS-GRP.mkv", "TrueHD", true],
    ["A.Film.2020.2160p.WEB-DL.Atmos.H.265-GRP.mkv", "Atmos", true],
    ["A.Film.2020.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv", "DD+", false],
    ["A.Film.2020.1080p.BluRay.TrueHD.7.1-GRP.mkv", "TrueHD", false],
    ["Atmosfear.2020.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv", "DD+", false],
    ["A.Film.2020.1080p.BluRay.DTS.Atmos-GRP.mkv", "DTS", false],
    ["A.Film.2020.1080p.WEB-DL.AAC.Atmos-GRP.mkv", "AAC", false],
  ] as const) {
    for (const said of [
      { title: file },
      { description: `Addon\n${file}` },
      { behaviorHints: { filename: file } },
      { behaviorHints: { fileName: file } },
    ]) {
      const source = read({ name: "Addon", url: "https://example.test/a", ...said });
      assert.equal(source.audio.codec, codec, `${file}: what the parser reads has changed`);
      assert.equal(hasAtmos(source), atmos, JSON.stringify(said));
    }
  }
  const spread = { title: "A.Film.2020.TrueHD.7.1-GRP.mkv", description: "🔊 Atmos | TrueHD" };
  assert.equal(hasAtmos(read({ name: "Addon", ...spread })), true, "beside the name of the file");
  const label = { title: "A.Film.2020.TrueHD.7.1-GRP.mkv", name: "Addon 4K Atmos" };
  assert.equal(hasAtmos(read(label)), true);
  const own = { ...label, name: "Atmos Films 4K", addonName: "Atmos Films" };
  assert.equal(hasAtmos(read(own)), false, "the add-on's own name says it of none");
  assert.equal(hasAtmos(read({ ...own, title: "A.Film.2020.Atmos.mkv" })), true, "Harbor read it");
});

test("a source with Atmos on top counts under both in the audio codec filter", () => {
  const list = [
    "A.Film.2020.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP.mkv",
    "A.Film.2020.2160p.BluRay.TrueHD.7.1.Atmos.HEVC-GRP.mkv",
    "A.Film.2020.2160p.WEB-DL.Atmos.H.265-GRP.mkv",
    "A.Film.2020.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv",
    "A.Film.2020.1080p.WEB-DL.AAC.H.264-GRP.mkv",
  ].map((title) => read({ name: "Addon", title, url: "https://example.test/a" }));
  const values = list.map((s) => dimValues(s, "audio", ctx()));
  assert.deepEqual(values, [["DD+", "Atmos"], ["TrueHD", "Atmos"], ["Atmos"], ["DD+"], []]);
  const counted = options(modernGroups(list, {}, ctx()).more, "audio");
  assert.deepEqual(counted, [
    { value: "Atmos", count: 3 },
    { value: "TrueHD", count: 1 },
    { value: "DD+", count: 2 },
  ]);
  for (const { value, count } of counted) {
    assert.equal(applyModernFilters(list, { audio: value }, ctx()).length, count, value);
  }
  const page = { ...list[0], url: undefined, externalUrl: "https://a.test" };
  assert.deepEqual(dimValues(page, "audio", ctx()), [], "a web page has none");
});

test("the resolution filter counts what the rows show", () => {
  const list = [
    ...(["4K", "1080p", "720p", "480p", "SD"] as const).map((resolution) => mk({ resolution })),
    unread({ name: "Addon", title: "🎥 WEB-DL 🎞️ HEVC" }),
    unread({ name: "Addon 1440p" }),
    read({ name: "Addon", title: "Some Show 04" }),
    unread({ name: "Addon 4K" }),
  ];
  const shown = list.map(knownResolution);
  assert.deepEqual(shown, ["4K", "1080p", "720p", "480p", "SD", "SD", null, null, "4K"]);
  assert.deepEqual(
    list.map((s) => dimValues(s, "resolution", ctx())),
    shown.map((resolution) => (resolution === null ? [] : [resolution])),
  );
  assert.deepEqual(options(modernGroups(list.toReversed(), {}, ctx()).main, "resolution"), [
    { value: "4K", count: 2 },
    { value: "1080p", count: 1 },
    { value: "720p", count: 1 },
    { value: "480p", count: 1 },
    { value: "SD", count: 2 },
  ]);
  for (const resolution of ["4K", "1080p", "720p", "480p", "SD"]) {
    const left = applyModernFilters(list, { resolution }, ctx());
    assert.deepEqual(
      left,
      list.filter((_, at) => shown[at] === resolution),
      resolution,
    );
  }
});

test("names sort without regard to case, and sources of one group keep their order", () => {
  const first = mk({ releaseGroup: "SubsPlease", seeders: 1 });
  const second = mk({ releaseGroup: "subsplease", seeders: 9 });
  const list = [first, mk({ releaseGroup: "Judas" }), second, mk({ releaseGroup: "ASW" })];
  assert.deepEqual(groups(sortModern(list, by("name", "asc"))), [
    "ASW",
    "Judas",
    "SubsPlease",
    "subsplease",
  ]);
  assert.deepEqual(groups(sortModern(list, by("name", "desc"))), [
    "SubsPlease",
    "subsplease",
    "Judas",
    "ASW",
  ]);
});

test("names sort by what the row shows, so a source without a group is sorted by its label", () => {
  const labelled = mk({ releaseGroup: null, name: "Comet\n1080p" });
  const list = [mk({ releaseGroup: "FLUX" }), labelled, mk({ releaseGroup: "Ares" })];
  assert.deepEqual(sortModern(list, by("name", "asc")).map(sourceName), ["Ares", "Comet", "FLUX"]);
});

test("only a sort this look knows is read back from the settings", () => {
  assert.deepEqual(readModernSort({ key: "size", dir: "asc" }), { key: "size", dir: "asc" });
  for (const key of ["name", "resolution", "seeders", "size"] as const) {
    assert.deepEqual(readModernSort({ key, dir: "desc" }), { key, dir: "desc" });
  }
  for (const value of [
    null,
    undefined,
    "size-desc",
    7,
    [],
    {},
    { key: "date", dir: "asc" },
    { key: "size", dir: "up" },
    { key: "size" },
    { dir: "asc" },
    { key: "toString", dir: "asc" },
    { key: ["size"], dir: "asc" },
  ]) {
    assert.equal(readModernSort(value), null, JSON.stringify(value));
  }
});

test("a stored sort keeps nothing but its two values", () => {
  assert.deepEqual(readModernSort({ key: "size", dir: "asc", extra: true }), {
    key: "size",
    dir: "asc",
  });
});

const ctx = (partial: Partial<ModernContext> = {}): ModernContext => ({
  isEpisode: true,
  noneCached: false,
  dubSub: (s) => streamDubSub(s.audioLanguages, true),
  addonOf: (s) => ({ id: s.addonUrl ?? s.addonId, name: s.addonName }),
  ...partial,
});

const SUB = ["Japanese"];
const DUB = ["English"];
const DUAL = ["English", "Japanese"];

/** Three add-ons; 1080p x4 and 720p x2; one batch; sub x4, dub x1, dual x1. */
const six = (): ScoredStream[] => [
  mk({ addonId: "t", addonName: "Torrentio", resolution: "1080p", audioLanguages: SUB }),
  mk({ addonId: "t", addonName: "Torrentio", resolution: "720p", audioLanguages: SUB }),
  mk({ addonId: "c", addonName: "Comet", resolution: "1080p", audioLanguages: DUB }),
  mk({ addonId: "c", addonName: "Comet", resolution: "1080p", audioLanguages: SUB }),
  mk({
    addonId: "m",
    addonName: "MediaFusion",
    resolution: "1080p",
    audioLanguages: DUAL,
    seasonPack: true,
  }),
  mk({ addonId: "m", addonName: "MediaFusion", resolution: "720p", audioLanguages: SUB }),
];

const keys = (list: ModernGroup[]) => list.map((group) => group.key);
const options = (list: ModernGroup[], key: ModernDimKey) =>
  list.find((group) => group.key === key)?.options;

test("a filter leaves only the sources that match it", () => {
  const list = six();
  assert.deepEqual(applyModernFilters(list, { dub: "dub" }, ctx()), [list[2]]);
  assert.deepEqual(applyModernFilters(list, { release: "batch" }, ctx()), [list[4]]);
  assert.deepEqual(applyModernFilters(list, { addon: "m" }, ctx()), [list[4], list[5]]);
  assert.deepEqual(applyModernFilters(list, {}, ctx()), list);
});

test("filters of several groups all have to match, down to nothing", () => {
  const list = six();
  assert.deepEqual(applyModernFilters(list, { dub: "sub", resolution: "720p" }, ctx()), [
    list[1],
    list[5],
  ]);
  assert.deepEqual(applyModernFilters(list, { dub: "dub", resolution: "720p" }, ctx()), []);
});

test("one group can be left out of the filtering", () => {
  const list = six();
  assert.deepEqual(applyModernFilters(list, { dub: "dub", addon: "c" }, ctx(), "dub"), [
    list[2],
    list[3],
  ]);
});

test("the groups the list offers come in a fixed order with their counts", () => {
  const { main, more } = modernGroups(six(), {}, ctx());
  assert.deepEqual(keys(main), ["release", "dub", "resolution", "addon"]);
  assert.deepEqual(keys(more), []);
  assert.deepEqual(options(main, "release"), [
    { value: "single", count: 5 },
    { value: "batch", count: 1 },
  ]);
  assert.deepEqual(options(main, "dub"), [
    { value: "sub", count: 4 },
    { value: "dub", count: 1 },
    { value: "dual", count: 1 },
  ]);
  assert.deepEqual(options(main, "resolution"), [
    { value: "1080p", count: 4 },
    { value: "720p", count: 2 },
  ]);
  assert.deepEqual(
    options(main, "addon"),
    [
      { value: "c", count: 2 },
      { value: "m", count: 2 },
      { value: "t", count: 2 },
    ],
    "add-ons come in the order of their names: Comet, MediaFusion, Torrentio",
  );
});

test("a choice counts what it would leave with the other filters as they are", () => {
  const { main } = modernGroups(six(), { dub: "dub" }, ctx());
  assert.deepEqual(options(main, "resolution"), [
    { value: "1080p", count: 1 },
    { value: "720p", count: 0 },
  ]);
  assert.deepEqual(options(main, "release"), [
    { value: "single", count: 1 },
    { value: "batch", count: 0 },
  ]);
  assert.deepEqual(
    options(main, "dub"),
    [
      { value: "sub", count: 4 },
      { value: "dub", count: 1 },
      { value: "dual", count: 1 },
    ],
    "a group never filters itself",
  );
});

test("with two filters on, each group counts with the other one", () => {
  const { main } = modernGroups(six(), { dub: "sub", addon: "t" }, ctx());
  assert.deepEqual(options(main, "dub"), [
    { value: "sub", count: 2 },
    { value: "dub", count: 0 },
    { value: "dual", count: 0 },
  ]);
  assert.deepEqual(options(main, "addon"), [
    { value: "c", count: 1 },
    { value: "m", count: 1 },
    { value: "t", count: 2 },
  ]);
  assert.deepEqual(options(main, "resolution"), [
    { value: "1080p", count: 1 },
    { value: "720p", count: 1 },
  ]);
});

test("with Cached only on and nothing cached, no source is left and no choice leaves one", () => {
  const noneCached = ctx({ noneCached: true });
  for (const filters of [{}, { resolution: "720p" }, { dub: "dub", addon: "c" }]) {
    assert.deepEqual(applyModernFilters(six(), filters, noneCached), []);
    const { main, more } = modernGroups(six(), filters, noneCached);
    const all = modernGroups(six(), filters, ctx());
    assert.deepEqual([keys(main), keys(more)], [keys(all.main), keys(all.more)]);
    for (const [i, group] of main.entries()) {
      const offered = all.main[i].options.map(({ value }) => ({ value, count: 0 }));
      assert.deepEqual(group.options, offered, group.key);
    }
  }
});

test("a group the list offers only one choice of is not there", () => {
  const same = [mk({ releaseGroup: "A" }), mk({ releaseGroup: "B" })];
  assert.deepEqual(modernGroups(same, {}, ctx()), { main: [], more: [] });
  assert.deepEqual(modernGroups([], {}, ctx()), { main: [], more: [] });
});

test("a filter does not take its own group's other choices off the screen", () => {
  const { main } = modernGroups(six(), { resolution: "720p" }, ctx());
  assert.deepEqual(keys(main), ["release", "dub", "resolution", "addon"]);
});

test("a film has no release group", () => {
  const { main, more } = modernGroups(six(), {}, ctx({ isEpisode: false }));
  assert.deepEqual(keys(main), ["dub", "resolution", "addon"]);
  assert.deepEqual(keys(more), []);
});

test("outside anime there is no sub or dub group", () => {
  const { main } = modernGroups(six(), {}, ctx({ dubSub: () => null }));
  assert.deepEqual(keys(main), ["release", "resolution", "addon"]);
});

test("at most five groups show, and the source kind is the one that steps back", () => {
  const list = six();
  list[0].hdrFormat = "HDR10";
  assert.deepEqual(keys(modernGroups(list, {}, ctx()).main), [
    "release",
    "dub",
    "resolution",
    "hdr",
    "addon",
  ]);
  list[0].source = "BluRay";
  const { main, more } = modernGroups(list, {}, ctx());
  assert.deepEqual(keys(main), ["release", "dub", "resolution", "hdr", "addon"]);
  assert.deepEqual(keys(more), ["source"]);
});

test("the source kind shows with the others while there is room", () => {
  const list = six();
  list[0].source = "BluRay";
  const { main, more } = modernGroups(list, {}, ctx());
  assert.deepEqual(keys(main), ["release", "dub", "resolution", "source", "addon"]);
  assert.deepEqual(keys(more), []);
});

test("video format, audio format and availability always sit behind the others", () => {
  const list = [
    mk({ codec: "HEVC", audio: { codec: "Atmos", channels: 8 }, cached: { rd: true } }),
    mk({ codec: "AVC", audio: { codec: "DTS", channels: 6 }, infoHash: "a".repeat(40) }),
  ];
  const { main, more } = modernGroups(list, {}, ctx());
  assert.deepEqual(keys(main), []);
  assert.deepEqual(more, [
    {
      key: "codec",
      options: [
        { value: "HEVC", count: 1 },
        { value: "AVC", count: 1 },
      ],
    },
    {
      key: "audio",
      options: [
        { value: "Atmos", count: 1 },
        { value: "DTS", count: 1 },
      ],
    },
    {
      key: "availability",
      options: [
        { value: "Cached", count: 1 },
        { value: "P2P", count: 1 },
      ],
    },
  ]);
});

test("HDR kinds are named, a source with two of them counts as both, and one with none is SDR", () => {
  const formats = ["DV", "DV+HDR10", "HDR10+", "HDR10", "HLG", null] as const;
  const list = formats.map((hdrFormat) => mk({ hdrFormat }));
  assert.deepEqual(
    list.map((s) => dimValues(s, "hdr", ctx())),
    [["Dolby Vision"], ["Dolby Vision", "HDR10"], ["HDR10+"], ["HDR10"], ["HLG"], ["SDR"]],
  );
  assert.deepEqual(options(modernGroups(list, {}, ctx()).main, "hdr"), [
    { value: "Dolby Vision", count: 2 },
    { value: "HDR10+", count: 1 },
    { value: "HDR10", count: 2 },
    { value: "HLG", count: 1 },
    { value: "SDR", count: 1 },
  ]);
  for (const [hdr, left] of [
    ["Dolby Vision", ["DV", "DV+HDR10"]],
    ["HDR10", ["DV+HDR10", "HDR10"]],
    ["SDR", [null]],
  ] as const) {
    const matching = applyModernFilters(list, { hdr }, ctx());
    assert.deepEqual(
      matching.map((s) => s.hdrFormat),
      left,
      hdr,
    );
    assert.equal(
      options(modernGroups(list, { hdr }, ctx()).main, "hdr")?.find((o) => o.value === hdr)?.count,
      left.length,
      "the count is what the choice leaves",
    );
  }
});

test("a source without a value in a group is not counted there and does not match its filter", () => {
  const other = mk({ source: "Other" });
  const list = [mk({ source: "WEB-DL" }), mk({ source: "BDRip" }), other];
  assert.deepEqual(dimValues(other, "source", ctx()), []);
  assert.deepEqual(options(modernGroups(list, {}, ctx()).main, "source"), [
    { value: "BluRay", count: 1 },
    { value: "WEB-DL", count: 1 },
  ]);
  assert.deepEqual(applyModernFilters(list, { source: "BluRay" }, ctx()), [list[1]]);
});

test("two installations of one add-on are two choices", () => {
  const list = [
    mk({ addonId: "t", addonName: "Torrentio", addonUrl: "https://one.test" }),
    mk({ addonId: "t", addonName: "Torrentio", addonUrl: "https://two.test" }),
  ];
  assert.deepEqual(options(modernGroups(list, {}, ctx()).main, "addon"), [
    { value: "https://one.test", count: 1 },
    { value: "https://two.test", count: 1 },
  ]);
});

test("a chosen value the list no longer has stays there to be let go", () => {
  const list = six().filter((s) => streamDubSub(s.audioLanguages, true) === "sub");
  const { main } = modernGroups(list, { dub: "dub" }, ctx());
  assert.deepEqual(options(main, "dub"), [
    { value: "sub", count: 4 },
    { value: "dub", count: 0 },
  ]);
  const gone = modernGroups(list, { addon: "gone" }, ctx());
  assert.deepEqual(options(gone.main, "addon"), [
    { value: "c", count: 1 },
    { value: "m", count: 1 },
    { value: "t", count: 2 },
    { value: "gone", count: 0 },
  ]);
});

test("a group whose filter is on stays on screen when the list offers only its choice", () => {
  const list = [mk({ audioLanguages: DUB }), mk({ audioLanguages: [] })];
  assert.deepEqual(keys(modernGroups(list, {}, ctx()).main), []);
  assert.deepEqual(modernGroups(list, { dub: "dub" }, ctx()).main, [
    { key: "dub", options: [{ value: "dub", count: 1 }] },
  ]);
});

const none: ReadonlySet<ScoredStream> = new Set();

test("the pick is the preferred source while the list has it", () => {
  const list = [mk(), mk(), mk()];
  assert.equal(pickModern({ list, preferred: list[2], ranked: list, failed: none }), list[2]);
});

test("a preferred source the list does not have makes way for the best ranked one it has", () => {
  const all = [mk(), mk(), mk(), mk()];
  const [first, second, third, gone] = all;
  const ranked = [gone, third, first, second];
  assert.equal(
    pickModern({ list: [first, third], preferred: gone, ranked, failed: none }),
    third,
    "by the page's order of the best, not by the order on screen",
  );
  assert.equal(pickModern({ list: [first], preferred: null, ranked, failed: none }), first);
});

test("a source that failed is not the pick while another is left, and then it stays the pick", () => {
  const [a, b, c] = [mk(), mk(), mk()];
  const list = [a, b, c];
  assert.equal(pickModern({ list, preferred: a, ranked: list, failed: new Set([a]) }), b);
  assert.equal(pickModern({ list, preferred: a, ranked: list, failed: new Set([a, b]) }), c);
  const all = new Set(list);
  assert.equal(pickModern({ list, preferred: b, ranked: list, failed: all }), b);
  assert.equal(pickModern({ list, preferred: null, ranked: list, failed: all }), a, "the best one");
  const left = [b, c];
  assert.equal(
    pickModern({ list: left, preferred: a, ranked: list, failed: all }),
    b,
    "of the ones the list has",
  );
});

test("an empty list has no pick", () => {
  const gone = mk();
  assert.equal(pickModern({ list: [], preferred: gone, ranked: [gone], failed: none }), null);
});

const RD = { slug: "rd" as const, name: "Real-Debrid" };
const TB = { slug: "tb" as const, name: "TorBox", queueCache: () => undefined };
const TORRENT = { infoHash: "b".repeat(40) };

type ReasonInput = Parameters<typeof pickReasons>[0];
const reasons = (pick: ScoredStream, partial: Partial<ReasonInput> = {}) =>
  pickReasons({
    pick,
    list: [pick],
    episode: null,
    playedLast: false,
    debrids: [],
    addonCached: false,
    canStreamDirectly: false,
    ...partial,
  });

test("a source in a debrid's library says so, and not that it is cached", () => {
  const pick = mk({ ...TORRENT, inLibrary: { rd: true }, cached: { rd: true, tb: true } });
  assert.deepEqual(reasons(pick, { debrids: [RD, TB], addonCached: true }), [
    { kind: "library", providers: ["Real-Debrid"] },
  ]);
});

test("a cached source names every debrid that has it", () => {
  const pick = mk({ ...TORRENT, cached: { rd: true, tb: true } });
  assert.deepEqual(reasons(pick, { debrids: [RD, TB], addonCached: true }), [
    { kind: "cached", providers: ["Real-Debrid", "TorBox"] },
  ]);
  assert.deepEqual(reasons(pick, { debrids: [TB], addonCached: true }), [
    { kind: "cached", providers: ["TorBox"] },
  ]);
});

test("a source only the add-on calls cached says that without a name", () => {
  assert.deepEqual(reasons(mk(TORRENT), { debrids: [RD], addonCached: true }), [
    { kind: "addon-cached" },
  ]);
});

test("a source nothing has names the debrid that can fetch it", () => {
  assert.deepEqual(reasons(mk(TORRENT), { debrids: [RD, TB], canStreamDirectly: true }), [
    { kind: "not-cached", provider: "TorBox" },
  ]);
});

test("without a debrid that can fetch it a source streams from peers, if it may", () => {
  for (const debrids of [[], [RD]]) {
    assert.deepEqual(reasons(mk(TORRENT), { debrids, canStreamDirectly: true }), [
      { kind: "peers" },
    ]);
    assert.deepEqual(reasons(mk(TORRENT), { debrids, canStreamDirectly: false }), [
      { kind: "not-cached", provider: null },
    ]);
  }
});

test("a direct link and an outside page say nothing about caches", () => {
  assert.deepEqual(reasons(mk({ url: "https://example.test/a.mkv" }), { debrids: [RD, TB] }), []);
  assert.deepEqual(
    reasons(mk({ externalUrl: "https://example.test/watch" }), { debrids: [RD, TB] }),
    [],
  );
});

test("a link the add-on itself marks as not cached is not cached", () => {
  const pick = mk({ url: "https://example.test/a.mkv", name: "[RD download] Torrentio" });
  assert.deepEqual(reasons(pick, { debrids: [RD] }), [{ kind: "not-cached", provider: null }]);
});

/** The seeders reason alone, so the other reasons cannot hide it. */
const seeding = (pick: ScoredStream, others: ScoredStream[]) =>
  reasons(pick, { list: [...others, pick] }).filter((reason) => reason.kind === "most-seeders");

test("most seeders is said when the pick leads the sources of its resolution", () => {
  const pick = mk({ url: "u", seeders: 100 });
  const lead = [{ kind: "most-seeders", resolution: "1080p" }];
  assert.deepEqual(seeding(pick, [mk({ seeders: 99 })]), lead);
  assert.deepEqual(seeding(pick, [mk({ seeders: 100 })]), lead, "an equal count is not more");
  assert.deepEqual(seeding(pick, [mk({ seeders: null })]), lead, "an unknown count is not more");
  assert.deepEqual(
    seeding(pick, [mk({ seeders: 5 }), mk({ seeders: 900, resolution: "4K" })]),
    lead,
    "another resolution does not count",
  );
});

test("most seeders is not said without the lead, or without anyone to lead", () => {
  const pick = mk({ url: "u", seeders: 100 });
  assert.deepEqual(seeding(pick, [mk({ seeders: 101 })]), []);
  assert.deepEqual(seeding(pick, []), []);
  assert.deepEqual(seeding(pick, [mk({ seeders: 5, resolution: "4K" })]), []);
  assert.deepEqual(seeding(mk({ url: "u", seeders: null }), [mk({ seeders: null })]), []);
  assert.deepEqual(seeding(mk({ url: "u", seeders: 0 }), [mk({ seeders: 0 })]), []);
});

test("most seeders is not said for a resolution Harbor could not read", () => {
  const unread = read({ name: "Addon", title: "Some Show 04\n👤 50" });
  assert.equal(unread.seeders, 50);
  assert.deepEqual(seeding(unread, [read({ name: "Addon", title: "Some Show 04\n👤 5" })]), []);
});

/** The fourth of its season and the 28th of the whole show. */
const WANTED = { season: 2, episode: 4, absolute: 28, anySeason: false };

test("an episode says that it is a batch or, where the source says its number, exactly this one", () => {
  const of = (partial: Partial<ScoredStream>, episode: ReasonInput["episode"] = WANTED) =>
    reasons(mk({ url: "u", ...partial }), { episode });
  const exact = [{ kind: "exact-episode" }];
  assert.deepEqual(of({ seasonPack: true, season: 2, episode: 4 }), [{ kind: "batch" }]);
  assert.deepEqual(of({ season: 2, episode: 4, episodeEnd: 4 }), exact);
  assert.deepEqual(of({ season: null, episode: 4 }), exact, "a file without a season");
  assert.deepEqual(of({ season: null, episode: 28 }), exact, "counted through the whole show");
  assert.deepEqual(of({ season: 1, episode: 28 }), exact, "also under one season");
  assert.deepEqual(of({ season: 2, episode: 5 }), [], "another episode");
  assert.deepEqual(of({ season: 1, episode: 4 }), [], "another season");
  const anime = { ...WANTED, season: 1, anySeason: true };
  assert.deepEqual(of({ season: 2, episode: 4 }, anime), exact, "an anime is a season by itself");
  assert.deepEqual(of({ season: 1, episode: 4 }, { ...WANTED, season: null }), exact);
  assert.deepEqual(of({ season: 2, episode: null }), [], "a source that does not say which");
  assert.deepEqual(of({ season: 2, episode: 4, episodeEnd: 5 }), [], "a file of two episodes");
});

test("a film says its HDR kinds, an episode does not", () => {
  const film = (hdrFormat: ScoredStream["hdrFormat"]) => reasons(mk({ url: "u", hdrFormat }));
  assert.deepEqual(film(null), []);
  assert.deepEqual(film("HDR10+"), [{ kind: "hdr", formats: ["HDR10+"] }]);
  assert.deepEqual(film("DV"), [{ kind: "hdr", formats: ["Dolby Vision"] }]);
  assert.deepEqual(film("DV+HDR10"), [{ kind: "hdr", formats: ["Dolby Vision", "HDR10"] }]);
  const episode = mk({ url: "u", hdrFormat: "DV", season: 2, episode: 4 });
  assert.deepEqual(reasons(episode, { episode: WANTED }), [{ kind: "exact-episode" }]);
});

test("reasons come in a fixed order and there are never more than three", () => {
  const facts = { cached: { rd: true }, seeders: 9, hdrFormat: "HDR10", season: 2, episode: 4 };
  const pick = mk({ ...TORRENT, ...facts } as Partial<ScoredStream>);
  const list = [pick, mk({ seeders: 1 })];
  assert.deepEqual(reasons(pick, { list, debrids: [RD] }), [
    { kind: "cached", providers: ["Real-Debrid"] },
    { kind: "most-seeders", resolution: "1080p" },
    { kind: "hdr", formats: ["HDR10"] },
  ]);
  assert.deepEqual(reasons(pick, { list, debrids: [RD], episode: WANTED, playedLast: true }), [
    { kind: "played-last" },
    { kind: "cached", providers: ["Real-Debrid"] },
    { kind: "most-seeders", resolution: "1080p" },
  ]);
});

type Row = { id: string; from: string };
const row = (id: string, from = "page"): Row => ({ id, from });
const rowId = (r: Row) => r.id;
const hold = (shown: Row[], incoming: Row[]) => holdRows(shown, incoming, true, rowId);

test("a list that is not held is the page's list", () => {
  const incoming = [row("b"), row("a"), row("c")];
  const { rows, changed } = holdRows([row("a")], incoming, false, rowId);
  assert.equal(rows, incoming);
  assert.equal(changed, false);
});

test("new rows do not come into a held list", () => {
  const shown = [row("a"), row("b")];
  const { rows, changed } = hold(shown, [row("new"), ...shown, row("newer")]);
  assert.deepEqual(rows, shown);
  assert.equal(changed, true);
});

test("a row the page dropped stays in a held list as it was", () => {
  const shown = [row("a"), row("b"), row("c")];
  const { rows, changed } = hold(shown, [shown[0], shown[2]]);
  assert.deepEqual(rows.map(rowId), ["a", "b", "c"]);
  assert.equal(rows[1], shown[1]);
  assert.equal(changed, true);
});

test("a held list keeps its order when only the order changed", () => {
  const shown = [row("a"), row("b"), row("c")];
  const { rows, changed } = hold(shown, [shown[2], shown[0], shown[1]]);
  assert.deepEqual(rows, shown);
  assert.equal(changed, true);
});

test("a held row is the newest object of its source, and that alone is no change", () => {
  const shown = [row("a", "before"), row("b", "before")];
  const incoming = [row("a", "now"), row("b", "now")];
  const { rows, changed } = hold(shown, incoming);
  assert.equal(rows[0], incoming[0]);
  assert.equal(rows[1], incoming[1]);
  assert.equal(changed, false);
});

test("everything changing at once moves nothing in a held list", () => {
  const shown = [row("a", "before"), row("b", "before"), row("c", "before")];
  const { rows, changed } = hold(shown, [row("d", "now"), row("c", "now"), row("a", "now")]);
  assert.deepEqual(rows, [row("a", "now"), row("b", "before"), row("c", "now")]);
  assert.equal(changed, true);
  assert.deepEqual(
    shown.map((r) => r.from),
    ["before", "before", "before"],
    "the rows handed in are not changed",
  );
});

test("a held list survives the page dropping every row, and an empty one stays empty", () => {
  const shown = [row("a"), row("b")];
  assert.deepEqual(hold(shown, []), { rows: shown, changed: true });
  assert.deepEqual(hold([], [row("a")]), { rows: [], changed: true });
  assert.deepEqual(hold([], []), { rows: [], changed: false });
});

test("rows that share an id are still separate rows", () => {
  const shown = [row("a", "1"), row("a", "2"), row("b", "3")];
  const incoming = [row("a", "4"), row("a", "5"), row("b", "6")];
  assert.deepEqual(hold(shown, incoming), { rows: incoming, changed: false });
  assert.deepEqual(hold(shown, [incoming[0], incoming[2]]), {
    rows: [row("a", "4"), row("a", "2"), row("b", "6")],
    changed: true,
  });
});

/** A source as an add-on sends it for this file, read by Harbor's own parser. */
const file = (filename: string, partial: Partial<Stream> = {}) =>
  read({
    name: "Torrentio\n1080p",
    addonName: "Torrentio",
    title: `${filename}\n👤 10 💾 1 GB`,
    behaviorHints: { filename },
    ...partial,
  });

test("a group the parser reads from the end of a file name is the name", () => {
  for (const [filename, group] of [
    ["Show.Name.S01E04.1080p.WEB.h264-GRP.mkv", "GRP"],
    ["Show.Name.S01E04.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP", "GRP"],
    ["Show Name S01E04 1080p WEBRip x265-RARBG.mp4", "RARBG"],
    ["Film.Name.2020.1080p.BluRay.x264.AAC5.1-[GRP].mp4", "GRP"],
    ["Film.Name.2020.1080p.BluRay.DTS-HD.MA.5.1.x264-GRP.mkv", "GRP"],
  ]) {
    assert.deepEqual(sourceTitle(file(filename)), { kind: "group", text: group }, filename);
  }
});

test("an anime group in front of the name is the name", async () => {
  for (const group of ["SubsPlease", "Erai-raws", "G.R.P"]) {
    const source = file(`[${group}] Fate-Zero - 04 (1080p) [A3C88136].mkv`);
    await enhanceAnimeStreams([source]);
    assert.deepEqual(sourceTitle(source), { kind: "group", text: group });
  }
});

test("a group in a bracket of its own is the name, also behind a title with a dash", () => {
  const title = "Fate-Zero [BD 1080p] [Tide]";
  assert.deepEqual(sourceTitle(mk({ releaseGroup: "Tide", title })), {
    kind: "group",
    text: "Tide",
  });
});

test("an uploader's tag behind a group is no group, and the file name is the name", () => {
  for (const [filename, read] of [
    ["Show.Name.S01E04.1080p.WEB.h264-GRP[rartv]", "rartv"],
    ["Show.Name.S01E04.1080p.WEB.h264-GRP[rartv].mkv", "rartv"],
    ["Show Name S01E04 1080p WEB H264-GRP [TGx].mp4", "TGx"],
    ["Film.Name.2020.1080p.WEBRip.x264-[GRP] [TGx].mkv", "TGx"],
    ["[Uploader] Film-Name.2020.1080p.WEBRip.x264-GRP[TGx].mkv", "TGx"],
    ["Film Name 2020 1080p WEB-DL [Hindi].mkv", "Hindi"],
    ["Film Name (2020) 720p WEB-DL [ESubs].mkv", "ESubs"],
  ]) {
    for (const hash of [{ infoHash: "a".repeat(40) }, { url: "https://example.test/video" }]) {
      for (const handed of [{}, { behaviorHints: {} }]) {
        const source = file(filename, { ...hash, ...handed });
        assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
        assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
      }
    }
  }
});

test("a language tag in a later bracket is no group, and the file name is the name", () => {
  for (const [filename, read] of [
    ["[Tide-raws] Show Name - 05 [720p][Multiple Subtitle][ENG][POR-BR].mkv", "BR"],
    ["[Tide-raws] Show Name - 05 [720p][Multiple Subtitle][ENG][POR-BR]", "BR"],
    ["Film.Name.2024.720p.WEBRip.Org.Auds.[Hin-Eng].mkv", "Eng"],
    ["Film Name 2024 1080p WEB-DL [Tam-Tel-Hin].mkv", "Hin"],
    ["Film Name 2024 1080p WEB-DL (Hindi-English).mkv", "English"],
    ["Show Name S01E05 (BD 1080p [x265] Fre-Ger).mkv", "Ger"],
  ]) {
    for (const hash of [{ infoHash: "a".repeat(40) }, { url: "https://example.test/video" }]) {
      for (const handed of [{}, { behaviorHints: {} }]) {
        const source = file(filename, { ...hash, ...handed });
        assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
        assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
      }
    }
  }
});

test("whatever the brackets are, a group behind a closed one is one and a language inside is none", () => {
  for (const [open, close] of ["[]", "()", "{}", "【】"]) {
    const named = (releaseGroup: string, title: string) =>
      sourceTitle(mk({ releaseGroup, name: "Label", title, behaviorHints: undefined })).kind;
    assert.equal(named("JPN", `Show.Name.S01E05.1080p.WEB-DL ${open}CHS-JPN${close}`), "file");
    assert.equal(named("GRP", `Show.Name.S01E05.${open}1080p${close}.x264-GRP`), "group");
  }
});

test("a group behind brackets that are closed, or in one that opens the name, is one", () => {
  for (const filename of [
    "Film Name (2024) [1080p] x264-GRP.mkv",
    "Film Name 2024 1080p [Hin-Eng] x264-GRP.mkv",
    "Film Name (2024 [1080p] (x264)) WEB-GRP.mkv",
    "Film.Name.2024.1080p.BluRay.x264-[GRP].mkv",
    "1) Film Name 2024 1080p x264-GRP.mkv",
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, "GRP", `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "group", text: "GRP" }, filename);
  }
  for (const open of ["[", "(", "{", "【"]) {
    const title = `${open}Show.Name.S01E05.1080p.WEB-DL.x264-GRP, all of it`;
    const source = mk({ releaseGroup: "GRP", title, behaviorHints: undefined });
    assert.deepEqual(sourceTitle(source), { kind: "group", text: "GRP" }, title);
  }
});

test("a web address is no group, wherever in the name it stands", async () => {
  for (const [filename, read] of [
    ["Show.Name.S01E04.720p.HDTV.x264-GRP[eztv.re].mkv", "eztv.re"],
    ["Show.Name.S01E04.1080p.WEB.H264-GRP[EZTVx.to].mkv", "EZTVx.to"],
    ["Film.Name.2020.1080p.BluRay.x264.AAC5.1-[YTS.MX].mp4", "YTS.MX"],
    ["Film.Name.2020.1080p.WEBRip.x264-YTS.MX.mp4", "YTS.MX"],
    ["Film.Name.2020.1080p.WEB-DL.DUAL.5.1-cinecalidad.my.mkv", "cinecalidad.my"],
    ["Film.Name.2020.1080p.WEBRip.x264-Torrent9.info.mkv", "Torrent9.info"],
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
  }
  const anime = file("[Oploverz.com] Show - 04 [1080p].mkv");
  await enhanceAnimeStreams([anime]);
  assert.equal(anime.releaseGroup, "Oploverz.com", "what Harbor reads has changed");
  assert.equal(sourceTitle(anime).kind, "file");
});

test("a group that is no group is not believed, and the file name is the name", () => {
  for (const [filename, read] of [
    ["Film.Name.2020.1080p.WEB-DL.mkv", "DL"],
    ["Show Name - S01E04.mkv", "S01E04"],
    ["Show Name - s01e04.mkv", "s01e04"],
    ["Show-Name-S01E04.mkv", "S01E04"],
    ["Show.Name.S01E04-E05.mkv", "E05"],
    ["Show Name - E04.mkv", "E04"],
    ["Film-Name-2020.mkv", "2020"],
    ["Show Name - 04.mkv", "04"],
    ["Film.Name.2020.1080p.BluRay.H-264.mkv", "264"],
    ["Show Name - S01E04 - The Title.mkv", "Title"],
    ["Show Name - 1x04 - Some Title.avi", "Title.avi"],
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
  }
});

test("the second half of a technical word is no group either", () => {
  for (const [filename, read] of [
    ["Film.Name.2020.1080p.WEB-Rip.mkv", "Rip"],
    ["Film.Name.2020.1080p.Blu-Ray.mkv", "Ray"],
    ["Film.Name.2020.1080p.BluRay.DTS-HD.mkv", "HD"],
    ["Film.Name.2020.HD-CAM.mkv", "CAM"],
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
  }
});

test("other ways of writing an episode are no group either", () => {
  for (const group of ["S01", "S1E4", "S01E04E05", "S01E04v2", "EP04", "Episode4", "1x04"]) {
    const title = sourceTitle(mk({ releaseGroup: group, name: "Label" }));
    assert.deepEqual(title, { kind: "label", text: "Label" }, group);
  }
  for (const group of ["E4K", "S1MPLE", "EPSiLON", "4x4x4", "SiNNERS", "D3FiL3R", "DLabs"]) {
    const title = sourceTitle(mk({ releaseGroup: group, name: "Label" }));
    assert.deepEqual(title, { kind: "group", text: group }, group);
  }
});

test("a file ending is not part of a group", () => {
  for (const [filename, read] of [
    ["Film.Name.2020.DVDRip.XviD-GRP.avi", "GRP.avi"],
    ["Show.Name.S01E04.1080p.WEB.H264-GRP.ts", "GRP.ts"],
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "group", text: "GRP" }, filename);
  }
});

test("a word after a blank is believed when another line has it as a group", () => {
  const title = "Show.Name.S01.1080p.WEB-DL-GRP\nShow Name - S01E04 - by GRP.mkv";
  assert.deepEqual(sourceTitle(mk({ releaseGroup: "GRP", title })), { kind: "group", text: "GRP" });
  const torrent = { releaseGroup: "GRP", title: "Show Name by GRP", infoHash: "a".repeat(40) };
  assert.deepEqual(sourceTitle(mk(torrent)), { kind: "file", text: "Show Name by GRP" });
});

test("the last place a group stands at decides, not a word of the title before it", () => {
  const filename = "The.Title.S01E04 - The Title.mkv";
  assert.deepEqual(
    sourceTitle(mk({ releaseGroup: "Title", title: filename, behaviorHints: { filename } })),
    { kind: "file", text: filename },
  );
});

test("without a group and a file name the add-on's label names a source, else the add-on", () => {
  assert.deepEqual(sourceTitle(mk({ name: "Torrentio\n4k DV", addonName: "Other" })), {
    kind: "label",
    text: "Torrentio",
  });
  assert.deepEqual(sourceTitle(mk({ name: " ", addonName: "Comet" })), {
    kind: "label",
    text: "Comet",
  });
  assert.deepEqual(sourceTitle(mk({ name: undefined, addonName: undefined })), {
    kind: "label",
    text: "",
  });
});

test("a first line that is no release is no file name, and the add-on's label is the name", () => {
  const url = "https://example.test/video";
  const infoHash = "a".repeat(40);
  for (const [says, kind, text] of [
    [{ name: "Netflix", title: "Subscription", externalUrl: url }, "label", "Netflix"],
    [{ name: "YouTube", title: "Official Trailer", ytId: "abc" }, "label", "YouTube"],
    [{ name: "Plugin", title: "1080p | English | HLS", url }, "label", "Plugin"],
    [{ name: "Plugin 1080p", title: "Film Name (2020)\n💾 2 GB", url }, "label", "Plugin 1080p"],
    [{ name: "Indexer 1080p", title: "👤 3 💾 2 GB", infoHash }, "label", "Indexer 1080p"],
    [{ name: "Indexer", title: "Film Name\n👤 3 💾 2 GB", infoHash }, "file", "Film Name"],
    [{ name: "Indexer", title: "[Uploader] Film", infoHash }, "file", "[Uploader] Film"],
    [
      { name: "Plugin", title: "Film Name 2020 1080p\n💾 2 GB", url },
      "file",
      "Film Name 2020 1080p",
    ],
    [{ name: "Plugin", title: "Film Name.mkv", url }, "file", "Film Name.mkv"],
    [{ name: "Plugin", title: "Show 1x04 WEBRip", url }, "file", "Show 1x04 WEBRip"],
    [{ name: "Plugin", description: "Show S01E04 x265\n💾 2 GB", url }, "file", "Show S01E04 x265"],
    [{ name: "Plugin", title: " ", description: "Watch here", url }, "label", "Plugin"],
  ] as const) {
    const source = { ...read(says), releaseGroup: null };
    assert.deepEqual(sourceTitle(source), { kind, text }, JSON.stringify(says));
  }
});

test("the line under a name is the file, or else what the add-on says in its own words", () => {
  const url = "https://example.test/video";
  assert.deepEqual(sourceLine(file("Film.Name.2020.1080p-GRP.mkv")), {
    kind: "file",
    text: "Film.Name.2020.1080p-GRP.mkv",
  });
  assert.deepEqual(sourceLine(read({ name: "Netflix", title: "\n Subscription \nHD", url })), {
    kind: "words",
    text: "Subscription",
  });
  assert.deepEqual(sourceLine(read({ name: "Netflix", description: "Subscription", url })), {
    kind: "words",
    text: "Subscription",
  });
  assert.equal(sourceLine(read({ name: "Netflix", url })), null);
});

test("the name is what the first line shows, for the sort too", () => {
  const list = [
    file("Show Name - S01E04.mkv"),
    file("Show.Name.S01E04.1080p.WEB.h264-ZETA.mkv"),
    file("Another.Show.2020.1080p.WEB-DL.mkv"),
    mk({ name: "Middle" }),
  ];
  assert.deepEqual(list.map(sourceName), [
    "Show Name - S01E04.mkv",
    "ZETA",
    "Another.Show.2020.1080p.WEB-DL.mkv",
    "Middle",
  ]);
  assert.deepEqual(sortModern(list, by("name", "asc")).map(sourceName), [
    "Another.Show.2020.1080p.WEB-DL.mkv",
    "Middle",
    "Show Name - S01E04.mkv",
    "ZETA",
  ]);
});

test("a word of the add-on's own label is no group", () => {
  for (const [name, word] of [
    ["Some add-on\nStream", "on"],
    ["Provider - Premium", "Premium"],
  ]) {
    const source = read({ name, title: "", url: "https://example.test/video" });
    assert.equal(source.releaseGroup, word, `${name}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "label", text: name.split("\n")[0] }, name);
  }
});

test("a held row whose own object is still there keeps it, also among rows of one id", () => {
  const shown = [row("a", "sorted first"), row("a", "sorted second"), row("a", "dropped")];
  const { rows } = hold(shown, [shown[1], shown[0]]);
  assert.deepEqual(rows, shown);
});

test("a piece of a name is no group when a word of it is technical", () => {
  for (const [filename, read] of [
    ["Film.Name.2020.1080p.WEB-DL.AVC.mp4", "DL.AVC"],
    ["Film.Name.2020.1080p.WEB-DL.H264.mkv", "DL.H264"],
    ["Film.Name.2020.WEB-DL.1080p.mkv", "DL.1080p"],
    ["Film.Name.2020.1080p.Blu-Ray.x264.mkv", "Ray.x264"],
    ["Film.Name.2020.HDTV-720p.mkv", "720p"],
    ["Film.Name.2020.WEB-Rip.x264.mkv", "Rip.x264"],
    ["Film.Name.2020.HD-TS.x264.mkv", "TS.x264"],
    ["Film.Name.2020.1080p.WEB-DL.Dual-Audio.mkv", "Audio"],
    ["Film.Name.2020.1080p.WEB-DL.Multi-Subs.mkv", "Subs"],
    ["Film.Name.2020.1080p.10-bit.HEVC.mkv", "bit.HEVC"],
    ["Film.Name.2020.1080p.x265-10bit.mkv", "10bit"],
    ["X-Men.2000.mkv", "Men.2000"],
    ["Show.Name.S01E01-E02.1080p.mkv", "E02.1080p"],
    ["Show.Name.S01-S03.Complete.mkv", "S03.Complete"],
    ["Film.Name.2020.REMUX.4k-Dual-Lat.mkv", "Lat"],
    ["FILM NAME LAT TS-HQ.mp4", "HQ"],
  ]) {
    const source = file(filename);
    assert.equal(source.releaseGroup, read, `${filename}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind: "file", text: filename }, filename);
  }
});

test("a technical word inside a longer one does not matter", () => {
  for (const group of [
    "HDMaNiAcS",
    "CAMELOT",
    "RIPRAP",
    "HDC",
    "DDR",
    "ION10",
    "TSuNaMi",
    "WEBTiFUL",
    "BiTOR",
    "Audiophile",
    "Erai-raws",
    "D-Z0N3",
    "G.R.P",
    "GRP.abc2",
  ]) {
    const title = sourceTitle(mk({ releaseGroup: group, name: "Label" }));
    assert.deepEqual(title, { kind: "group", text: group }, group);
  }
});

test("a source with nothing known goes through every rule and is sorted last", () => {
  const bare = read({ addonName: "" });
  const known = [
    read({
      addonName: "Known",
      title: "Film.Name.2020.2160p.BluRay.REMUX.HDR10.HEVC.TrueHD.7.1-GRP.mkv",
      infoHash: "a".repeat(40),
    }),
    read({
      addonId: "other",
      addonName: "Other",
      title: "Film.Name.2020.720p.WEB-DL.H264-ABC.mkv",
      infoHash: "b".repeat(40),
    }),
  ].map((s, i) => ({ ...s, seeders: i, size: i + 1 }));
  assert.equal(sourceName(bare), "");
  assert.equal(knownResolution(bare), null);
  for (const key of ["name", "resolution", "seeders", "size"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      const sorted = sortModern([bare, ...known], by(key, dir));
      assert.equal(sorted.length, 3);
      assert.equal(sorted[2], bare, `${key} ${dir}`);
    }
  }
  const ctx: ModernContext = {
    isEpisode: true,
    noneCached: false,
    dubSub: () => null,
    addonOf: (s) => ({ id: s.addonId, name: s.addonName }),
  };
  const { main, more } = modernGroups([bare, ...known], {}, ctx);
  assert.deepEqual(
    main.map((group) => group.key),
    ["resolution", "hdr", "source", "addon"],
  );
  for (const group of [...main, ...more]) {
    for (const { value } of group.options) {
      const filters = { [group.key]: value };
      assert.ok(applyModernFilters([bare, ...known], filters, ctx).length > 0, group.key);
      modernGroups([bare, ...known], filters, ctx);
    }
  }
  assert.equal(
    pickModern({ list: [bare], preferred: bare, ranked: [bare], failed: new Set() }),
    bare,
  );
  assert.deepEqual(
    pickReasons({
      pick: bare,
      list: [bare],
      episode: null,
      playedLast: false,
      debrids: [],
      addonCached: false,
      canStreamDirectly: false,
    }),
    [{ kind: "not-cached", provider: null }],
  );
});

test("five hundred sources are filtered, sorted and counted at once", () => {
  const parts = [
    ["2160p", "BluRay.REMUX", "HEVC", "TrueHD.7.1"],
    ["1080p", "WEB-DL", "H264", "DDP5.1"],
    ["1080p", "BluRay", "x265", "AAC"],
    ["720p", "HDTV", "x264", "AC3"],
  ];
  const streams = Array.from({ length: 500 }, (_, i) => ({
    ...read({
      addonId: `addon-${i % 7}`,
      addonName: `Addon ${i % 7}`,
      title: `Film.Name.2020.${parts[i % 4].join(".")}-GRP${i % 40}.mkv`,
      infoHash: i.toString(16).padStart(40, "0"),
    }),
    seeders: (i * 37) % 900,
    size: ((i * 53) % 500) * 1e8,
  }));
  const ctx: ModernContext = {
    isEpisode: false,
    noneCached: false,
    dubSub: () => null,
    addonOf: (s) => ({ id: s.addonId, name: s.addonName }),
  };
  const once = (list: ScoredStream[]) => {
    const start = performance.now();
    const filtered = applyModernFilters(list, { resolution: "1080p" }, ctx);
    for (const key of ["name", "resolution", "seeders", "size"] as const) {
      sortModern(filtered, by(key, "asc"));
    }
    modernGroups(list, { resolution: "1080p" }, ctx);
    holdRows(list, [...list].reverse(), true, (s) => `${s.addonId}|${s.infoHash}`);
    return performance.now() - start;
  };
  const best = (list: ScoredStream[]) => Math.min(...Array.from({ length: 5 }, () => once(list)));
  const few = best(streams);
  assert.ok(few < 50, `took ${few.toFixed(1)} ms`);
  // A loop inside a loop would still fit in there; with eight times as many sources it takes 64
  // times as long, on a slow machine too.
  const many = Array.from({ length: 8 }, (_, n) =>
    streams.map((s) => ({ ...s, infoHash: `${n}${s.infoHash}` })),
  ).flat();
  const grown = best(many);
  assert.ok(grown < 20 * few + 5, `${few.toFixed(1)} ms became ${grown.toFixed(1)} ms`);
});
