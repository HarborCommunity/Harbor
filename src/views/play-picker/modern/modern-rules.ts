import { hasUncachedMarker } from "@/lib/streams/cached";
import { extractFilenameLine } from "@/lib/streams/parser/parser-filename";
import type { DebridSlug, HdrFormat, Resolution, ScoredStream } from "@/lib/streams/types";
import { anyStreamCached } from "../picker-utils";
import { FACET_DIMS } from "../stream-facets";

export type ModernSortKey = "name" | "resolution" | "seeders" | "size";
export type ModernSort = { key: ModernSortKey; dir: "asc" | "desc" };

const SORT_KEYS: readonly ModernSortKey[] = ["name", "resolution", "seeders", "size"];

const RESOLUTIONS: readonly Resolution[] = ["4K", "1080p", "720p", "480p", "SD"];

const NAME_ORDER = new Intl.Collator(undefined, { sensitivity: "accent", numeric: true });

/** Blanks, and the characters that nobody sees. */
const BLANKS = /[\s\p{DI}\u2800]+/gu;
const VISIBLE = /[^\s\p{DI}\u2800]/u;

const evenly = (text: string) => text.replace(BLANKS, " ").trim();

function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => VISIBLE.test(line));
}

/** An entry that only opens a web page has no file behind it, whatever its text says of one. */
export function opensPage(s: Pick<ScoredStream, "url" | "infoHash" | "externalUrl">): boolean {
  return !s.url && !s.infoHash && !!s.externalUrl;
}

/** A link that its add-on does not call uncached. */
function isReadyLink(s: ScoredStream): boolean {
  return !!s.url && !s.infoHash && !hasUncachedMarker(s);
}

/**
 * What this look calls cached, whoever says so: a debrid's library has it, Harbor's check of a
 * debrid or the add-on calls it cached, or it is a link that its add-on does not call uncached. A
 * row names the debrid and not who says so. A web page is never cached, whatever signs it has.
 */
export function startsAtOnce(s: ScoredStream): boolean {
  if (opensPage(s)) return false;
  return anyStreamCached(s) || Object.values(s.inLibrary).some(Boolean) || isReadyLink(s);
}

export type SourceTitle = {
  kind: "group" | "file" | "label";
  text: string;
};

export type SourceLine = {
  kind: "file" | "words";
  text: string;
};

type TitleSource = Pick<
  ScoredStream,
  | "releaseGroup"
  | "name"
  | "addonId"
  | "addonName"
  | "title"
  | "description"
  | "behaviorHints"
  | "infoHash"
  | "url"
  | "externalUrl"
>;

const VIDEO_ENDING =
  /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|mts|m2ts|wmv|asf|flv|f4v|mpg|mpeg|vob|iso|ogm|ogv|3gp|divx|rmvb)$/i;
const EPISODE_TAG = /^(?:s\d{1,3}(?:e\d{1,4})*|e(?:p|pisode)?\d{1,4}|\d{1,3}x\d{1,4})(?:v\d)?$/i;
/** What is left behind a name's last dash: WEB-DL, WEB-DL.H264, Blu-Ray, HDTV-720p, X-Men.2000. */
const TECHNICAL_WORD =
  /^(?:\d+|\d{3,4}[pi]|[48]k|[xh]26[45]|hevc|avc|av1|vp9|xvid|divx|(?:8|10|12)?bits?|e?ac3|aac\d*|ddp?\d*|dts|truehd|atmos|flac\d*|opus|mp3|audio|subs?|multi|dual|lat(?:ino)?|dl|rip|ray|hd|hq|web|webrip|bluray|bd|bdrip|brrip|dvd|dvdrip|hdrip|hdtv|hdts|hdcam|cam|ts|remux|hdr\d*|dv|sdr|complete|proper|repack)$/i;

