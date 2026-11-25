import { ChevronDown, ChevronLeft, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { parseKitsuId } from "@/lib/providers/kitsu";
import { splitFranchiseDisplaySeason } from "@/lib/streams/anime-identity-core";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import type { PlayEpisode } from "@/lib/view";

export function PickerNav({
  onBack,
  onRefresh,
  refreshing = false,
}: {
  onBack: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const groupLeft = settings.pickerRefreshNextToBack;
  return (
    <div className="mt-6">
      <div className={`flex items-center gap-3 ${groupLeft ? "justify-start" : "justify-between"}`}>
        <button
          type="button"
          onClick={onBack}
          className="group/back -ms-2 flex w-fit items-center gap-3 rounded-full py-1.5 pe-6 ps-1.5 text-[17px] font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-elevated/70 ring-1 ring-edge-soft transition-colors group-hover/back:bg-elevated">
            <ChevronLeft size={26} strokeWidth={2.4} className="dir-icon" />
          </span>
          Back
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={t("Refresh sources")}
            className="group/refresh flex w-fit shrink-0 items-center gap-3 rounded-full py-1.5 pe-6 ps-1.5 text-[17px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-elevated/70 ring-1 ring-edge-soft transition-colors group-hover/refresh:bg-elevated">
              <RefreshCw size={20} strokeWidth={2.4} className={refreshing ? "animate-spin" : ""} />
            </span>
            {t("Refresh")}
          </button>
        )}
      </div>
    </div>
  );
}

export function pickerEpisode(meta: Meta, episode: PlayEpisode, absoluteEpisode?: number | null) {
  const partSeason = splitFranchiseDisplaySeason(
    parseKitsuId(episode.kitsuStreamId ?? "") ?? parseKitsuId(meta.id),
  );
  const twoDigits = (n: number) => String(n).padStart(2, "0");
  const place =
    absoluteEpisode != null
      ? { season: null, episode: String(absoluteEpisode) }
      : partSeason != null
        ? { season: partSeason, episode: twoDigits(episode.episode) }
        : {
            season: episode.imdbSeason ?? episode.season,
            episode: twoDigits(episode.imdbEpisode ?? episode.episode),
          };
  return {
    ...place,
    name: episode.name || metaEpisodeName(meta, episode),
    number: absoluteEpisode ?? episode.episode,
  };
}

export function pickerFilmLine(meta: Meta): string | null {
  if (!meta.releaseInfo) return null;
  const genres = meta.genres?.length ? ` · ${meta.genres.slice(0, 2).join(" · ")}` : "";
  return `${meta.releaseInfo}${genres}`;
}

export function PickerHeader({
  meta,
  episode,
  absoluteEpisode,
}: {
  meta: Meta;
  episode?: PlayEpisode;
  absoluteEpisode?: number | null;
}) {
  const named = episode ? pickerEpisode(meta, episode, absoluteEpisode) : null;
  const filmLine = pickerFilmLine(meta);
  return (
    <header className="flex flex-col gap-3">
      {episode && named ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink-subtle">
            {named.season != null
              ? `${meta.name} · Season ${named.season} · Episode ${named.episode}`
              : `${meta.name} · Episode ${named.episode}`}
          </p>
          <h1 className="font-display text-[64px] font-medium leading-[0.96] tracking-tight text-ink">
            {named.name || `Episode ${named.number}`}
          </h1>
          {episode.overview && <CollapsibleOverview text={episode.overview} />}
        </>
      ) : (
        <>
          {filmLine && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink-subtle">
              {filmLine}
            </p>
          )}
          <h1 className="font-display text-[68px] font-medium leading-[0.96] tracking-tight text-ink">
            {meta.name}
          </h1>
        </>
      )}
    </header>
  );
}

export function CollapsibleOverview({
  text,
  ownDirection = false,
}: {
  text: string;
  /** Set and cut in the text's own direction, on the side of the page's. */
  ownDirection?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => setTruncated(el.scrollHeight - el.clientHeight > 2);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text, expanded]);
  return (
    <div className="mt-2 max-w-2xl">
      <p
        ref={ref}
        dir={ownDirection ? "auto" : undefined}
        className={`text-[14.5px] leading-relaxed text-ink-muted ${expanded ? "" : "line-clamp-2"}${
          ownDirection ? " [text-align:-webkit-match-parent]" : ""
        }`}
      >
        {text}
      </p>
      {(truncated || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-subtle transition-colors hover:text-ink"
        >
          {expanded ? t("Show less") : t("View more")}
          <ChevronDown
            size={14}
            strokeWidth={2.4}
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

function metaEpisodeName(meta: Meta, episode: PlayEpisode): string | undefined {
  const match = meta.videos?.find(
    (v) => (v.season ?? 1) === episode.season && (v.episode ?? v.number) === episode.episode,
  );
  return match?.name || match?.title || undefined;
}
