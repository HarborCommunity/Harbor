import assert from "node:assert/strict";
import test from "node:test";
import type { DebridSlug, DebridStore } from "../src/lib/debrid/types.ts";
import { resetAllBadges, setBadgeRules } from "../src/lib/stream-badges.ts";
import { fetchLibraryStreams } from "../src/lib/streams/library.ts";
import { parseStream } from "../src/lib/streams/parser/parser-stream.ts";
import type { ScoredStream, Stream } from "../src/lib/streams/types.ts";
import type { ModernListProps } from "../src/views/play-picker/modern/modern-list.tsx";
import {
  dimValues,
  knownResolution,
  modernGroups,
  opensPage,
  pickModern,
  sortModern,
  sourceLine,
  sourceTitle,
  sourceWords,
  type ModernContext,
  type ModernDimKey,
} from "../src/views/play-picker/modern/modern-rules.ts";
import { streamIsCached } from "../src/views/play-picker/picker-utils.ts";
import {
  LAYOUTS,
  NOTICES,
  RESULTS,
  aggregatorAnswer,
  aggregatorNotice,
  aggregatorResult,
  fileOf,
  type FileName,
  type Layout,
} from "./helpers/aggregator-results.ts";
import { act, pointer, renderModern } from "./helpers/modern-picker.tsx";

const read = (stream: Stream): ScoredStream => ({
  ...parseStream(stream),
  score: 0,
  reasons: [],
  tier: "SD",
});
const says = (partial: Partial<Stream>): ScoredStream =>
  read({ addonId: "aggregator", addonName: "AIOStreams", ...partial });

const url = "https://example.test/play";
const infoHash = "a".repeat(40);

const firstOf = (text: string | undefined) => text!.split("\n")[0];
const resultsWith = (fileName: FileName) => RESULTS.filter((r) => r.fileName === fileName);
const WRITES_FILE_NAMES: readonly Layout[] = ["torrentio", "torbox", "gdrive"];

// --- the name of the file ------------------------------------------------------------------------

test("a file name an aggregator hands over is the line, whatever layout its texts have", () => {
  for (const layout of LAYOUTS) {
    for (const result of resultsWith("handed")) {
      assert.deepEqual(
        sourceLine(read(aggregatorResult(layout, result, 1))),
        { kind: "file", text: fileOf(result) },
        `${layout} ${result.via}`,
      );
    }
  }
});

test("a handed-over name is a file name when it ends as a video file or names a release", () => {
  for (const name of [
    "The Quiet Harbour.mkv",
    "03.mp4",
    ...["avi", "ts", "m2ts", "mts", "iso", "vob", "ogm", "ogv", "divx", "rmvb", "3gp"].map(
      (ending) => `The Quiet Harbour.${ending}`,
    ),
    "The.Quiet.Harbour.2024.1080p.WEB-DL.x264-GRP",
    "The Quiet Show S01E04 720p",
    "[Tide] The Quiet Show - 04 [1080p HEVC]",
  ]) {
    for (const field of ["filename", "fileName"]) {
      for (const way of [{ url }, { infoHash }]) {
        const source = says({ name: "Label", behaviorHints: { [field]: ` ${name} ` }, ...way });
        assert.deepEqual(sourceLine(source), { kind: "file", text: name }, `${field}: ${name}`);
      }
    }
  }
});

test("a handed-over name that is no file name is words, and the label names the source", () => {
  for (const name of [
    "The Quiet Harbour (2024)",
    "The Quiet Harbour",
    "Quality: 2160p WEB-DL",
    "🎥 WEB-DL 🎞️ HEVC",
    "master.m3u8",
  ]) {
    for (const field of ["filename", "fileName"]) {
      for (const way of [{ url }, { infoHash }]) {
        const source = says({ name: "Label\nMore", behaviorHints: { [field]: name }, ...way });
        assert.deepEqual(sourceLine(source), { kind: "words", text: name }, `${field}: ${name}`);
        assert.deepEqual(sourceTitle(source), { kind: "label", text: "Label" }, name);
      }
    }
  }
});

test("with only a title handed over, a source is named by what the layout says of it", () => {
  const filename = "The Quiet Harbour (2024)";
  for (const layout of LAYOUTS) {
    for (const result of RESULTS) {
      const sent = aggregatorResult(layout, result, 1);
      const source = read({ ...sent, behaviorHints: { ...sent.behaviorHints, filename } });
      const which = `${layout} ${result.via} ${result.fileName}`;
      const written = result.fileName !== "unknown" && WRITES_FILE_NAMES.includes(layout);
      if (written) {
        assert.deepEqual(sourceLine(source), { kind: "file", text: fileOf(result) }, which);
        continue;
      }
      assert.deepEqual(sourceLine(source), { kind: "words", text: filename }, which);
      assert.deepEqual(sourceTitle(source), { kind: "label", text: firstOf(source.name) }, which);
    }
  }
});

test("a file name that is only written is found wherever the layout writes it", () => {
  for (const layout of WRITES_FILE_NAMES) {
    for (const result of resultsWith("written")) {
      assert.deepEqual(
        sourceLine(read(aggregatorResult(layout, result, 1))),
        { kind: "file", text: fileOf(result) },
        `${layout} ${result.via}`,
      );
    }
  }
});