/** Words of a text, and not parts of words. */
export const mark = (words: string) => new RegExp(`(?<![a-z\\d])(?:${words})(?![a-z\\d])`, "i");
const YEAR = mark("(?:19|20)\\d{2}");
const EPISODE = mark(
  "s\\d{1,3}(?:[ ._-]?e\\d{1,4})?|season[ ._-]?\\d{1,2}|\\d{1,2}x\\d{2,4}|第\\d{1,4}(?:[-~]\\d{1,4})?[話话集回]",
);
/** A title with " - 05 ", " - 01-12 " or "(01-12)" behind it that counts nothing else. */
const numbered = (inFront: string, digits: number) =>
  new RegExp(
    `^${inFront}[\\p{L}\\p{N}].*?(?:[\\s_]-[\\s_]\\d{${digits},4}(?:\\.5|v\\d)?(?![\\p{L}\\p{N}.])(?!\\s(?:[kmg]i?b|[km]bps|fps|bits?|min(?:ute)?s?|seed(?:er)?s?|peers?)\\b)|[([]\\d{${digits},4}[-~]\\d{${digits},4}[)\\]])`,
    "iu",
  );
/** With its group in brackets in front one digit is enough, without it there have to be two. */
const FANSUB_EPISODES = [numbered("(?:[[【][^\\]】]+[\\]】][\\s_]*)+", 1), numbered("", 2)];
const MADE_OF = [
  "\\d{3,4}[pi]|[48]k|uhd",
  "blu-?ray|bdrip|brrip|web-?dl|webrip|hdrip|hdtv|dvdrip|remux|hdcam|hdts",
  "[xh][. ]?26[45]|hevc|avc|av1|xvid",
].map(mark);

const SEPARATOR = /\s[|•·]\s/;

function firstFact(text: string): number {
  const facts = [EPISODE, ...MADE_OF].map((fact) => text.search(fact)).filter((at) => at >= 0);
  return facts.length > 0 ? Math.min(...facts) : -1;
}

/** Facts in a row stand behind signs or a separator, or have a label or nothing before them. */
function listsFacts(line: string): boolean {
  if (/\p{So}/u.test(line)) return true;
  const [head] = line.split(SEPARATOR);
  const at = firstFact(head);
  if (at < 0) return firstFact(line) >= 0;
  const title = head.slice(0, at).replace(YEAR, "");
  return !/[\p{L}\p{N}]/u.test(title) || /^\p{L}+:\s*$/u.test(title);
}

/**
 * The name of a release ends as a file, or says which film or episode it is and what it is made of.
 * One that is a single word or opens with its group in brackets need not say which, but more of the
 * rest.
 */
