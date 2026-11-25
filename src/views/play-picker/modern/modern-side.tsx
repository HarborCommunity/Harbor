import { Fragment, useCallback, useMemo } from "react";
import { bidiIsolate } from "@/lib/bidi";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import type { ScoredStream } from "@/lib/streams/types";
import { tmdbBackdropAtSize } from "@/lib/tmdb-backdrop-size";
import type { PlayEpisode } from "@/lib/view";
import { runtimeMs } from "@/lib/voyage/progress";
import { CollapsibleOverview, pickerEpisode, pickerFilmLine } from "../picker-header";
import { useModernContext } from "./modern-context";
import { ModernFilters } from "./modern-filters";
import { applyModernFilters, opensPage } from "./modern-rules";
import { useModernState } from "./modern-state";

export function ModernSide({
  meta,
  episode,
  absoluteEpisode,
  streams,
  isCached,
  isAnime,
  pipelineDone,
  cachedOnly,
  onCachedOnly,
}: {
  meta: Meta;
  episode?: PlayEpisode;
  absoluteEpisode?: number | null;
  streams: ScoredStream[];
  isCached: (s: ScoredStream) => boolean;
  isAnime: boolean;
  pipelineDone: boolean;
  cachedOnly: boolean;
  onCachedOnly: (v: boolean) => void;
}) {
  const t = useT();
  const startsAtOnce = useCallback((s: ScoredStream) => isCached(s) && !opensPage(s), [isCached]);
  const widePicture = episode?.still || meta.background || null;
  const picture = widePicture || meta.poster || null;
  const logo = (widePicture && meta.logo) || null;
  const named = episode ? pickerEpisode(meta, episode, absoluteEpisode) : null;
  const place = named
    ? [
        logo ? null : meta.name,
        named.season != null ? t("Season {n}", { n: named.season }) : null,
        t("Episode {n}", { n: named.episode }),
      ]
    : (pickerFilmLine(meta)?.split(" · ") ?? []);
  const eyebrow = place
    .filter((part) => part !== null)
    .map(bidiIsolate)
    .join(" · ");
  const title = named ? named.name || t("Episode {n}", { n: named.number }) : meta.name;

  return (
    <section className="harbor-scroll grid min-w-0 grid-cols-[250px_minmax(0,1fr)] items-center gap-x-6 gap-y-[18px] @max-[1084px]/modern:[@media(max-height:760px)]:grid-cols-[auto_minmax(0,1fr)] @max-[1084px]/modern:[@media(max-height:760px)]:gap-y-3 @min-[1084px]/modern:sticky @min-[1084px]/modern:top-[calc(var(--modern-top)+20px)] @min-[1084px]/modern:-ms-1 @min-[1084px]/modern:-me-[14px] @min-[1084px]/modern:flex @min-[1084px]/modern:max-h-[calc(100vh-40px-var(--modern-top))] @min-[1084px]/modern:flex-col @min-[1084px]/modern:items-stretch @min-[1084px]/modern:gap-5 @min-[1084px]/modern:overflow-y-auto @min-[1084px]/modern:px-1 @min-[1084px]/modern:pb-1 @min-[1084px]/modern:[scrollbar-gutter:stable] @min-[1084px]/modern:[@media(max-height:940px)]:gap-[14px]">
      {picture && (
        <div
          data-picture={widePicture ? "wide" : "tall"}
          className={`relative shrink-0 overflow-hidden rounded-lg border border-edge-soft bg-canvas/50 ${
            widePicture
              ? "aspect-video @max-[1084px]/modern:[@media(max-height:760px)]:w-[170px] @min-[1084px]/modern:[@media(820px<height<=940px)]:aspect-[2/1] @min-[1084px]/modern:[@media(height<=820px)]:aspect-[2.2/1]"
              : "aspect-[2/3] w-[170px] max-w-full @max-[1084px]/modern:[@media(max-height:760px)]:w-[72px]"
          }`}
        >
          <img
            src={tmdbBackdropAtSize(picture, "w780")}
            alt=""
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
          />
          {logo && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
              />
              <img
                src={logo}
                alt={meta.name}
                draggable={false}
                className="pointer-events-none absolute bottom-3 start-3.5 max-h-[32%] max-w-[58%] object-contain opacity-80"
              />
            </>
          )}
        </div>
      )}
      <header className={`min-w-0 ${picture ? "" : "col-span-full"}`}>
        {eyebrow && (
          <p
            data-place=""
            className="mb-2 text-balance text-[11px] font-semibold uppercase leading-[1.6] tracking-[0.24em] text-ink-muted/85 [overflow-wrap:anywhere]"
          >
            {eyebrow}
          </p>
        )}
        <h1 className="text-balance font-display text-[44px] font-medium leading-[1.02] tracking-tight text-ink [overflow-wrap:anywhere] @max-[1084px]/modern:[@media(max-height:760px)]:text-[34px]">
          <bdi>{title}</bdi>
        </h1>
        <Tally
          minutes={
            episode ? Math.round(episode.runtime ?? 0) : Math.round(runtimeMs(meta) / 60_000)
          }
          streams={streams}
          isEpisode={!!episode}
          isAnime={isAnime}
          isCached={startsAtOnce}
          pipelineDone={pipelineDone}
        />
        {episode?.overview && (
          <div className="[@media(max-height:820px)]:hidden">
            <CollapsibleOverview text={episode.overview} ownDirection />
          </div>
        )}
      </header>
      <ModernFilters
        streams={streams}
        isEpisode={!!episode}
        isAnime={isAnime}
        isCached={startsAtOnce}
        cachedOnly={cachedOnly}
        onCachedOnly={onCachedOnly}
      />
    </section>
  );
}