test("without a file name a source shows its layout's first lines as words and never as a file", () => {
  for (const layout of LAYOUTS) {
    const nameless = [
      ...resultsWith("unknown"),
      ...(WRITES_FILE_NAMES.includes(layout) ? [] : resultsWith("written")),
    ];
    for (const result of nameless) {
      const source = read(aggregatorResult(layout, result, 1));
      const which = `${layout} ${result.via}`;
      assert.deepEqual(
        sourceLine(source),
        { kind: "words", text: firstOf(source.description) },
        which,
      );
      assert.deepEqual(sourceTitle(source), { kind: "label", text: firstOf(source.name) }, which);
    }
  }
});

test("a line is a file name when it says which film or episode it is, without what stands in front", () => {
  for (const [line, name] of [
    ["The.Quiet.Harbour.2024.1080p.WEB-DL.x264-GRP"],
    ["The.Quiet.Harbour.1080p.WEB-DL.x264-GRP"],
    ["The Quiet Harbour (2024) (1080p BluRay x265 10bit)"],
    ["The Quiet Show S01E04 x265"],
    ["The Quiet Show S01 WEB-DL"],
    ["The Quiet Show (Season 1) 720p"],
    ["[Tide] The Quiet Show - 04 [1080p HEVC x265]"],
    ["【Tide】The Quiet Show 04 [1080p HEVC]"],
    ["[Tide] The Quiet Show - 04 (1080p) [A3C88136]"],
    ["[Tide] The Quiet Show - 04v2 [1080p][Multiple Subtitle]"],
    ["[Tide][Batch] The Quiet Show - 04.5 [1080p]"],
    ["[Tide]The_Quiet_Show_-_1085_(1080p)"],
    ["【Tide】静かな港 - 04【1080p】"],
    ["[Tide] The Quiet Show - 01-12 [1080p]"],
    ["[Tide] The Quiet Show - 01 ~ 12 [1080p]"],
    ["[Tide] The Quiet Show (01-12) (1080p) [Batch]"],
    ["[Tide] The Quiet Show [01~12] [1080p]"],
    ["[Tide] The Quiet Show - 4 [1080p]"],
    ["Quiet/show [The Long Night] - 04 (BD 1080p HEVC)"],
    ["The Quiet Show - 04 1080p"],
    ["The Quiet Show - 04v2 VOSTFR [1080p]"],
    ["The Quiet Show - 04 Kiba [1080p]"],
    ["The Quiet Show - 04 - The Long Night (1080p)"],
    ["The_Quiet_Show_-_1085_(1080p)"],
    ["The Quiet Show - 01-12 1080p"],
    ["The Quiet Show (01-12) [1080p]"],
    ["静かな港 第5話 1080p"],
    ["安静的港湾 第05集 1080p"],
    ["安静的港湾 第05回 1080p"],
    ["安静的港湾 第01-12话 1080p"],
    ["1917.2019.1080p.BluRay.x264-GRP"],
    ["#Alive.2020.1080p.WEB-DL.x264-GRP"],
    ["The Quiet Harbour.mkv"],
    ["Dune: Part Two.mkv"],
    ["Dune: Part Two (2024) 1080p WEB-DL"],
    ["Тихая гавань / The Quiet Harbour (2024) WEB-DL 1080p | Дубляж"],
    ["Fate/stay night - 04 (1080p).mkv"],
    ["Season 1/The Quiet Show - S01E04.mkv"],
    ["📂 The.Quiet.Harbour.2024.1080p.WEB-DL", "The.Quiet.Harbour.2024.1080p.WEB-DL"],
    ["🗂️ The Quiet Harbour.mkv", "The Quiet Harbour.mkv"],
    ["Name: The.Quiet.Harbour.2024.1080p.WEB-DL", "The.Quiet.Harbour.2024.1080p.WEB-DL"],
    ["📄 Name: The Quiet Harbour.mkv", "The Quiet Harbour.mkv"],
    [
      "📁 The.Quiet.Show.S01.1080p.WEB-DL-GRP/The.Quiet.Show.S01E04.1080p.WEB-DL-GRP.mkv",
      "The.Quiet.Show.S01E04.1080p.WEB-DL-GRP.mkv",
    ],
  ]) {
    for (const field of ["title", "description"] as const) {
      const expected = { kind: "file", text: name ?? line };
      const further = "👤 3 💾 2.4 GB ⚙️ Lantern, seen a week ago";
      assert.deepEqual(sourceLine(says({ [field]: `${line}\n${further}`, url })), expected, line);
      assert.deepEqual(sourceLine(says({ [field]: `${further}\n${line}`, url })), expected, line);
    }
  }
});

test("a row of facts is no file name", () => {
  for (const line of [
    "WEB-DL • HEVC • 10bit",
    "2160p | WEB-DL | HEVC",
    "1080p · BluRay · x264",
    "BluRay / REMUX / HEVC 2160p",
    "🎥 WEB-DL 🎞️ HEVC",
    ...["✦", "•", "·", "|"].map((sign) =>
      ["The Quiet Harbour", "2024", "1080p", "WEB-DL"].join(` ${sign} `),
    ),
    "2160p UHD BluRay REMUX HEVC",
    "[WEB-DL][HEVC][DTS]",
    "Quality: 2160p WEB-DL of 2024",
    "S01E04 1080p WEB-DL",
    "S01 1080p WEB-DL",
    "Season 1 Episode 4 1080p WEB-DL",
    "第5話 1080p",
    "(2024) 1080p WEB-DL",
  ]) {
    const words = { kind: "words", text: line };
    assert.deepEqual(sourceLine(says({ title: line, url })), words, line);
    assert.deepEqual(sourceLine(says({ description: line, url })), words, line);
    assert.deepEqual(sourceLine(says({ description: line, infoHash })), words, `torrent: ${line}`);
  }
});

