import { releaseYear } from "@/lib/release-info";
import { metaIsAnime } from "@/lib/player/anime-src";
import type { TrackInfo } from "@/lib/player/bridge";
import type { PlayerSrc } from "@/lib/view";
import { langScore } from "./language";
import type { LocalSubtitleMedia } from "./local-subtitle-matching";

const ANIME_PART_SUFFIX = /[\s._:–—-]+\(?(?:part|cour)[\s._-]+\d{1,3}\)?\s*$/i;

export function matchesLocalPath(track: TrackInfo | null, path: string): boolean {
  return track?.external === true && (track.originalUrl === path || track.url === path);
}

export function localSubtitleMedia(src: PlayerSrc): LocalSubtitleMedia | null {
  if (src.isLive || !src.meta.name?.trim()) return null;
  const { meta, episode } = src;
  const title = meta.name;
  const alternateTitles = meta.alternateTitles;
  const releaseFilename = src.streamRef?.resolvedFilename ?? undefined;
  if (episode) {
    const anime = src.isAnime || meta.type === "anime" || metaIsAnime(meta);
    const { imdbSeason, imdbEpisode } = episode;
    const mapped =
      imdbSeason != null &&
      Number.isInteger(imdbSeason) &&
      imdbSeason >= 0 &&
      imdbEpisode != null &&
      Number.isInteger(imdbEpisode) &&
      imdbEpisode > 0;
    const partAliases =
      anime && mapped
        ? [title, ...(alternateTitles ?? [])].flatMap((name) => {
            const suffix = ANIME_PART_SUFFIX.exec(name);
            return suffix && suffix.index > 0 ? [name.slice(0, suffix.index)] : [];
          })
        : [];
    return {
      mediaType: anime ? "anime" : "series",
      title,
      releaseFilename,
      alternateTitles: partAliases.length
        ? [...(alternateTitles ?? []), ...partAliases]
        : alternateTitles,
      season: mapped ? imdbSeason : episode.season,
      episode: mapped ? imdbEpisode : episode.episode,
      absoluteNumber: episode.absoluteNumber,
    };
  }
  if (meta.type !== "movie" && !/^movie$/i.test(meta.animeFormat ?? "")) return null;

  const year = [
    releaseYear(meta.releaseDate),
    releaseYear(meta.releaseInfo),
    meta.listingYear,
  ].find((value) => value != null && Number.isInteger(value) && value >= 1800 && value <= 2099);
  return { mediaType: "movie", title, alternateTitles, year, releaseFilename };
}

export function localSubtitleTakesPrecedence(
  language: string | undefined,
  other: { lang?: string; external?: boolean } | null,
  preferredLanguages: string[],
  preferEmbedded: boolean,
): boolean {
  if (!other) return true;
  const localScore = langScore(language ?? "", preferredLanguages);
  const otherScore = langScore(other.lang ?? "", preferredLanguages);
  return (
    localScore > otherScore ||
    (localScore === otherScore && (!preferEmbedded || other.external === true))
  );
}