function namesRelease(line: string): boolean {
  if (VIDEO_ENDING.test(line)) return true;
  if (listsFacts(line)) return false;
  const [head] = line.split(SEPARATOR);
  const made = MADE_OF.filter((fact) => fact.test(head)).length;
  const saysWhich = [YEAR, EPISODE, ...FANSUB_EPISODES].some((which) => which.test(head));
  return saysWhich ? made > 0 : made > 1 && /^[[【]|^\S+$/.test(head);
}

function unmarked(line: string): string {
  return line.replace(/^[\p{So}\p{M}\p{Cf}\s]+/u, "").replace(/^name:\s+/i, "");
}

function bareName(line: string): string {
  const name = unmarked(line);
  const slash = name.lastIndexOf("/");
  return slash > 0 && namesRelease(name.slice(0, slash)) ? name.slice(slash + 1) : name;
}

/** Of an add-on's two texts the one that the Stremio look prints. */
function ownText(s: TitleSource): string | undefined {
  return firstLine(s.title) ? s.title : s.description;
}

/** Harbor's own debrid library keeps the file's name where add-ons have their label. */
function fileInLabel(s: Pick<ScoredStream, "addonId" | "name">): string | undefined {
  return /^(?:rd|tb|ad|pm|dl)-library$/.test(s.addonId) ? firstLine(s.name) : undefined;
}

function handedName(s: TitleSource): string | undefined {
  const { filename, fileName } = s.behaviorHints ?? {};
  return firstLine(filename) ?? firstLine(fileName) ?? fileInLabel(s);
}

/**
 * A torrent's first line is its name. An add-on that gathers others hands over a plain title where
 * it knows no file name; that is its words.
 */
export function sourceLine(s: TitleSource): SourceLine | null {
  const { title, description } = s;
  const handed = handedName(s);
  const line = firstLine(ownText(s));
  const words = handed ?? line;
  if (!words) return null;
  if (opensPage(s)) return { kind: "words", text: words };
  if (handed && (namesRelease(handed) || handed === fileInLabel(s))) {
    return { kind: "file", text: handed };
  }
  const own = line && !(handed && evenly(line) === evenly(handed)) ? line : "";
  const opensName = !!s.infoHash && /^[\p{L}\p{N}[(【]/u.test(own);
  if (opensName && firstLine(title)) return { kind: "file", text: own };
  const found = extractFilenameLine({ addonId: "", addonName: "", title, description });
  const written = [found, own].map(bareName).find(namesRelease);
  if (written) return { kind: "file", text: written };
  if (opensName && !listsFacts(own)) return { kind: "file", text: own };
  return { kind: "words", text: words };
}

const WEB_ADDRESS = /\.[a-z]{2,}$/i;
/** What an uploader's tag has in front of it, a dashed word: -GROUP[ */
const DASHED_WORD = /-[\s([{【]*[\p{L}\p{N}_]+[\s\])}】]*[[({【]$/u;

/** A bracket that opens the text does not count: the whole name can stand in it. */
function endsInBracket(text: string): boolean {
  const open: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if ("[({【".includes(text[at])) open.push(at);
    else if ("])}】".includes(text[at])) open.pop();
  }
  return open.some((at) => at > 0);
}

/**
 * A group stands right behind a bracket, or behind a dash and what its release says of itself.
 * Behind a dash in a later bracket stands a language: [POR-BR]
 */
function endsRelease(line: string, group: string): boolean {
  const before = line.slice(0, line.lastIndexOf(group));
  if (/[[({【]$/.test(before)) return !DASHED_WORD.test(before);
  if (/\s$/.test(before) || endsInBracket(before)) return false;
  return [YEAR, EPISODE, ...MADE_OF].some((fact) => fact.test(before));
}

/**
 * The parser takes what stands last in a text for the group, so it reads one where there is none. A
 * group has words of its own and a place of its own in the name of a release; a word that stands
 * only elsewhere, in the add-on's label or among its other words, is a word of those.
 */
function believableGroup(s: TitleSource): string | null {
  const group = s.releaseGroup?.trim().replace(VIDEO_ENDING, "");
  if (!group || WEB_ADDRESS.test(group)) return null;
  const words = group.split(/[.\s_]+/);
  if (words.some((word) => TECHNICAL_WORD.test(word) || EPISODE_TAG.test(word))) return null;
  const { filename, fileName } = s.behaviorHints ?? {};
  const inIt = (text: string | undefined): text is string => !!text?.includes(group);
  const handed = [filename, fileName, fileInLabel(s)].filter(inIt);
  if (handed.some((name) => namesRelease(name) && endsRelease(name, group))) return group;
  const lines = [s.title, s.description].flatMap((text) => text?.split("\n") ?? []).filter(inIt);
  const said = [...handed, ...lines];
  const names = said.map(unmarked).filter((line) => !listsFacts(line));
  if (names.some((name) => endsRelease(name, group))) return group;
  return [...said, s.name].some(inIt) ? null : group;
}

export function sourceTitle(s: TitleSource): SourceTitle {
  const group = believableGroup(s);
  if (group) return { kind: "group", text: group };
  const line = sourceLine(s);
  if (line?.kind === "file") return { kind: "file", text: line.text };
  return { kind: "label", text: firstLine(s.name) || s.addonName || "" };
}

export function sourceName(s: TitleSource): string {
  return sourceTitle(s).text;
}

/**
 * The rest of the add-on's label, and then all or the first of its other words, none twice. Of a
 * web page only the words.
 */
export function sourceWords(s: TitleSource, all = true): string[] {
  const said = new Set<string>();
  /** The same words behind two signs are two things: what is spoken, and what is written. */
  const isFresh = (text: string): boolean => {
    const line = evenly(text);
    const words = unmarked(line);
    if (!line || said.has(line) || said.has(words) || said.has(`\n${line}`)) return false;
    said.add(line).add(`\n${words}`);
    return true;
  };
  const fresh = (text: string | undefined) =>
    (text?.split("\n") ?? []).map((line) => line.trim()).filter(isFresh);
  isFresh(sourceName(s));
  const label = opensPage(s) ? [] : fresh(s.name);
  const words = [...fresh(handedName(s)), ...fresh(ownText(s))];
  return [...label, ...(all ? words : words.slice(0, 1))];
}

export function knownSeeders(s: ScoredStream): number | null {
  return !opensPage(s) && s.seeders != null && s.seeders >= 0 ? s.seeders : null;
}

export function knownSize(s: ScoredStream): number | null {
  return !opensPage(s) && s.size != null && s.size > 0 ? s.size : null;
}

/** DTS-HD is a sound, an HD-CAM or HDTV can be any resolution, and 1.4k is a count. */
const ABOVE_SD = mark(
  "(?:480|720|1080|1440|2160|4320)[pi]|(?<!\\d[.,])[48]k|[fqu]hd|(?<!(?:dts|true)[ .-])hd(?![ .-](?:ma|hra|audio|cam|ts|tc|tv|rip))",
);
const CALLED_SD = mark("sd|(?!480|720)\\d{3}[pi]");
/** What a label can say, in the values Harbor has; it has none for the last. */
const LABELLED: readonly (readonly [RegExp, Resolution | null])[] = [
  [mark("2160[pi]|(?<!\\d[.,])4k|u(?:ltra[ -]?)?hd"), "4K"],
  [mark("1080[pi]|f(?:ull[ -]?)?hd"), "1080p"],
  [mark("720[pi]"), "720p"],
  [mark("480[pi]"), "480p"],
  [CALLED_SD, "SD"],
  [mark("(?<!\\d[.,])[28]k|qhd|unknown"), null],
];
const NUMBERED = new RegExp(mark("\\d{3,4}[pi]"), "gi");

function textsOf(s: ScoredStream): string {
  const { filename, fileName } = s.behaviorHints ?? {};
  return [s.name, s.title, s.description, filename, fileName].join("\n");
}

/**
 * The parser answers "SD" when it read no resolution at all. Then the one that the add-on's label
 * says is it, outside of its own name and if no text says another number. Without one "SD" is no
 * answer with nothing else read either, which is where Harbor shows "No quality label"
 * (qualityConfidence), nor where the add-on names a higher one.
 */
export function knownResolution(s: ScoredStream): Resolution | null {
  if (opensPage(s) || !RESOLUTIONS.includes(s.resolution)) return null;
  if (s.resolution !== "SD") return s.resolution;
  const text = textsOf(s);
  const label = fileInLabel(s) ? "" : (s.name ?? "");
  const labels = [label, label.split(s.addonName || "\n").join("\n")];
  const said = LABELLED.filter(([words]) => labels.every((l) => words.test(l)));
  const numbers = text.match(NUMBERED) ?? [];
  if (said.length === 1 && numbers.every((number) => said[0][0].test(number))) return said[0][1];
  const nothingRead =
    s.source === "Other" && s.codec === "Other" && !s.hdrFormat && s.audio?.codec === "Other";
  return nothingRead || (ABOVE_SD.test(text) && !CALLED_SD.test(text)) ? null : "SD";
}

const ATMOS = mark("atmos");

/** Harbor's parser keeps one codec of a sound, and Atmos comes on top of these two. */
export function hasAtmos(s: ScoredStream): boolean {
  const { codec } = s.audio;
  const canHave = (codec === "DD+" || codec === "TrueHD") && !ATMOS.test(s.addonName);
  return codec === "Atmos" || (canHave && ATMOS.test(textsOf(s)));
}

function firstDirection(key: ModernSortKey): ModernSort["dir"] {
  return key === "name" ? "asc" : "desc";
}

export function nextModernSort(current: ModernSort | null, key: ModernSortKey): ModernSort | null {
  const first = firstDirection(key);
  if (current?.key !== key) return { key, dir: first };
  if (current.dir !== first) return null;
  return { key, dir: first === "asc" ? "desc" : "asc" };
}

function sortValue(s: ScoredStream, key: ModernSortKey): string | number | null {
  switch (key) {
    case "name":
      return sourceName(s) || null;
    case "resolution": {
      const resolution = knownResolution(s);
      return resolution === null ? null : RESOLUTIONS.length - RESOLUTIONS.indexOf(resolution);
    }
    case "seeders":
      return knownSeeders(s);
    case "size":
      return knownSize(s);
  }
}

function compareValues(a: string | number, b: string | number): number {
  return typeof a === "string" || typeof b === "string"
    ? NAME_ORDER.compare(String(a), String(b))
    : a - b;
}

/** Sources without the sorted value stay at the end in both directions. */
export function sortModern<T extends ScoredStream>(streams: T[], sort: ModernSort | null): T[] {
  if (!sort) return streams;
  const direction = sort.dir === "asc" ? 1 : -1;
  return streams
    .map((stream) => ({ stream, value: sortValue(stream, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        return a.value === b.value ? 0 : a.value === null ? 1 : -1;
      }
      return compareValues(a.value, b.value) * direction;
    })
    .map((entry) => entry.stream);
}

/** The stored sort is not checked when settings are loaded, so it is checked here. */
export function readModernSort(value: unknown): ModernSort | null {
  if (typeof value !== "object" || value === null) return null;
  const { key, dir } = value as Partial<Record<keyof ModernSort, unknown>>;
  const known = SORT_KEYS.find((candidate) => candidate === key);
  if (!known || (dir !== "asc" && dir !== "desc")) return null;
  return { key: known, dir };
}

export type ModernDimKey =
  | "release"
  | "dub"
  | "resolution"
  | "hdr"
  | "source"
  | "addon"
  | "codec"
  | "audio"
  | "availability";

export type ModernFilters = Partial<Record<ModernDimKey, string>>;

export type ModernContext = {
  isEpisode: boolean;
  /** "Cached only" is on and nothing in the list is cached, so none of it is shown. */
  noneCached: boolean;
  dubSub: (s: ScoredStream) => "sub" | "dub" | "dual" | null;
  addonOf: (s: ScoredStream) => { id: string; name: string };
};

export type ModernGroup = { key: ModernDimKey; options: { value: string; count: number }[] };

const DIM_KEYS: readonly ModernDimKey[] = [
  "release",
  "dub",
  "resolution",
  "hdr",
  "source",
  "addon",
  "codec",
  "audio",
  "availability",
];

const ALWAYS_BEHIND_MORE: ReadonlySet<ModernDimKey> = new Set(["codec", "audio", "availability"]);
const MAX_MAIN_GROUPS = 5;

const HDR_NAMES: Record<HdrFormat, readonly string[]> = {
  DV: ["Dolby Vision"],
  "DV+HDR10": ["Dolby Vision", "HDR10"],
  "HDR10+": ["HDR10+"],
  HDR10: ["HDR10"],
  HLG: ["HLG"],
};
const SDR: readonly string[] = ["SDR"];
const NOTHING: readonly string[] = [];

const FACETS = new Map(FACET_DIMS.map((dim) => [dim.key, dim]));

/** Harbor's own facets, so that this look does not decide them again. */
const FACET_KEYS: Partial<Record<ModernDimKey, string>> = {
  source: "source",
  codec: "codec",
  audio: "audio",
  availability: "cached",
};

const OPTION_ORDER: Partial<Record<ModernDimKey, readonly string[]>> = {
  release: ["single", "batch"],
  dub: ["sub", "dub", "dual"],
  resolution: RESOLUTIONS,
  hdr: ["Dolby Vision", "HDR10+", "HDR10", "HLG", "SDR"],
};

export function dimValues(
  s: ScoredStream,
  key: ModernDimKey,
  ctx: ModernContext,
): readonly string[] {
  if (key !== "addon" && opensPage(s)) return NOTHING;
  if (key === "hdr") return s.hdrFormat ? HDR_NAMES[s.hdrFormat] : SDR;
  const value = dimValue(s, key, ctx);
  if (value === null) return NOTHING;
  return key === "audio" && value !== "Atmos" && hasAtmos(s) ? [value, "Atmos"] : [value];
}

function dimValue(
  s: ScoredStream,
  key: Exclude<ModernDimKey, "hdr">,
  ctx: ModernContext,
): string | null {
  switch (key) {
    case "release":
      if (!ctx.isEpisode) return null;
      return s.seasonPack ? "batch" : "single";
    case "dub":
      return ctx.dubSub(s);
    case "resolution":
      return knownResolution(s);
    case "addon":
      return ctx.addonOf(s).id;
    case "availability":
      // Harbor's facet goes by debrids alone, and a row can say "Cached" without one.
      return startsAtOnce(s) ? "Cached" : facetValue(s, key);
    default:
      return facetValue(s, key);
  }
}

function facetValue(s: ScoredStream, key: ModernDimKey): string | null {
  return FACETS.get(FACET_KEYS[key] ?? "")?.valueOf(s) ?? null;
}

function matches(
  s: ScoredStream,
  key: ModernDimKey,
  filters: ModernFilters,
  ctx: ModernContext,
): boolean {
  const chosen = filters[key];
  return chosen === undefined || dimValues(s, key, ctx).includes(chosen);
}

function activeFilters(filters: ModernFilters, except?: ModernDimKey): ModernDimKey[] {
  return DIM_KEYS.filter((key) => key !== except && filters[key] !== undefined);
}

export function applyModernFilters<T extends ScoredStream>(
  streams: T[],
  filters: ModernFilters,
  ctx: ModernContext,
  except?: ModernDimKey,
): T[] {
  if (ctx.noneCached) return [];
  const active = activeFilters(filters, except);
  if (active.length === 0) return streams;
  return streams.filter((s) => active.every((key) => matches(s, key, filters, ctx)));
}

function orderOptions(
  key: ModernDimKey,
  values: string[],
  addonNames: ReadonlyMap<string, string>,
): string[] {
  if (key === "addon") {
    return values.sort((a, b) => {
      const an = addonNames.get(a);
      const bn = addonNames.get(b);
      if (an === undefined || bn === undefined) return an === bn ? 0 : an === undefined ? 1 : -1;
      return NAME_ORDER.compare(an, bn) || NAME_ORDER.compare(a, b);
    });
  }
  const order = OPTION_ORDER[key] ?? FACETS.get(FACET_KEYS[key] ?? "")?.order ?? [];
  const place = (value: string) => {
    const index = order.indexOf(value);
    return index < 0 ? order.length : index;
  };
  return values.sort((a, b) => place(a) - place(b));
}

/**
 * A choice is counted with the other groups as they are. A group whose filter is on stays, with the
 * chosen value, so that a filter can always be let go.
 */
export function modernGroups(
  streams: ScoredStream[],
  filters: ModernFilters,
  ctx: ModernContext,
): { main: ModernGroup[]; more: ModernGroup[] } {
  const active = activeFilters(filters);
  const tally = new Map<ModernDimKey, Map<string, number>>(
    DIM_KEYS.map((key) => [key, new Map<string, number>()]),
  );
  const addonNames = new Map<string, string>();

  for (const s of streams) {
    const mismatches = active.filter((key) => !matches(s, key, filters, ctx));
    for (const [key, counts] of tally) {
      const counted =
        !ctx.noneCached &&
        (mismatches.length === 0 || (mismatches.length === 1 && mismatches[0] === key));
      for (const value of dimValues(s, key, ctx)) {
        counts.set(value, (counts.get(value) ?? 0) + (counted ? 1 : 0));
      }
    }
    const addon = ctx.addonOf(s);
    addonNames.set(addon.id, addon.name);
  }

  const main: ModernGroup[] = [];
  const more: ModernGroup[] = [];
  for (const [key, counts] of tally) {
    const chosen = filters[key];
    if (chosen !== undefined && !counts.has(chosen)) counts.set(chosen, 0);
    if (counts.size < 2 && chosen === undefined) continue;
    const options = orderOptions(key, [...counts.keys()], addonNames).map((value) => ({
      value,
      count: counts.get(value) ?? 0,
    }));
    (ALWAYS_BEHIND_MORE.has(key) ? more : main).push({ key, options });
  }
  if (main.length > MAX_MAIN_GROUPS) {
    const source = main.findIndex((group) => group.key === "source");
    if (source >= 0) more.unshift(...main.splice(source, 1));
  }
  return { main, more };
}

export function pickModern<T extends ScoredStream>(a: {
  list: T[];
  preferred: T | null;
  ranked: T[];
  failed: ReadonlySet<T>;
}): T | null {
  const inList = new Set(a.list);
  const best = (fits: (s: T) => boolean): T | null => {
    const here = (s: T) => inList.has(s) && fits(s);
    return a.preferred && here(a.preferred) ? a.preferred : (a.ranked.find(here) ?? null);
  };
  const plays = (s: T) => !opensPage(s);
  return best((s) => plays(s) && !a.failed.has(s)) ?? best(plays) ?? best(() => true);
}

export type ModernReason =
  | { kind: "played-last" }
  | { kind: "library"; providers: string[] }
  | { kind: "cached"; providers: string[] }
  | { kind: "addon-cached" }
  | { kind: "not-cached"; provider: string | null }
  | { kind: "peers" }
  | { kind: "most-seeders"; resolution: string }
  | { kind: "exact-episode" }
  | { kind: "batch" }
  | { kind: "hdr"; formats: readonly string[] };

const MAX_REASONS = 3;

type ReasonDebrid = { slug: DebridSlug; name: string; queueCache?: unknown };

function availabilityReason(
  pick: ScoredStream,
  debrids: ReadonlyArray<ReasonDebrid>,
  addonCached: boolean,
  canStreamDirectly: boolean,
): ModernReason | null {
  const namesOf = (has: ScoredStream["cached"]) =>
    debrids.filter((d) => has[d.slug]).map((d) => d.name);
  const library = namesOf(pick.inLibrary);
  if (library.length > 0) return { kind: "library", providers: library };
  const cached = namesOf(pick.cached);
  if (cached.length > 0) return { kind: "cached", providers: cached };
  if (addonCached) return { kind: "addon-cached" };
  if (isReadyLink(pick)) return null;
  const fetcher = debrids.find((d) => d.queueCache);
  if (fetcher) return { kind: "not-cached", provider: fetcher.name };
  return canStreamDirectly ? { kind: "peers" } : { kind: "not-cached", provider: null };
}

function seedersReason(pick: ScoredStream, list: ScoredStream[]): ModernReason | null {
  const resolution = knownResolution(pick);
  const lead = pick.seeders ?? 0;
  if (resolution === null || lead <= 0) return null;
  const rivals = list.filter((s) => s !== pick && knownResolution(s) === resolution);
  if (rivals.length === 0 || rivals.some((s) => (s.seeders ?? 0) > lead)) return null;
  return { kind: "most-seeders", resolution };
}

export type WantedEpisode = {
  season: number | null;
  episode: number;
  absolute: number | null;
  /** An anime is a season by itself, whatever a file calls it. */
  anySeason: boolean;
};

function episodeReason(pick: ScoredStream, wanted: WantedEpisode): ModernReason | null {
  if (pick.seasonPack) return { kind: "batch" };
  const { season, episode, episodeEnd } = pick;
  if (episode == null || (episodeEnd != null && episodeEnd > episode)) return null;
  const sameSeason =
    wanted.anySeason || season == null || wanted.season == null || season === wanted.season;
  const exact = episode === wanted.absolute || (episode === wanted.episode && sameSeason);
  return exact ? { kind: "exact-episode" } : null;
}

function hdrReason(pick: ScoredStream): ModernReason | null {
  return pick.hdrFormat ? { kind: "hdr", formats: HDR_NAMES[pick.hdrFormat] } : null;
}

/** From facts of the source and never from the ranking's codes. */
export function pickReasons(a: {
  pick: ScoredStream;
  list: ScoredStream[];
  episode: WantedEpisode | null;
  playedLast: boolean;
  debrids: ReadonlyArray<ReasonDebrid>;
  addonCached: boolean;
  canStreamDirectly: boolean;
}): ModernReason[] {
  const last: ModernReason[] = a.playedLast ? [{ kind: "played-last" }] : [];
  if (opensPage(a.pick)) return last;
  const reasons: (ModernReason | null)[] = [
    ...last,
    availabilityReason(a.pick, a.debrids, a.addonCached, a.canStreamDirectly),
    seedersReason(a.pick, a.list),
    a.episode ? episodeReason(a.pick, a.episode) : hdrReason(a.pick),
  ];
  return reasons.filter((reason): reason is ModernReason => reason !== null).slice(0, MAX_REASONS);
}

/** A row takes its source's newest object; one the page dropped stays, so that it still plays. */
export function holdRows<T>(
  shown: T[],
  incoming: T[],
  holding: boolean,
  idOf: (row: T) => string,
): { rows: T[]; changed: boolean } {
  if (!holding) return { rows: incoming, changed: false };
  const shownIds = shown.map(idOf);
  const incomingIds = incoming.map(idOf);
  const drawn = new Set(shown);
  const still = new Set(incoming);
  const fresh = new Map<string, T[]>();
  incoming.forEach((row, i) => {
    if (drawn.has(row)) return;
    const same = fresh.get(incomingIds[i]);
    if (same) same.push(row);
    else fresh.set(incomingIds[i], [row]);
  });
  return {
    rows: shown.map((row, i) => (still.has(row) ? row : (fresh.get(shownIds[i])?.shift() ?? row))),
    changed:
      incomingIds.length !== shownIds.length || incomingIds.some((id, i) => id !== shownIds[i]),
  };
}