test("a link's line that does not say enough of a release is words", () => {
  for (const line of [
    "English 1080p WEB-DL x264",
    "TorBox 2160p BluRay",
    "Server-1080p",
    "The Quiet Show S01E04 | 1080p | WEB-DL",
    "The Quiet Harbour 2024",
    "The Quiet Show - 04",
    "The Quiet Show (01-12)",
    "The Quiet Show - 4 1080p",
    "Server - 2 1080p",
    "Server (1-2) 1080p",
    "Mirror - 12 GB 1080p",
    "Mirror - 12 GiB 1080p",
    "Mirror - 120MB [1080p]",
    "Mirror - 10 bit 1080p",
    "Mirror - 112 min 1080p",
    "Mirror - 12 seeders 1080p",
    "Mirror - 12 peers 1080p",
    "HLS - 1080p - 30 fps",
    "HLS - 12 Mbps 1080p",
    "[Tide] The Quiet Show - 04",
    "[Tide] The Quiet Show (01-12)",
    "[Tide] The Quiet Show 1080p",
    "[Tide] The Quiet Show - 1080p",
    "[Tide] The Quiet Show - 5.1 1080p",
    "[Tide] The Quiet Show - 2nd 1080p",
    "[Tide] The Quiet Show-04 1080p",
    "[Tide] - 04 1080p",
    "[Tide] (01-12) 1080p",
  ]) {
    assert.deepEqual(sourceLine(says({ title: line, url })), { kind: "words", text: line }, line);
  }
  const both = says({ title: "The first words", description: "Further words", url });
  assert.deepEqual(sourceLine(both), { kind: "words", text: "The first words" });
});

test("a first line that opens as an add-on is called is a file name like any other", () => {
  const line = "Comet.2014.1080p.BluRay.x264-GRP";
  const further = "👤 3 💾 2.4 GB ⚙️ Lantern, a week ago";
  const source = says({ description: `${line}\n${further}`, url });
  assert.deepEqual(sourceLine(source), { kind: "file", text: line });
});

test("a torrent's first line is still its name when it is no row of facts", () => {
  for (const line of ["The Quiet Show, complete", "[Uploader] The Quiet Show (Season 1)"]) {
    for (const field of ["title", "description"] as const) {
      const torrent = says({ [field]: `${line}\n👤 3 💾 2 GB`, infoHash });
      assert.deepEqual(sourceLine(torrent), { kind: "file", text: line }, `${field}: ${line}`);
    }
  }
  for (const field of ["title", "description"] as const) {
    const named = { [field]: "The Quiet Show, complete", infoHash, name: "Label" };
    const other = says({ ...named, behaviorHints: { filename: "The fourth" } });
    assert.deepEqual(sourceLine(other), { kind: "file", text: "The Quiet Show, complete" }, field);
    const same = says({ ...named, behaviorHints: { filename: "The Quiet Show, complete" } });
    assert.deepEqual(sourceLine(same), { kind: "words", text: "The Quiet Show, complete" }, field);
    assert.deepEqual(sourceTitle(same), { kind: "label", text: "Label" }, "handed over as no name");
  }
  const pack = "The.Quiet.Show.S01.1080p.WEB-DL-GRP\nThe.Quiet.Show.S01E04.1080p.WEB-DL-GRP.mkv";
  assert.equal(sourceLine(says({ title: pack, infoHash }))!.text, firstOf(pack));
  assert.equal(sourceLine(says({ description: pack, infoHash }))!.text, pack.split("\n")[1]);
});

test("a source of Harbor's own debrid library is named after its file", async () => {
  const inLibrary = async (slug: DebridSlug, entry: object) => {
    const listLibrary = async () => ({ ok: true, data: [{ hash: infoHash, ...entry }] });
    const query = { type: "movie", imdbId: "tt1", title: "The Quiet Harbour", year: 2024 } as const;
    const store = { slug, listLibrary } as unknown as DebridStore;
    const found = await fetchLibraryStreams([store], query, new AbortController().signal);
    return read(found[0]);
  };
  for (const slug of ["rd", "tb", "ad", "pm", "dl"] as const) {
    for (const [file, group] of [
      ["The.Quiet.Harbour.2024.1080p.WEB-DL.DDP5.1.H.264-TIDE.mkv", "TIDE"],
      ["[Tide] The Quiet Harbour [1080p HEVC]", null],
      ["The Quiet Harbour (2024).mkv", null],
      ["The Quiet Harbour 2024 WEB-DL", null],
      ["The Quiet Harbour 1080p", null],
      ["The Quiet Harbour", null],
    ] as const) {
      for (const entry of [{ name: file }, { name: "A folder", files: [{ name: file }] }]) {
        const source = await inLibrary(slug, entry);
        assert.deepEqual(sourceLine(source), { kind: "file", text: file }, `${slug} ${file}`);
        const title = group ? { kind: "group", text: group } : { kind: "file", text: file };
        assert.deepEqual(sourceTitle(source), title, `${slug} ${file}`);
      }
    }
    for (const [file, resolution] of [
      ["The.Quiet.Harbour.2024.Into.the.Unknown.HDTV.x264-TIDE.mkv", "SD"],
      ["SD, The Quiet Harbour - 04.mkv", null],
    ] as const) {
      const source = await inLibrary(slug, { name: file });
      assert.equal(source.resolution, "SD", `${file}: what the parser reads has changed`);
      assert.equal(knownResolution(source), resolution, `${file}: no label of an add-on`);
    }
  }
});