function Tally({
  minutes,
  streams,
  isEpisode,
  isAnime,
  isCached,
  pipelineDone,
}: {
  minutes: number;
  streams: ScoredStream[];
  isEpisode: boolean;
  isAnime: boolean;
  isCached: (s: ScoredStream) => boolean;
  pipelineDone: boolean;
}) {
  const t = useT();
  const { filters } = useModernState();
  const ctx = useModernContext(streams, isEpisode, isAnime);
  const matching = useMemo(
    () => applyModernFilters(streams, filters, ctx),
    [streams, filters, ctx],
  );
  const ready = useMemo(() => matching.filter(isCached).length, [matching, isCached]);

  const total = streams.length;
  const filtered = Object.keys(filters).length > 0;
  const sources = (): string => {
    if (filtered) return t("{shown} of {total} sources", { shown: matching.length, total });
    if (!pipelineDone) {
      return total === 1
        ? t("{n} source so far", { n: total })
        : t("{n} sources so far", { n: total });
    }
    return total === 1 ? t("{n} source", { n: total }) : t("{n} sources", { n: total });
  };
  // Statements of their own: a language has one plural form to choose in each, by its one number.
  const counts = (): string[] => {
    if (total === 0) return [];
    if (matching.length > 0) return [sources(), t("{ready} ready to start at once", { ready })];
    return [
      total === 1
        ? t("No source matches these filters.")
        : t("None of the {n} sources match these filters.", { n: total }),
    ];
  };
  const counted = counts();
  if (minutes <= 0 && counted.length === 0) return null;
  return (
    <p data-tally="" className="mt-3 text-[14.5px] text-ink-muted">
      {minutes > 0 && <bdi>{t("{n} min", { n: minutes })}</bdi>}
      {counted.map((statement, i) => (
        <Fragment key={i}>
          {(minutes > 0 || i > 0) && " · "}
          <bdi>
            <Numbers text={statement} />
          </bdi>
        </Fragment>
      ))}
    </p>
  );
}

function Numbers({ text }: { text: string }) {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-semibold tabular-nums text-ink">
        {part}
      </b>
    ) : (
      part
    ),
  );
}
