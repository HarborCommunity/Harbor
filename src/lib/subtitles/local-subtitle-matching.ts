import { isKnownLanguage, langScore, normalizeLang } from "./language";
import { isPlayableVideoPath, stripPlayableVideoExtension } from "@/lib/media-file";

export type LocalSubtitleMedia = {
  title: string;
  alternateTitles?: readonly string[];
  releaseFilename?: string;
  year?: number;
  season?: number;
  episode?: number;
  absoluteNumber?: number;
  mediaType?: "movie" | "series" | "anime";
};

type LocalSubtitleMatch = { path: string; language?: string; forced?: true };
type TitleMatch = { suffix: string; year?: number };
type FolderEvidence = {
  name: string;
  title?: TitleMatch;
  season?: number;
  language?: string;
  subtitlePack?: boolean;
};
type SubtitleEvidence = { suffix: string; confidence: number };

const SUBTITLE_EXT = /\.(?:ass|srt|ssa|vtt|sub)$/i;
const RELEASE_GROUPS = /^(?:(?:\[[^\]]+\]|【[^】]+】)\s*)+/;
const MOVIE_LABEL = /(?<=[\p{L}\p{N}])[ ._-]+movie[ ._]*[-:][ ._-]*(?=\p{L})/u;
const SEPARATORS = /^[^\p{L}\p{N}\p{M}]+/u;
const YEAR = /^((?:18|19|20)\d{2})(?![\p{L}\p{N}])/u;
const SEASON_FOLDER =
  /^(?:s(?:eason)?[ ._-]*(\d{1,3})|specials?|ovas?|oads?|extras)(?:[ ._-]+\((?:18|19|20)\d{2}\))?$/;
const SEASON_EPISODE =
  /^(?:s(?:eason)?[ ._-]*(\d{1,3})(?:[ ._-]*e(?:p(?:isode)?)?[ ._-]*|[ ._-]+)(\d{1,4})|(\d{1,3})x(\d{1,4}))(?:v\d+)?(?=$|[^\p{L}\p{N}])/u;
const ORDINAL_SEASON = /^(\d{1,3})(?:st|nd|rd|th)[ ._-]+season(?=$|[^\p{L}\p{N}])/u;
const SEASON_SUFFIX =
  /[ ._-]+(?:s(?:eason)?[ ._-]*(\d{1,3})|(\d{1,3})(?:st|nd|rd|th)[ ._-]+season)(?:[ ._-]+\(?(?:18|19|20)\d{2}\)?)?$/u;
const SUBSOURCE_PACK = /^(.+)_([^_]+)_\d+-\[subsource\]$/u;
const PACK_EPISODE_MARKER =
  /(?<![\p{L}\p{N}])(?:s(?:eason)?[ ._-]*\d{1,3}|\d{1,3}(?:(?:st|nd|rd|th)[ ._-]+season|x\d))/gu;
const ANIME_DASH_EPISODE = /[ ._]+-[ ._]+(?=\d)/u;
const PACK_OTHER_EDITION =
  /\b(?:movie|recap|director['’]?s?[ ._-]+cut|re[ ._-]?edit|henshu{1,2}[ ._-]+ban)\b/u;
const SPECIAL_EPISODE = /^(?:special|sp|ova|oad)[ ._-]*(\d{1,3})(?:v\d+)?(?=$|[^\p{L}\p{N}])/u;
const SPECIAL_TAG = /(?<![\p{L}\p{N}])(?:specials?|sp|ova|oad)(?![\p{L}\p{N}])/u;
const SEASON_TAG = /(?<![\p{L}\p{N}])s(?:eason)?[ ._-]*(\d{1,3})(?![\p{L}\p{N}])/gu;
const EPISODE =
  /^(?:(?:e(?:p(?:isode)?)?[ ._-]*)?(\d{1,4})(?:v\d+)?|第[ ._-]*(\d{1,4})[ ._-]*[話话集])(?=$|[^\p{L}\p{N}])/u;
const MULTI_EPISODE = /^(?:[ ._]*-[ ._-]*e?\d{1,4}|[ ._-]*e\d{1,4})(?![\p{L}\p{N}])/u;
const RELEASE_SUFFIX =
  /^(?:\d{3,4}[pi]|4k|uhd|blu[ ._-]?ray|bd|[bd]r[ ._-]?rip|bd[ ._-]?rip|remux|web(?:[ ._-]?(?:dl|rip))?|hdtv|dvd(?:[ ._-]?rip)?|proper|repack|[hx][ ._-]?26[45]|hevc|av1|hdr(?:10)?)(?=$|[^\p{L}\p{N}])/u;
const SUBTITLE_FLAGS = /^(?:forced|signs|sdh|cc)$/;
const GENERIC_SUBTITLE = /^(?:subtitles?|subs?)(?=$|[^\p{L}\p{N}])/u;
const FORCED_TAG = /(?<![\p{L}\p{N}])forced(?![\p{L}\p{N}])/gu;

function foldName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/([\p{Script=Arabic}\p{Script=Latin}])\p{M}+/gu, "$1")
    .replace(/[\p{Cf}\u0640]/gu, "")
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 15))
    .normalize("NFC")
    .trim();
}