test("an add-on's label is no file name, whatever it is made of", () => {
  const name = "[TB+] Addon 1080p WEB-DL";
  for (const [addonName, title] of [
    ["Addon", "The Quiet Show, the fourth"],
    ["Addon", "Addon"],
  ]) {
    for (const said of [{ title }, { description: title }]) {
      const source = says({ name, addonName, infoHash, ...said });
      assert.deepEqual(sourceLine(source), { kind: "file", text: title }, `${addonName}: ${title}`);
    }
  }
  const release = "The.Quiet.Show.S01E04.1080p.WEB-DL.x264-TIDE";
  for (const addonId of ["addon", "my-library", "my-tb-library", "tb-library-2"]) {
    const other = says({ name: release, title: "Seen on Addon", addonName: "Addon", addonId, url });
    assert.deepEqual(sourceLine(other), { kind: "words", text: "Seen on Addon" }, addonId);
    assert.deepEqual(sourceTitle(other), { kind: "label", text: release }, addonId);
  }
});

test("all an add-on says of a source without a file name, and none of it twice", () => {
  const words = (partial: Partial<Stream>) => sourceWords(says({ name: "Label", url, ...partial }));
  const title = "One\n\n  Two \r\nThree";
  assert.deepEqual(words({ title }), ["One", "Two", "Three"]);
  assert.deepEqual(words({ description: title }), ["One", "Two", "Three"]);
  assert.deepEqual(words({ title, description: "Four" }), ["One", "Two", "Three"], "as Stremio");
  assert.deepEqual(words({ title: " \n", description: "Four" }), ["Four"]);
  assert.deepEqual(words({ title: "One\nTwo\nOne\n🎬 Two\nThree" }), ["One", "Two", "Three"]);
  assert.deepEqual(words({ title: "⭐⭐\n🔥\n⭐⭐\nOne" }), ["⭐⭐", "🔥", "One"]);
  assert.deepEqual(words({ title: "One\n\n⭐⭐" }), ["One", "⭐⭐"]);
  assert.deepEqual(words({ title: "One\u00a0 two" }), ["One\u00a0 two"], "as it is written");
  assert.deepEqual(words({ title: "Label\nOne" }), ["One"], "nor its name");
  assert.deepEqual(words({}), []);
  const handed = (filename: string, text: string) =>
    words({ title: text, behaviorHints: { filename } });
  assert.deepEqual(handed("Zero", "🎬 One\nTwo"), ["Zero", "🎬 One", "Two"]);
  assert.deepEqual(handed("Two", "🎬 One\n🎥 Two"), ["Two", "🎬 One"]);
  const signs = ["🔊 English", "💬 English"];
  assert.deepEqual(words({ title: [...signs, "English"].join("\n") }), signs, "two things");
  assert.deepEqual(words({ title: ["English", ...signs].join("\n") }), ["English"]);
  assert.deepEqual(words({ title: signs.join("\nEnglish\n") }), signs, "whatever is left out");
  assert.deepEqual(words({ name: "Label\n✅ TB", title: "❌ TB\n✅ TB" }), ["✅ TB", "❌ TB"]);
});

test("a line of blanks that are drawn as nothing is none", () => {
  const unseen = ["\u200b", "\u200d", "\u2060", "\u00ad", "\ufe0f", "\u115f", "\u{e0020}"];
  for (const blank of ["\u00a0", "\u2800", "\u3164", "\u200b \u2800", ...unseen]) {
    const name = `${blank}\nLabel\n${blank}\nNot ready`;
    const source = says({ name, title: `${blank}${blank}\nOne\n${blank}`, url });
    assert.deepEqual(sourceTitle(source), { kind: "label", text: "Label" }, JSON.stringify(blank));
    assert.deepEqual(sourceWords(source), ["Not ready", "One"], JSON.stringify(blank));
    assert.deepEqual(sourceWords(source, false), ["Not ready", "One"], JSON.stringify(blank));
  }
});

test("a source without a file name says its whole label, in front of what else it says", () => {
  const words = (partial: Partial<Stream>, all?: boolean) =>
    sourceWords(says({ name: "Label\nNot ready\n\n  ★ 44 peers ", url, ...partial }), all);
  const label = ["Not ready", "★ 44 peers"];
  const title = "One\nTwo";
  assert.deepEqual(words({ title }), [...label, "One", "Two"]);
  assert.deepEqual(words({ description: title }), [...label, "One", "Two"]);
  const behaviorHints = { filename: "A Title (2024)" };
  assert.deepEqual(words({ title, behaviorHints }), [...label, "A Title (2024)", "One", "Two"]);
  assert.deepEqual(words({}), label);
  assert.deepEqual(words({ title: "🎬 Not ready\nOne\nLabel" }), [...label, "One"], "once");
  assert.deepEqual(words({ title }, false), [...label, "One"], "cut to a line, but not the label");
  assert.deepEqual(words({ title: "Label\n44 peers\nOne\nTwo" }, false), [...label, "One"]);
  assert.deepEqual(words({}, false), label);
  const filename = "The.Quiet.Harbour.2024.CAM-TIDE";
  const grouped = says({ name: "Label\nNot ready", behaviorHints: { filename }, url });
  assert.deepEqual(sourceTitle(grouped), { kind: "group", text: "TIDE" });
  assert.deepEqual(sourceWords(grouped), ["Label", "Not ready", filename], "a group is no label");
  const nulls = null as unknown as undefined;
  assert.deepEqual(sourceWords({ ...says({ title, url }), name: nulls }), ["One", "Two"]);
});

