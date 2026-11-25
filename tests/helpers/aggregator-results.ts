import type { Stream } from "../../src/lib/streams/types.ts";

/**
 * Made-up results in the shapes an aggregator add-on sends them: one add-on that gathers others,
 * writes every text in the layout its user chose, gives links for nearly everything, and puts
 * notices among the results. Titles, groups, indexers and addresses are invented.
 */
export const LAYOUTS = ["torrentio", "torbox", "gdrive", "prism", "signs"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const AGGREGATOR = {
  addonId: "aggregator.example",
  addonName: "AIOStreams",
  addonUrl: "https://aggregator.example.test/made-up/manifest.json",
  addonRanked: true,
  addonPriority: 0,
};

/** Every notice of the aggregator links to the same page. */
export const NOTICE_PAGE = "https://aggregator.example.test/project";

/** Whether a result's file name is known: in its own field, in a layout that writes it, or not. */
export type FileName = "handed" | "written" | "unknown";

export type Result = {
  via: "debrid" | "usenet" | "http" | "p2p";
  cached?: boolean;
  fileName: FileName;
  resolution: string;
  quality: string;
  encode: string;
  visual?: string[];
  audio: string;
  channels: string;
  group: string | null;
  size: number;
  seeders?: number;
  languages?: string[];
};

const GB = 1024 ** 3;
const TITLE = "The Quiet Harbour";
const YEAR = 2024;

/** The name of a result's file, also of one whose name is not known. */
export function fileOf(r: Result): string {
  const words = [TITLE, YEAR, r.resolution, r.quality, ...(r.visual ?? []), r.audio, r.channels];
  const video = { HEVC: "H.265", AVC: "H.264" }[r.encode] ?? r.encode;
  return `${[...words, video].join(" ").replaceAll(" ", ".")}-${r.group ?? "NOGROUP"}.mkv`;
}

export const RESULTS: readonly Result[] = [
  {
    via: "debrid",
    cached: true,
    fileName: "handed",
    resolution: "2160p",
    quality: "WEB-DL",
    encode: "HEVC",
    visual: ["DV", "HDR10"],
    audio: "Atmos",
    channels: "5.1",
    group: "NORDLYS",
    size: 21.4,
    seeders: 812,
    languages: ["English"],
  },
  {
    via: "debrid",
    cached: true,
    fileName: "written",
    resolution: "1080p",
    quality: "BluRay",
    encode: "HEVC",
    visual: ["10bit"],
    audio: "AAC",
    channels: "5.1",
    group: "MOONDECK",
    size: 9.8,
    seeders: 240,
    languages: ["English", "German"],
  },
  {
    via: "debrid",
    cached: true,
    fileName: "unknown",
    resolution: "1080p",
    quality: "WEB-DL",
    encode: "HEVC",
    audio: "DD+",
    channels: "5.1",
    group: "KELPWORKS",
    size: 6.2,
    seeders: 31,
    languages: ["English"],
  },
  {
    via: "debrid",
    fileName: "handed",
    resolution: "2160p",
    quality: "BluRay REMUX",
    encode: "HEVC",
    visual: ["HDR10"],
    audio: "TrueHD",
    channels: "7.1",
    group: "TIDELINE",
    size: 62.3,
    seeders: 44,
    languages: ["English", "French"],
  },
  {
    via: "debrid",
    fileName: "unknown",
    resolution: "720p",
    quality: "WEBRip",
    encode: "AVC",
    audio: "AAC",
    channels: "2.0",
    group: null,
    size: 2.1,
    seeders: 9,
  },
  {
    via: "usenet",
    cached: true,
    fileName: "handed",
    resolution: "1080p",
    quality: "BluRay",
    encode: "AVC",
    audio: "DTS",
    channels: "5.1",
    group: "SALTMARSH",
    size: 12.9,
    languages: ["English"],
  },
  {
    via: "p2p",
    fileName: "handed",
    resolution: "1080p",
    quality: "WEB-DL",
    encode: "AVC",
    audio: "DD+",
    channels: "5.1",
    group: "OARLOCK",
    size: 7.7,
    seeders: 1290,
    languages: ["English"],
  },
  {
    via: "p2p",
    fileName: "written",
    resolution: "720p",
    quality: "HDTV",
    encode: "AVC",
    audio: "AC3",
    channels: "2.0",
    group: "BUOYANT",
    size: 1.9,
    seeders: 66,
    languages: ["English"],
  },
  {
    via: "p2p",
    fileName: "unknown",
    resolution: "1080p",
    quality: "BluRay",
    encode: "AVC",
    audio: "DTS",
    channels: "5.1",
    group: "ANCHORAGE",
    size: 11.5,
    seeders: 18,
    languages: ["English"],
  },
  {
    via: "http",
    fileName: "unknown",
    resolution: "1080p",
    quality: "WEB-DL",
    encode: "AVC",
    audio: "AAC",
    channels: "2.0",
    group: null,
    size: 3.3,
    languages: ["English"],
  },
];

type Part = string | false | null | undefined;
const words = (...parts: Part[]) => parts.filter(Boolean).join(" ");
const lines = (...parts: Part[]) => parts.filter(Boolean).join("\n");

const FLAGS: Record<string, string> = { English: "🇬🇧", German: "🇩🇪", French: "🇫🇷" };
const PRISM: Record<string, string> = { "2160p": "🔥 4K UHD", "1080p": "🚀 FHD", "720p": "💿 HD" };

function textsOf(layout: Layout, r: Result): { name: string; description: string } {
  const file = r.fileName === "unknown" ? null : fileOf(r);
  const visual = r.visual?.join(" | ");
  const languages = r.languages ?? [];
  const served = r.via === "debrid" || r.via === "usenet";
  const people = r.seeders !== undefined && `👥 ${r.seeders}`;
  const size = `${r.size} GB`;
  const addon = AGGREGATOR.addonName;
  const p2p = r.via === "p2p" && "[P2P]";

  switch (layout) {
    case "torrentio":
      return {
        name: lines(
          words(p2p, served && (r.cached ? "[TB+]" : "[TB download]"), addon, r.resolution),
          visual,
        ),
        description: lines(
          file?.replace(/\.mkv$/, ""),
          file,
          words(`💾 ${size}`, people, "⚙️ Lantern"),
          languages.map((language) => FLAGS[language]).join(" / "),
        ),
      };
    case "torbox":
      return {
        name: words(
          p2p,
          addon,
          served && (r.cached ? "(Instant TB)" : "(TB)"),
          `(${r.resolution})`,
        ),
        description: lines(
          `Quality: ${r.quality}`,
          `Name: ${file ?? "Unknown"}`,
          `Size: ${size} | Source: Lantern`,
          languages.length > 0 && `Languages: ${languages.join(", ")}`,
        ),
      };
    case "gdrive":
      return {
        name: words(p2p, served && `[TB${r.cached ? "⚡" : "⏳"}]`, addon, r.resolution),
        description: lines(
          words(`🎥 ${r.quality}`, `🎞️ ${r.encode}`, r.group && `🏷️ ${r.group}`),
          words(visual && `📺 ${visual}`, `🎧 ${r.audio}`, `🔊 ${r.channels}`),
          words(`📦 ${size}`, "⏱️ 1h:52m", people, "🔍 Lantern"),
          languages.length > 0 && `🌎 ${languages.join(" | ")}`,
          file && `📁 ${file.replace(/\.mkv$/, "")}/${file}`,
        ),
      };
    case "prism":
      return {
        name: PRISM[r.resolution],
        description: lines(
          `🎬 ${TITLE} (${YEAR})`,
          words(`🎥 ${r.quality}`, visual && `📺 ${visual}`, `🎞️ ${r.encode}`),
          words(`🎧 ${r.audio}`, `🔊 ${r.channels}`, languages.length > 0 && languages.join(" / ")),
          words(`📦 ${size}`, r.seeders !== undefined && !r.cached && `🌱 ${r.seeders}`),
          words(r.group && `🏷️ ${r.group}`, "📡 Lantern"),
          words(
            r.cached ? "⚡ Ready" : "❌ Not Ready",
            served && "(TB)",
            { debrid: null, usenet: "📰 Usenet", http: "💻 Link", p2p: "⚠️ P2P" }[r.via],
          ),
        ),
      };
    case "signs":
      return {
        name: words("💎", r.resolution, ...(r.visual ?? []), "✦", r.cached ? "🚀" : "☁️"),
        description: lines(
          `✧ ${[r.quality, r.encode, r.audio, r.channels].join(" • ")}`,
          words(`◈ ${size}`, r.seeders !== undefined && `◈ ${r.seeders} peers`),
          words("➤", r.group, "➤ Lantern"),
        ),
      };
  }
}

/** A result as the add-on's answer is mapped by Harbor; `at` is its place in the answer. */
export function aggregatorResult(layout: Layout, r: Result, at: number): Stream {
  return {
    ...AGGREGATOR,
    ...textsOf(layout, r),
    addonReturnIdx: at,
    ...(r.via === "p2p"
      ? { infoHash: at.toString(16).padStart(40, "a"), fileIdx: 0 }
      : { url: `https://aggregator.example.test/play/${layout}/${at}` }),
    behaviorHints: {
      videoSize: Math.round(r.size * GB),
      ...(r.fileName === "handed" ? { filename: fileOf(r) } : {}),
    },
  };
}

/** Two add-ons that failed and two counts of what the others answered. None of them is a source. */
export const NOTICES: readonly { name: string; description: string }[] = [
  { name: "❌ Lantern", description: "No answer in time" },
  { name: "❌ Beacon", description: "The key was refused" },
  { name: "🟢 Comet", description: "⚡ 24 ready, ⏳ 6 more\n✅ Done in 1.2 s" },
  {
    name: "🧹 Left out",
    description:
      "Twice: 31\n2160p: 4, 1080p: 12 👤 5000\nToo small: 3, under 1.5 GB\nDubbed in German: 2",
  },
];

export function aggregatorNotice(notice: (typeof NOTICES)[number], at: number): Stream {
  return { ...AGGREGATOR, ...notice, addonReturnIdx: at, externalUrl: NOTICE_PAGE };
}

/** A whole answer in one layout, with the notices at one of its ends. */
export function aggregatorAnswer(
  layout: Layout,
  results: readonly Result[] = RESULTS,
  notices: "top" | "bottom" | null = null,
): Stream[] {
  const sources = results.map((r) => (at: number) => aggregatorResult(layout, r, at));
  const others = NOTICES.map((n) => (at: number) => aggregatorNotice(n, at));
  const all =
    notices === "top"
      ? [...others, ...sources]
      : notices === "bottom"
        ? [...sources, ...others]
        : sources;
  return all.map((make, at) => make(at));
}