function titlePatterns(media: LocalSubtitleMedia): RegExp[] {
  const titles = new Set<string>();
  for (const title of [media.title, ...(media.alternateTitles ?? [])]) {
    const folded = foldName(title.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"));
    titles.add(folded);
    if (folded.includes("&")) titles.add(folded.replace(/&/g, " and "));
    if (media.mediaType !== "movie" && media.episode != null) {
      titles.add(folded.replace(SEASON_SUFFIX, ""));
    }
  }
  // Leave season markers available when parsing episode names.
  const ordered = [...titles].sort((a, b) => {
    const aSeason = Number(SEASON_SUFFIX.test(a));
    const bSeason = Number(SEASON_SUFFIX.test(b));
    return aSeason - bSeason || b.length - a.length;
  });
  return ordered.flatMap((title) => {
    const tokens = title.match(/[\p{L}\p{N}\p{M}]+/gu);
    if (!tokens) return [];
    const pattern = tokens
      .map((token, i) =>
        media.mediaType === "anime" && i > 0 && i < tokens.length - 1 && /^(?:o|wo)$/.test(token)
          ? "(?:o|wo)"
          : token,
      )
      .join("[^\\p{L}\\p{N}\\p{M}]*");
    return [new RegExp(`^${pattern}(?=$|[^\\p{L}\\p{N}\\p{M}]|第 *\\d+[話话集])`, "u")];
  });
}

function matchTitle(name: string, patterns: readonly RegExp[]): TitleMatch | undefined {
  // A release-group tag can prefix the title. Try the original first for
  // titles whose own spelling starts with a bracket.
  const untagged = name.replace(RELEASE_GROUPS, "");
  for (const candidate of [name, untagged]) {
    const body = candidate.replace(SEPARATORS, "");
    for (const pattern of patterns) {
      const match = pattern.exec(body);
      if (!match) continue;
      const suffix = body.slice(match[0].length);
      const year = YEAR.exec(suffix.replace(SEPARATORS, ""))?.[1];
      return { suffix, ...(year ? { year: Number(year) } : {}) };
    }
    if (untagged === name) break;
  }
}

function languageTag(value: string): string | undefined {
  // Only a real region/script suffix should be handed to normalizeLang, which
  // also accepts arbitrary hyphenated text after a language code.
  if (/[-_]/.test(value) && !/^[a-z]{2,3}[-_](?:[a-z]{2}|[a-z]{4}|\d{3})$/.test(value)) {
    return undefined;
  }
  return isKnownLanguage(value) ? normalizeLang(value) : undefined;
}

function suffixLanguage(value: string): string | undefined {
  const words = value.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  while (SUBTITLE_FLAGS.test(words.at(-1) ?? "")) words.pop();
  if (words.at(-1) === "hi" && languageTag(words.at(-2) ?? "")) words.pop();
  for (let length = Math.min(4, words.length); length > 0; length--) {
    const tail = words.slice(-length);
    const hyphenated = tail.join("-");
    const tag =
      languageTag(tail.join(" ")) ??
      (value.includes(hyphenated) || value.includes(tail.join("_"))
        ? languageTag(hyphenated)
        : undefined);
    if (tag) return tag;
  }
}

function seasonNumber(value: string): number | undefined {
  const match = SEASON_FOLDER.exec(value);
  return match ? Number(match[1] ?? 0) : undefined;
}

function withoutYear(name: string): string {
  return name.replace(SEPARATORS, "").replace(YEAR, "").replace(SEPARATORS, "");
}

function episodeMatch(value: string) {
  const ordinal = ORDINAL_SEASON.exec(value);
  const name = ordinal ? value.slice(ordinal[0].length).replace(SEPARATORS, "") : value;
  const explicit = SEASON_EPISODE.exec(name);
  const special = SPECIAL_EPISODE.exec(name);
  const episode = explicit ?? special ?? EPISODE.exec(name);
  if (!episode || (ordinal && (explicit || special))) return;
  let season = ordinal
    ? Number(ordinal[1])
    : explicit
      ? Number(explicit[1] ?? explicit[3])
      : special
        ? 0
        : undefined;
  let number = Number(explicit ? (explicit[2] ?? explicit[4]) : (episode[1] ?? episode[2]));
  let suffix = name.slice(episode[0].length);
  const bracket = /^[ ._-]*\[([^\]]+)\]/u.exec(suffix);
  const relative = bracket && SEASON_EPISODE.exec(bracket[1]);
  if (bracket && relative?.[0] === bracket[1]) {
    if (season != null || !/^\d{1,4}(?:v\d+)?$/u.test(episode[0])) return;
    season = Number(relative[1] ?? relative[3]);
    number = Number(relative[2] ?? relative[4]);
    suffix = suffix.slice(bracket[0].length);
  }
  if (MULTI_EPISODE.test(suffix) || SEASON_EPISODE.test(suffix.replace(SEPARATORS, ""))) return;
  if (/^\.\d(?=$|[^\p{L}\p{N}])/u.test(suffix)) return;
  return { season, episode: number, suffix };
}