test("an entry that only opens a web page says one line, and none of its label's", () => {
  const notice = { name: "Statistics\nLeft out: 31\nToo small: 3", externalUrl: url };
  for (const all of [true, false]) {
    const said = sourceWords(says({ ...notice, description: "One\nTwo" }), all);
    assert.deepEqual(said.slice(0, 1), ["One"]);
    assert.deepEqual(sourceWords(says(notice), all), []);
  }
  assert.deepEqual(sourceWords(says({ ...notice, description: "One\nTwo" }), false), ["One"]);
});

test("a title that is handed over and also written is said once, whatever blanks it has", () => {
  const title = "The Quiet Harbour (2024)";
  for (const blank of ["\u00a0", "\u202f", "\u2003", "\u2800", "\u3164", "  "]) {
    const description = `🎬${blank}${title.replaceAll(" ", blank)}\nTwo`;
    const behaviorHints = { filename: title };
    const source = says({ name: "Label", url, description, behaviorHints });
    assert.deepEqual(sourceWords(source), [title, "Two"], JSON.stringify(blank));
    const twice = says({ name: "Label", url, title: `One two\nOne${blank}two\nThree` });
    assert.deepEqual(sourceWords(twice), ["One two", "Three"], JSON.stringify(blank));
    const torrent = { infoHash, name: "Label", behaviorHints };
    for (const field of ["title", "description"]) {
      const written = says({ ...torrent, [field]: title.replaceAll(" ", blank) });
      assert.deepEqual(sourceLine(written), { kind: "words", text: title }, JSON.stringify(blank));
      assert.deepEqual(sourceWords(written), [title], JSON.stringify(blank));
    }
  }
  const apart = says({ name: "Label", url, title: "Onetwo\nOne two" });
  assert.deepEqual(sourceWords(apart), ["Onetwo", "One two"], "a blank is still one");
});

test("a source whose layout alone names its resolution has it everywhere in the look", async () => {
  const unknown = resultsWith("unknown").filter((r) => r.via === "debrid");
  for (const layout of LAYOUTS) {
    const streams = unknown.map((r, at) => read(aggregatorResult(layout, r, at)));
    const really = unknown.map((r) => r.resolution);
    assert.deepEqual(really, ["1080p", "720p"]);
    const view = await renderModern({ streams }, { settings: { showQualityBadge: true } });
    try {
      for (const [at, row] of rows().entries()) {
        const shown = row.querySelector('[data-cell="resolution"]')!.textContent!;
        const label = row.querySelector("[data-play]")!.getAttribute("aria-label")!;
        // One layout calls 720p "HD", which can be any of them.
        const said = layout === "prism" && really[at] === "720p" ? "" : really[at];
        assert.ok(shown.startsWith(said), `${layout} ${at}`);
        assert.equal(label.split(really[at]).length - 1, said ? 1 : 0, `${layout} ${at}`);
        assert.doesNotMatch(shown + label, /SD/, `${layout} ${at}`);
      }
      assert.deepEqual(badges().slice(0, 1), ["1080p Full HD"], layout);
      assert.ok(!badges().includes("Standard Definition"), layout);
      assert.match(sentence(), /in 1080p/, layout);
      assert.doesNotMatch(why() ?? "", /SD/, layout);
    } finally {
      await view.unmount();
    }
  }
});

test("a pick that only its label names the resolution of has the badge of it", async () => {
  for (const [name, title, expected] of [
    ["Label 4K", "🎥 WEB-DL 🎞️ HEVC", "4K UHD"],
    ["Label FHD", "Some Show 04", "1080p Full HD"],
    ["Label SD", "Some Show 04", "Standard Definition"],
    ["Label 720p", "🎥 WEB-DL 🎞️ HEVC", "720p HD"],
    ["Label HD", "🎥 WEB-DL 🎞️ HEVC", "WEB-DL"],
    ["Label", "Some Show 04", "No quality label"],
  ]) {
    const pick = says({ name, title, url });
    assert.equal(pick.resolution, "SD", `${name}: what the parser reads has changed`);
    const view = await renderModern({ streams: [pick] }, { settings: { showQualityBadge: true } });
    try {
      assert.equal(badges()[0], expected, `${name}, ${title}`);
    } finally {
      await view.unmount();
    }
  }
});

test("a badge of one's own for the resolution is left out beside Harbor's, as everywhere", async () => {
  const rule = { id: "1", name: "1080p", pattern: "1080p", enabled: true };
  const pick = says({ name: "Label 1080p", title: "🎥 WEB-DL 🎞️ HEVC", url });
  const view = await renderModern({ streams: [pick] }, { settings: { showQualityBadge: true } });
  try {
    await act(() => setBadgeRules([rule, { ...rule, id: "2", name: "Mine", pattern: "HEVC" }]));
    assert.equal(badges()[0], "1080p Full HD");
    assert.equal(document.querySelector("[data-pick-badges]")!.textContent, "Mine");
  } finally {
    await act(() => resetAllBadges());
    await view.unmount();
  }
});

test("a play button says the resolution once, also where the source's name does", async () => {
  const title = "🎥 WEB-DL 🎞️ HEVC";
  const release = "The.Quiet.Harbour.2024.2160p.WEB-DL.x265-4KTIDE.mkv";
  const streams = [
    says({ name: "Label 1080p", title, url: `${url}/1` }),
    says({ name: "Label FHD", title, url: `${url}/2` }),
    says({ name: "Label 4k", title, url: `${url}/3` }),
    says({ name: "Label SDR", title: "🎥 HDTV 🎞️ AVC", url: `${url}/4` }),
    says({ name: "Label", title: release, infoHash }),
    says({ name: "Label", title: "The.Quiet.Harbour.2024.1080p.WEB-DL.mkv", url: `${url}/5` }),
  ];
  const view = await renderModern({ streams });
  try {
    assert.deepEqual(
      rows().map((row) => row.querySelector("[data-play]")!.getAttribute("aria-label")),
      [
        "Play Label 1080p",
        "Play Label FHD 1080p",
        "Play Label 4k",
        "Play Label SDR SD",
        "Play 4KTIDE 4K",
        "Play The.Quiet.Harbour.2024.1080p.WEB-DL.mkv",
      ],
    );
  } finally {
    await view.unmount();
  }
});

test("a pick that is SD still has its badge", async () => {
  const pick = says({ title: "The.Quiet.Show.S01E04.HDTV.x264-GRP.mkv", infoHash });
  const view = await renderModern({ streams: [pick] }, { settings: { showQualityBadge: true } });
  try {
    assert.ok(badges().includes("Standard Definition"));
    assert.match(sentence(), /in SD/);
  } finally {
    await view.unmount();
  }
});

// --- the group -----------------------------------------------------------------------------------

test("a hyphened word of what an add-on says is no group", () => {
  const externalUrl = "https://example.test/page";
  for (const [read, kind, text, partial] of [
    [
      "limited",
      "label",
      "❌ Lantern",
      { name: "❌ Lantern", description: "Rate-limited", externalUrl },
    ],
    [
      "in",
      "label",
      "❌ Lantern",
      { name: "❌ Lantern", description: "Please sign-in", externalUrl },
    ],
    ["free", "label", "Plugin", { name: "Plugin", description: "Fast and ad-free", url }],
    [
      "MARSH",
      "label",
      "[TB+] 1080p",
      { name: "[TB+] 1080p", description: "🎥 WEB-DL 🎞️ HEVC 🏷️ SALT-MARSH\n📦 4 GB", url },
    ],
    [
      "MARSH",
      "label",
      "[TB+] 1080p",
      { name: "[TB+] 1080p", behaviorHints: { filename: "🎥 WEB-DL 🏷️ SALT-MARSH" }, url },
    ],
    ["Man", "label", "1080p", { name: "1080p", behaviorHints: { filename: "Spider-Man" }, url }],
    ["Man", "file", "Spider-Man.mkv", { name: "1080p", title: "Spider-Man.mkv", url }],
  ] as const) {
    const source = says(partial);
    assert.equal(source.releaseGroup, read, `${text}: what the parser reads has changed`);
    assert.deepEqual(sourceTitle(source), { kind, text }, read);
  }
});

test("a handed-over name that is no file name can still hold its release's group", () => {
  const filename = "The.Quiet.Harbour.2024.CAM-TIDE";
  const source = says({ name: "Label", behaviorHints: { filename }, url });
  assert.equal(source.releaseGroup, "TIDE", "what the parser reads has changed");
  assert.deepEqual(sourceTitle(source), { kind: "group", text: "TIDE" });
  assert.deepEqual(sourceLine(source), { kind: "words", text: filename });
  const short = { ...source, behaviorHints: { filename: "S01E04.1080p.WEB.H264-TIDE.mkv" } };
  assert.deepEqual(
    sourceTitle(short),
    { kind: "group", text: "TIDE" },
    "a file is no row of facts",
  );
});

test("a group stands behind a bracket, or behind a dash and what the release says before it", () => {
  for (const [filename, group] of [
    ["The.Quiet.Harbour.2024-TIDE.mkv", "TIDE"],
    ["The.Quiet.Show.S01E04-TIDE.mkv", "TIDE"],
    ["The.Quiet.Harbour.1080p-TIDE.mkv", "TIDE"],
    ["The.Quiet.Harbour.DVDRip.XviD-TIDE", "TIDE"],
    ["[Tide] The Quiet Show - 04.mkv", "Tide"],
    ["【Tide】The Quiet Show 04.mkv", "Tide"],
  ]) {
    const tag = `🏷️ ${group}`;
    for (const partial of [
      { behaviorHints: { filename }, description: tag },
      { behaviorHints: { fileName: filename }, description: tag },
      { title: `${filename}\n${tag}` },
      { description: `${tag}\n📄 ${filename}\n💾 2 GB` },
      { description: `${tag}\n📁 ${filename}/The Quiet Show.mkv` },
    ]) {
      const source = { ...says({ ...partial, name: "Label", url }), releaseGroup: group };
      assert.deepEqual(sourceTitle(source), { kind: "group", text: group }, filename);
    }
  }
});

test("a null where an add-on's text belongs is no text", () => {
  const nothing = null as unknown as undefined;
  const file = "The.Quiet.Harbour.2024-TIDE.mkv";
  const bare = { name: nothing, description: nothing, behaviorHints: { filename: nothing } };
  const named = { ...says({ title: file, url }), ...bare };
  assert.deepEqual(sourceLine(named), { kind: "file", text: file });
  assert.deepEqual(sourceTitle({ ...named, releaseGroup: "TIDE" }), {
    kind: "group",
    text: "TIDE",
  });
  assert.deepEqual(sourceTitle({ ...named, releaseGroup: "Quiet" }), { kind: "file", text: file });
  const nameless = { ...named, title: nothing, releaseGroup: "TIDE" };
  assert.equal(sourceLine(nameless), null);
  assert.deepEqual(sourceTitle(nameless), { kind: "group", text: "TIDE" });
});

// --- entries that only open a web page -----------------------------------------------------------