function packEpisode(name: string, allowBareNumber: boolean): ReturnType<typeof episodeMatch> {
  const trimmed = name.replace(RELEASE_GROUPS, "");
  const markers = [...trimmed.matchAll(PACK_EPISODE_MARKER)];
  if (markers.length === 1) {
    const episode = episodeMatch(trimmed.slice(markers[0].index));
    if (episode?.season != null) return episode;
  }
  if (!allowBareNumber || markers.length > 0) return;
  const dash = ANIME_DASH_EPISODE.exec(trimmed);
  if (!dash) return;
  const title = trimmed.slice(0, dash.index);
  if (!/\p{L}/u.test(title) || SPECIAL_TAG.test(title) || PACK_OTHER_EDITION.test(title)) return;
  return episodeMatch(trimmed.slice(dash.index + dash[0].length));
}

function releaseTitle(media: LocalSubtitleMedia, movie: boolean): string | undefined {
  const filename = media.releaseFilename?.split(/[\\/]/).pop();
  if (!filename || filename.length > 512 || !isPlayableVideoPath(filename)) return;
  const stem = foldName(stripPlayableVideoExtension(filename)).replace(RELEASE_GROUPS, "");
  const episodeMarkers = [...stem.matchAll(/[ ._-]+(?=(?:s(?:eason)?[ ._-]*\d+|\d+x\d+))/gu)];
  const episode = episodeMarkers
    .map((marker) => ({
      index: marker.index,
      match: episodeMatch(stem.slice(marker.index + marker[0].length)),
    }))
    .find(({ match }) => match?.season != null);

  let title: string | undefined;
  if (movie) {
    if (episode || media.year == null) return;
    const years = [...stem.matchAll(/[ ._(-]+((?:18|19|20)\d{2})(?=$|[^\p{L}\p{N}])/gu)];
    const year = years.at(-1);
    if (year && Number(year[1]) === media.year) title = stem.slice(0, year.index);
  } else if (episode) {
    if (episode.match?.season === (media.season ?? 1) && episode.match?.episode === media.episode) {
      title = stem.slice(0, episode.index);
    }
  } else if (media.mediaType === "anime") {
    const dash = ANIME_DASH_EPISODE.exec(stem);
    const relative = dash && episodeMatch(stem.slice(dash.index + dash[0].length));
    if (
      dash &&
      relative &&
      relative.season == null &&
      (((media.season ?? 1) === 1 && relative.episode === media.episode) ||
        relative.episode === media.absoluteNumber)
    )
      title = stem.slice(0, dash.index);
  }
  if (
    !title ||
    (title.match(/\p{L}/gu)?.length ?? 0) < 3 ||
    /^(?:episode|movie|video|film|file|sample|title|track|part|chapter|season|unknown|main|stream|untitled)$/u.test(
      title,
    )
  )
    return;
  return title;
}

function subtitlePack(name: string, titles: readonly RegExp[]) {
  const pack = SUBSOURCE_PACK.exec(name);
  if (!pack) return;
  const season = SEASON_SUFFIX.exec(pack[1]);
  if (!season) return;
  const show = matchTitle(pack[1].slice(0, season.index), titles);
  if (!show || show.suffix.replace(SEPARATORS, "")) return;
  return { season: Number(season[1] ?? season[2]), language: languageTag(pack[2]) };
}

function movieSuffix(suffix: string): boolean {
  const value = withoutYear(suffix);
  return RELEASE_SUFFIX.test(value) || subtitleTagsOnly(value);
}

function subtitleTagsOnly(value: string): boolean {
  const words = value
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((word) => word && !SUBTITLE_FLAGS.test(word));
  if (words.at(-1) === "hi" && languageTag(words.at(-2) ?? "")) words.pop();
  if (words.length === 0) return true;
  const joined = words.join("-");
  return !!(
    languageTag(words.join(" ")) ??
    (value.includes(joined) || value.includes(words.join("_")) ? languageTag(joined) : undefined)
  );
}

function hasForcedTag(suffix: string): boolean {
  for (const tag of suffix.matchAll(FORCED_TAG)) {
    if (subtitleTagsOnly(suffix.slice(tag.index + tag[0].length))) return true;
  }
  return false;
}

function isSubtitleFolder(folder: FolderEvidence): boolean {
  return (
    folder.season != null || GENERIC_SUBTITLE.test(folder.name) || subtitleTagsOnly(folder.name)
  );
}

function hasTitleFolder(
  folders: readonly FolderEvidence[],
  isMatch: (folder: FolderEvidence) => boolean,
): boolean {
  for (const folder of folders) {
    if (isMatch(folder)) return true;
    if (!isSubtitleFolder(folder)) return false;
  }
  return false;
}

function matchMovie(
  media: LocalSubtitleMedia,
  name: string,
  title: TitleMatch | undefined,
  folders: readonly FolderEvidence[],
): SubtitleEvidence | undefined {
  const movieFolder = (folder: FolderEvidence) =>
    !!folder.title && movieSuffix(folder.title.suffix);
  if (title) {
    if (!movieSuffix(title.suffix)) return;
  } else if (
    !hasTitleFolder(folders, movieFolder) ||
    !subtitleTagsOnly(name.replace(GENERIC_SUBTITLE, ""))
  ) {
    return;
  }
  const years = [title?.year, ...folders.filter(movieFolder).map((folder) => folder.title?.year)];
  if (media.year != null && years.some((year) => year != null && year !== media.year)) return;
  return {
    suffix: title?.suffix ?? name,
    confidence: (title ? 1 : 0) + (media.year != null && years.includes(media.year) ? 2 : 0),
  };
}

function matchEpisode(
  media: LocalSubtitleMedia,
  name: string,
  title: TitleMatch | undefined,
  folders: readonly FolderEvidence[],
): SubtitleEvidence | undefined {
  const nameToParse = (title?.suffix ?? name).replace(SEPARATORS, "");
  const noYear = withoutYear(nameToParse);
  // A bare four-digit number can itself be an absolute episode. Only strip
  // a year when it precedes a labeled episode.
  const labeledEpisode =
    SEASON_EPISODE.test(noYear) || (/^[e第]/u.test(noYear) && EPISODE.test(noYear));
  const direct = episodeMatch(labeledEpisode ? noYear : nameToParse);
  const pack = folders.find((folder) => folder.subtitlePack);
  const targetSeason = media.season ?? 1;
  const anime = media.mediaType === "anime";
  const episode =
    direct ??
    (!title && pack
      ? packEpisode(name, anime && targetSeason === 1 && (pack.season === 0 || pack.season === 1))
      : undefined);
  if (!episode) return;
  if (
    !title &&
    !pack &&
    !hasTitleFolder(
      folders,
      (folder) => !!folder.title && (folder.season != null || movieSuffix(folder.title.suffix)),
    )
  )
    return;

  const seasons = [
    episode.season,
    SPECIAL_TAG.test(episode.suffix) ? 0 : undefined,
    ...Array.from(episode.suffix.matchAll(SEASON_TAG), (match) => Number(match[1])),
    // SubSource sometimes assigns season 0 to regular anime packs. Explicit
    // S00 or specials markers in the file or a local folder still count.
    ...folders.map((folder) =>
      anime && folder.subtitlePack && folder.season === 0 ? undefined : folder.season,
    ),
  ].filter((season) => season != null);
  if (seasons.some((season) => season !== targetSeason)) return;
  const regularMatch =
    episode.episode === media.episode && (seasons.length > 0 || targetSeason === 1);
  const absoluteMatch =
    media.mediaType !== "series" &&
    targetSeason > 0 &&
    !(anime && pack?.season === 0) &&
    seasons.length === 0 &&
    episode.episode === media.absoluteNumber &&
    media.absoluteNumber !== media.episode;
  if (!regularMatch && !absoluteMatch) return;

  return {
    suffix: episode.suffix,
    confidence: (title ? 1 : 0) + (seasons.length > 0 ? 2 : 0),
  };
}

export function findMatchingSubtitles(
  files: readonly string[],
  media: LocalSubtitleMedia,
  preferredLanguages: readonly string[] = [],
  rootFolder?: string,
  options?: { includeOtherLanguages?: boolean },
): LocalSubtitleMatch[] {
  const movie = media.mediaType === "movie" || (media.mediaType == null && media.episode == null);
  if (!movie && media.episode == null) return [];
  const primary = matchSubtitles(files, media, preferredLanguages, rootFolder, options, movie);
  if (primary.length) return primary;
  const title = releaseTitle(media, movie);
  return title
    ? matchSubtitles(
        files,
        { ...media, title, alternateTitles: [media.title, ...(media.alternateTitles ?? [])] },
        preferredLanguages,
        rootFolder,
        options,
        movie,
      )
    : [];
}

function matchSubtitles(
  files: readonly string[],
  media: LocalSubtitleMedia,
  preferredLanguages: readonly string[],
  rootFolder: string | undefined,
  options: { includeOtherLanguages?: boolean } | undefined,
  movie: boolean,
): LocalSubtitleMatch[] {
  const titles = titlePatterns(media);
  if (!titles.length) return [];
  const preferred = preferredLanguages.filter((language) => normalizeLang(language));
  const rootParts = rootFolder?.split(/[\\/]/).filter(Boolean);
  const folderEvidence = new Map<string, FolderEvidence>();
  const candidates: { match: LocalSubtitleMatch; languageRank: number; confidence: number }[] = [];

  for (const path of new Set(files)) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    const filename = parts.pop();
    if (!filename || !SUBTITLE_EXT.test(filename)) continue;
    const name = foldName(filename.replace(SUBTITLE_EXT, ""));
    const fileTitle =
      matchTitle(name, titles) ??
      (movie
        ? matchTitle(name.replace(MOVIE_LABEL, " ").replace(/&/g, " and "), titles)
        : undefined);
    const folders = parts
      .slice(rootParts ? Math.max(0, rootParts.length - 1) : 0)
      .reverse()
      .map((part) => {
        const cached = folderEvidence.get(part);
        if (cached) return cached;
        const name = foldName(part);
        const title = matchTitle(name, titles);
        const pack = subtitlePack(name, titles);
        const season =
          pack?.season ?? seasonNumber(name) ?? seasonNumber(withoutYear(title?.suffix ?? ""));
        const language = pack?.language ?? (title ? undefined : languageTag(name));
        const folder = { name, title, season, language, subtitlePack: pack != null };
        folderEvidence.set(part, folder);
        return folder;
      });
    const evidence = movie
      ? matchMovie(media, name, fileTitle, folders)
      : matchEpisode(media, name, fileTitle, folders);
    if (!evidence) continue;
    const language =
      suffixLanguage(evidence.suffix) ?? folders.find((folder) => folder.language)?.language;
    const preference = language ? langScore(language, preferred) : 0;
    if (preference < 0 && !options?.includeOtherLanguages) continue;
    const match: LocalSubtitleMatch = {
      path,
      ...(language ? { language } : {}),
      ...(hasForcedTag(evidence.suffix) ? { forced: true } : {}),
    };
    candidates.push({ match, languageRank: preference, confidence: evidence.confidence });
  }

  return candidates
    .sort(
      (a, b) =>
        b.languageRank - a.languageRank ||
        b.confidence - a.confidence ||
        (a.match.path < b.match.path ? -1 : a.match.path > b.match.path ? 1 : 0),
    )
    .map(({ match }) => match);
}