const TORBOX = { slug: "tb", name: "TorBox", queueCache: () => undefined };
const debrids = [TORBOX] as unknown as ModernListProps["debrids"];
/** The page's own test. */
const isCached = (s: ScoredStream) => streamIsCached(s, debrids);

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];
const nameOf = (row: HTMLElement) => row.querySelector("[data-name]")!.textContent!;
const rowOf = (name: string) => rows().find((row) => nameOf(row) === name)!;
const cell = (row: HTMLElement, name: string) =>
  row.querySelector(`[data-cell="${name}"]`)!.textContent;
const tally = () => document.querySelector("[data-tally]")!.textContent;
const why = () => document.querySelector("[data-pick-why]")?.textContent ?? null;
const badges = () =>
  [...document.querySelectorAll<HTMLImageElement>("[data-pick-badges] img")].map(({ alt }) => alt);
const sentence = () =>
  document
    .querySelector("[data-pick-sentence]")!
    .textContent!.replace(/[\u2068\u2069]/g, "")
    .replaceAll("\u00a0", " ");
const notice = (at: number) => read(aggregatorNotice(NOTICES[at], at));
const sources = (via: string) => RESULTS.filter((r) => r.via === via);

test("an entry with something to play behind it is more than a web page", () => {
  assert.equal(opensPage(notice(0)), true);
  for (const plays of [{ url }, { infoHash }]) {
    assert.equal(opensPage({ ...notice(0), ...plays }), false);
  }
});

test("an entry that only opens a web page is external, whatever its text says of caches", async () => {
  const streams = aggregatorAnswer("gdrive", RESULTS, "bottom").map(read);
  const said = streams.filter((s) => s.externalUrl && isCached(s));
  assert.equal(said.length, 1, "one has the signs that Harbor reads as cached");
  const view = await renderModern({ streams, debrids, isCached });
  try {
    for (const { name } of NOTICES) {
      assert.equal(cell(rowOf(name), "from"), "AIOStreamsExternal", name);
    }
    assert.equal(tally(), "14 sources · 5 ready to start at once");
  } finally {
    await view.unmount();
  }
});

test("an entry that only opens a web page is no reason to show cached sources only", async () => {
  const streams = [...aggregatorAnswer("gdrive", sources("p2p")), aggregatorNotice(NOTICES[2], 9)];
  const view = await renderModern({ streams: streams.map(read), debrids, isCached });
  try {
    assert.equal(tally(), "4 sources · 0 ready to start at once");
    const cachedOnly = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    assert.equal(cachedOnly.disabled, true);
  } finally {
    await view.unmount();
  }
});

test("a pick that only opens a web page gives no reason of caches", async () => {
  const pick = notice(2);
  const view = await renderModern({ streams: [pick], debrids, isCached });
  try {
    assert.equal(why(), null);
  } finally {
    await view.unmount();
  }
});

/** A notice with numbers in its text, as Harbor's parser reads them. */
const counts = () => {
  const source = notice(3);
  assert.equal(source.resolution, "4K", "what the parser reads has changed");
  assert.equal(source.seeders, 5000, "what the parser reads has changed");
  assert.ok(source.size! > 0 && source.audioLanguages.length > 0, "what the parser reads");
  return source;
};

test("numbers in the text of an entry that only opens a web page are no facts of a file", async () => {
  counts();
  const streams = aggregatorAnswer("gdrive", RESULTS, "top").map(read);
  const view = await renderModern({ streams, preferred: streams[4], debrids, isCached });
  try {
    const row = rowOf("🧹 Left out");
    const words = [...row.querySelectorAll("[data-words] > *")].map((line) => line.textContent);
    assert.deepEqual(words, ["Twice: 31"], "of a notice the first line");
    for (const name of ["resolution", "seeders", "size", "audio"]) {
      assert.equal(row.querySelector(`[data-cell="${name}"]`)!.innerHTML, "", name);
    }
    const bar = rowOf("OARLOCK").querySelector<HTMLElement>('[data-cell="seeders"] [style]')!;
    assert.equal(bar.style.width, "100%", "the most seeders a source has are the full bar");
    assert.match(why()!, /Most seeders at 4K\./);
  } finally {
    await view.unmount();
  }
});

test("an entry that only opens a web page has no mark of a file either", async () => {
  const page = {
    ...counts(),
    name: "Page",
    description: "Words",
    audioLanguages: ["Japanese", "English"],
    audio: { codec: "Atmos", channels: 8 } as const,
    seasonPack: true,
    edition: "REMASTERED",
  };
  const view = await renderModern({
    streams: [page],
    meta: { id: "kitsu:1", type: "series", name: "A show" },
    episode: { season: 1, episode: 4 },
    isAnime: true,
  });
  try {
    assert.equal(rows()[0].textContent, "PageHarbor's pickWordsAIOStreamsExternal");
    assert.equal(
      sentence(),
      "Harbor's pick comes from AIOStreams, in unknown quality, size unknown.",
    );
    assert.equal(why(), null);
    assert.ok(!document.querySelector("[data-pick-badges]"));
  } finally {
    await view.unmount();
  }
});

test("a pick that only opens a web page gives no reason of a film's HDR", async () => {
  const pick: ScoredStream = { ...counts(), hdrFormat: "HDR10" };
  for (const [lastPlayedStream, says] of [
    [null, null],
    [pick, "Played last time."],
  ] as const) {
    const view = await renderModern({ streams: [pick], lastPlayedStream });
    try {
      assert.equal(why(), says);
    } finally {
      await view.unmount();
    }
  }
});

test("an entry that only opens a web page is sorted last and passes the add-on's filter alone", () => {
  const page = { ...counts(), hdrFormat: "HDR10", codec: "HEVC", source: "WEB-DL" } as ScoredStream;
  const list = [...aggregatorAnswer("gdrive").map(read), page];
  for (const key of ["resolution", "seeders", "size"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      assert.equal(sortModern(list, { key, dir }).at(-1), page, `${key} ${dir}`);
    }
  }
  const ctx: ModernContext = {
    isEpisode: true,
    noneCached: false,
    dubSub: () => "dual",
    addonOf: (s) => ({ id: s.addonId, name: s.addonName }),
  };
  const keys: ModernDimKey[] = ["release", "dub", "resolution", "hdr", "source", "codec", "audio"];
  for (const key of [...keys, "availability" as const]) {
    assert.deepEqual(dimValues(page, key, ctx), [], key);
  }
  assert.deepEqual(dimValues(page, "addon", ctx), [page.addonId]);
  const counted = (streams: ScoredStream[]) => {
    const { main, more } = modernGroups(streams, {}, ctx);
    return [...main, ...more].filter((group) => group.key !== "addon");
  };
  assert.deepEqual(counted(list), counted(list.slice(0, -1)));
});

test("a line of an entry that only opens a web page is never a file name", () => {
  const description = "The Quiet Harbour 2024 1080p WEB-DL: 12 results";
  const page = says({ name: "Counted", description, externalUrl: "https://example.test/page" });
  assert.deepEqual(sourceLine(page), { kind: "words", text: description });
  assert.equal(sourceLine({ ...page, url })!.kind, "file", "a source with this line has one");
  const handed = { ...page, behaviorHints: { filename: "The Quiet Harbour.mkv" } };
  assert.deepEqual(sourceLine(handed), { kind: "words", text: "The Quiet Harbour.mkv" });
});

test("an entry that only opens a web page is not the pick while there is something to play", () => {
  const [page, other] = [notice(0), notice(1)];
  const [a, b] = aggregatorAnswer("gdrive", sources("p2p")).map(read);
  const list = [page, other, a, b];
  const pick = (from: ScoredStream[], failed: ScoredStream[] = []) =>
    pickModern({ list: from, preferred: page, ranked: list, failed: new Set(failed) });
  assert.ok(pick(list) === a, "the best ranked one to play, though the page's own best is none");
  assert.ok(pick(list, [a]) === b, "and not one that failed");
  assert.ok(pick(list, [a, b]) === a, "a source that failed rather than a web page");
  assert.ok(pick([page, other]) === page, "with nothing to play it stays");
  assert.ok(pickModern({ list, preferred: b, ranked: list, failed: new Set() }) === b);
});

test("with notices on top and nothing ready the pick is a source to play", async () => {
  const streams = aggregatorAnswer("gdrive", sources("p2p"), "top").map(read);
  const view = await renderModern({ streams, debrids, isCached });
  try {
    assert.equal(sentence(), "Harbor's pick is OARLOCK in 1080p, 7.70 GB.");
    assert.match(rowOf("OARLOCK").textContent!, /Harbor's pick/);
    assert.doesNotMatch(document.querySelector("[data-pick]")!.textContent!, /Open in browser/);
  } finally {
    await view.unmount();
  }
});

test("notices that share one link are rows with marks of their own, also while they are held", async () => {
  const streams = NOTICES.map((_, at) => notice(at));
  assert.equal(new Set(streams.map((s) => s.externalUrl)).size, 1);
  const problems: unknown[] = [];
  const { error } = console;
  console.error = (...args: unknown[]) => problems.push(args);
  const view = await renderModern({
    streams,
    preferred: streams[2],
    failedStreams: new Set([streams[1]]),
  });
  try {
    const marked = (what: string) => rows().map((row) => row.textContent!.includes(what));
    const inOrder = NOTICES.map(({ name }) => name);
    assert.deepEqual(rows().map(nameOf), inOrder);
    assert.deepEqual(marked("Harbor's pick"), [false, false, true, false]);
    assert.deepEqual(marked("Unavailable"), [false, true, false, false]);
    await pointer("enter", rows()[0]);
    const newer = streams.map((s) => ({ ...s })).reverse();
    await view.rerender({ streams: newer, ranked: newer });
    assert.deepEqual(rows().map(nameOf), inOrder, "held");
    await pointer("leave", rows()[0]);
    assert.deepEqual(rows().map(nameOf), inOrder.toReversed());
    assert.deepEqual(problems, [], "no two rows have one key");
  } finally {
    console.error = error;
    await view.unmount();
  }
});

test("the button of an entry that only opens a web page says what it does", async () => {
  const streams = aggregatorAnswer("gdrive", sources("p2p"), "bottom").map(read);
  const opened: unknown[] = [];
  const view = await renderModern({ streams, onPlay: (s) => opened.push(s) });
  try {
    const buttonOf = (name: string) => rowOf(name).querySelector<HTMLElement>("[data-play]")!;
    const opens = buttonOf("❌ Lantern");
    assert.equal(opens.getAttribute("aria-label"), "Open in browser ❌ Lantern");
    assert.ok(opens.querySelector(".lucide-external-link"));
    const plays = buttonOf("OARLOCK");
    assert.equal(plays.getAttribute("aria-label"), "Play OARLOCK 1080p");
    assert.ok(!plays.querySelector(".lucide-external-link"));
    await act(() => opens.click());
    assert.deepEqual(opened, [streams.find((s) => s.name === "❌ Lantern")]);
  } finally {
    await view.unmount();
  }
});
