import { Fragment, memo, useEffect, useRef, type ReactNode } from "react";
import { Check, Download, ExternalLink, Zap } from "lucide-react";
import { AddonLogo } from "@/components/addon-logo";
import { DubSubPill, type DubSub } from "@/components/dub-sub-pill";
import { FlagStack } from "@/components/flag";
import { HostMatchChip } from "@/components/host-match-chip";
import { Play } from "@/components/icons/play-filled";
import { CopyLinkButton, resolveStreamLink } from "@/components/player/copy-link-button";
import type { useDebridClients } from "@/lib/debrid/registry";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { hasUncachedMarker } from "@/lib/streams/cached";
import { INTENT_PREWARM_DELAY_MS } from "@/lib/streams/p2p-prewarm";
import type { ScoredStream } from "@/lib/streams/types";
import { EditionChip } from "../edition-chip";
import { anyStreamCached, formatSize } from "../picker-utils";
import { PlayedLastBadge } from "../played-last-badge";
import {
  hasAtmos,
  knownResolution,
  knownSeeders,
  knownSize,
  mark,
  opensPage,
  sourceLine,
  sourceTitle,
  sourceWords,
} from "./modern-rules";
import { AUDIO_CELL, AUDIO_MARK, FROM_CELL, ROW_GRID } from "./row-grid";

type Translate = ReturnType<typeof useT>;

const MOST_FLAGS = 3;
const ROW_LIT =
  "hover:bg-elevated/50 has-[[data-play]:focus-visible]:bg-elevated/50 [html[data-input-modality=keys]_&:has([data-play]:focus)]:bg-elevated/50";
const FAILED_LIT =
  "hover:bg-danger/12 has-[[data-play]:focus-visible]:bg-danger/12 [html[data-input-modality=keys]_&:has([data-play]:focus)]:bg-danger/12";
/** Mixed, so that it can be read on every theme's ground. */
export const FAILED_INK = "text-[color-mix(in_oklab,var(--color-danger)_65%,var(--color-ink))]";
/** The headings that stick to the top would cover what gets the focus and is scrolled to. */
const BELOW_HEADINGS = "scroll-mt-[calc(var(--modern-top)+64px)]";

export type ModernRowProps = {
  stream: ScoredStream;
  wholeNames: boolean;
  addonName: string;
  addonLogo: string | null;
  debrids: ReturnType<typeof useDebridClients>;
  dubSub: DubSub | null;
  isEpisode: boolean;
  isPick: boolean;
  playedLast: boolean;
  match: "same" | "close" | null;
  failed: boolean;
  queued: boolean;
  mostSeeders: number;
  onPlay: (s: ScoredStream) => void;
  onIntent: (s: ScoredStream) => void;
  onIntentCancel: (s: ScoredStream) => void;
};

/** Read once for the whole list: a sort is saved with the settings and would redraw every row. */
export function useWholeNames(): boolean {
  const { settings } = useSettings();
  return settings.fullStreamDescription;
}

/** The row itself is no control: its play button is, stretched over the whole row. */
export const ModernRow = memo(function ModernRow({
  stream,
  wholeNames,
  addonName,
  addonLogo,
  debrids,
  dubSub,
  isEpisode,
  isPick,
  playedLast,
  match,
  failed,
  queued,
  mostSeeders,
  onPlay,
  onIntent,
  onIntentCancel,
}: ModernRowProps) {
  const t = useT();
  const intent = useIntent(
    () => onIntent(stream),
    () => onIntentCancel(stream),
  );
  const title = sourceTitle(stream);
  const name = title.text || t("Source");
  const line = sourceLine(stream);
  const file = line?.kind === "file" ? line.text : null;
  const hasFile = !opensPage(stream);
  // A web page is no source, so one line of its words is enough of it.
  const words = file === null ? sourceWords(stream, wholeNames && hasFile) : [];
  const resolution = knownResolution(stream);
  const seeders = knownSeeders(stream);
  const size = knownSize(stream);
  const link = resolveStreamLink(stream);
  const lines = wholeNames ? "[overflow-wrap:anywhere]" : "truncate";
  const sound = hasFile ? soundWords(stream, true) : "";
  const isSaid = mark(resolution ?? "").test(name);
  const label = [hasFile ? t("Play") : t("Open in browser"), name, isSaid ? null : resolution]
    .filter(Boolean)
    .join(" ");
  const play = () => onPlay(stream);

  return (
    <li
      data-row=""
      data-tv-nav-cell=""
      data-failed={failed ? "" : undefined}
      onPointerEnter={failed ? undefined : intent.soon}
      onPointerLeave={intent.cancel}
      onFocus={failed ? undefined : intent.soon}
      onBlur={intent.forget}
      className={`group/row relative border-b border-s-2 border-b-edge-soft px-3.5 py-3 -ms-0.5 ${ROW_GRID} ${
        failed
          ? `border-s-danger bg-danger/7 ${FAILED_LIT}`
          : isPick
            ? `border-s-accent bg-[linear-gradient(to_right,color-mix(in_oklab,var(--color-accent)_7%,transparent),transparent_42%)] rtl:bg-[linear-gradient(to_left,color-mix(in_oklab,var(--color-accent)_7%,transparent),transparent_42%)] ${ROW_LIT}`
            : `border-s-transparent ${ROW_LIT}`
      }`}
    >
      <div data-release="" className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span
            data-name=""
            dir="auto"
            className={`min-w-0 max-w-full [text-align:-webkit-match-parent] ${lines} ${
              title.kind === "file" ? "font-mono text-[13px]" : "font-semibold"
            } ${failed ? "text-ink-muted" : "text-ink"}`}
          >
            {title.kind === "file" && wholeNames ? <FileName text={name} /> : name}
          </span>
          {dubSub ? (
            <span className={`inline-flex ${AUDIO_MARK}`}>
              <DubSubPill kind={dubSub} size="md" />
            </span>
          ) : (
            sound && (
              <span className={`text-[12.5px] font-medium text-ink-muted/85 ${AUDIO_MARK}`}>
                {sound}
              </span>
            )
          )}
          {isPick && (
            <span className="text-[12.5px] font-semibold text-accent">{t("Harbor's pick")}</span>
          )}
          {playedLast && <PlayedLastBadge />}
          <HostMatchChip match={match} />
          {isEpisode && hasFile && stream.seasonPack && (
            <span className="text-[12.5px] font-medium text-ink-muted/85">{t("Batch")}</span>
          )}
          {hasFile && <EditionChip stream={stream} />}
        </div>
        {failed ? (
          <p className={`mt-[3px] text-[13px] font-medium ${FAILED_INK}`}>
            {t("Unavailable, try another.")}
          </p>
        ) : file === null ? (
          words.length > 0 && (
            <div data-words="" className="mt-[3px] text-[12.5px] text-ink-muted/85">
              {words.map((text) => (
                <p key={text} dir="auto" className={`[text-align:-webkit-match-parent] ${lines}`}>
                  {text}
                </p>
              ))}
            </div>
          )
        ) : (
          title.kind !== "file" && (
            <p
              data-file=""
              dir="auto"
              className={`mt-[3px] font-mono text-[12.5px] text-ink-muted/85 [text-align:-webkit-match-parent] ${lines}`}
            >
              {wholeNames ? <FileName text={file} /> : file}
            </p>
          )
        )}
      </div>
      <Cell name="resolution" faded={failed}>
        {hasFile && (
          <>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {resolution && <Resolution value={resolution} />}
              {hdrMarks(stream).map((mark) => (
                <Mark key={mark}>{mark}</Mark>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-ink-muted/85 empty:hidden">{madeOf(t, stream)}</p>
          </>
        )}
      </Cell>
      <Cell name="seeders" faded={failed}>
        {seeders !== null && <Seeders count={seeders} most={mostSeeders} />}
      </Cell>
      <Cell name="size" faded={failed} className="whitespace-nowrap tabular-nums text-ink-muted">
        {size !== null && <Size bytes={size} />}
      </Cell>
      <Cell name="audio" faded={failed} className={AUDIO_CELL}>
        {dubSub ? (
          <>
            <DubSubPill kind={dubSub} size="md" />
            <p className="mt-1 text-[12px] text-ink-muted/85 empty:hidden">{sound}</p>
          </>
        ) : (
          hasFile && <Sound stream={stream} onPlay={play} />
        )}
      </Cell>
      <Cell name="from" faded={failed} className={FROM_CELL}>
        <div className="flex items-center gap-2 text-ink-muted">
          <WithTooltip onPlay={play}>
            <AddonLogo
              addonId={stream.addonId}
              addonName={addonName}
              manifestLogo={addonLogo}
              size="sm"
            />
          </WithTooltip>
          <bdi className="min-w-0 truncate">{addonName}</bdi>
        </div>
        <Availability stream={stream} debrids={debrids} queued={queued} />
      </Cell>
      <Cell name="actions" faded={false} className="flex items-center justify-end gap-1.5">
        {link && (
          // The control itself has to keep its opacity: the controller navigation skips one at 0.
          <span
            data-tv-nav-cell=""
            className="relative z-10 flex opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <CopyLinkButton
              url={link}
              size={15}
              className={`h-8 w-8 rounded-full ${BELOW_HEADINGS}`}
            />
          </span>
        )}
        {/* no-press: Harbor scales a pressed button, and a scaled one no longer covers its row. */}
        <button
          type="button"
          data-play=""
          onClick={play}
          aria-label={failed ? `${label}. ${t("Unavailable, try another.")}` : label}
          title={wholeNames ? undefined : (file ?? (words.join("\n") || undefined))}
          className={`no-press group/play shrink-0 rounded-full after:absolute after:inset-0 ${BELOW_HEADINGS}`}
        >
          <span
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full border transition-[background-color,border-color,color,scale] duration-150 group-hover/row:border-accent group-hover/row:bg-accent group-hover/row:text-canvas group-focus-visible/play:border-accent group-focus-visible/play:bg-accent group-focus-visible/play:text-canvas group-active/play:scale-[0.96] motion-reduce:transition-none [html[data-input-modality=keys]_:focus>&]:border-accent [html[data-input-modality=keys]_:focus>&]:bg-accent [html[data-input-modality=keys]_:focus>&]:text-canvas ${
              failed ? "border-edge text-ink-subtle" : "border-ink/25 text-ink-muted"
            }`}
          >
            {hasFile ? (
              <Play size={15} fill="currentColor" strokeWidth={0} className="ms-0.5" />
            ) : (
              <ExternalLink size={15} strokeWidth={2.2} />
            )}
          </span>
        </button>
      </Cell>
    </li>
  );
});

function useIntent(start: () => void, stop: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);
  const forget = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => forget, []);
  const soon = () => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      started.current = true;
      start();
    }, INTENT_PREWARM_DELAY_MS);
  };
  const cancel = () => {
    forget();
    if (started.current) stop();
    started.current = false;
  };
  return { soon, cancel, forget };
}

/** Lies over the stretched play button, so that its tooltip is found; a click on it plays, too. */
function WithTooltip({ onPlay, children }: { onPlay: () => void; children: ReactNode }) {
  return (
    <span className="pointer-events-auto relative z-10 flex shrink-0" onClick={onPlay}>
      {children}
    </span>
  );
}

function Cell({
  name,
  faded,
  className = "",
  children,
}: {
  name: string;
  faded: boolean;
  className?: string;
  children: ReactNode;
}) {
  // What fades lies over the stretched button as a whole, with the tooltips in it, and lets clicks
  // through to it.
  const fade = faded ? "pointer-events-none relative z-10 opacity-45" : "";
  return (
    <div data-cell={name} className={`min-w-0 ${className} ${fade}`}>
      {children}
    </div>
  );
}

/** A file name that can break behind its dots, where its words end, but not before its ending. */
function FileName({ text }: { text: string }) {
  return text.split(/(?<=[._])(?![._]|\w{2,4}$)/).map((word, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {word}
    </Fragment>
  ));
}

function Mark({ children }: { children: string }) {
  return (
    <span className="whitespace-nowrap rounded-[4px] border border-edge px-1 py-px text-[10px] font-bold leading-[1.3] tracking-[0.06em] text-ink-muted">
      {children}
    </span>
  );
}

function Resolution({ value }: { value: string }) {
  const digits = /^(\d+)p$/.exec(value)?.[1];
  return (
    <span className="whitespace-nowrap font-rank text-[25px] font-medium leading-none tracking-[0.01em] text-ink">
      {digits ?? value}
      {digits && <span className="ms-px align-[7px] text-[13px] text-ink-muted">p</span>}
    </span>
  );
}

function hdrMarks(stream: ScoredStream): string[] {
  return stream.hdrFormat === "DV+HDR10"
    ? ["DV", "HDR10"]
    : stream.hdrFormat
      ? [stream.hdrFormat]
      : [];
}

function madeOf(t: Translate, stream: ScoredStream): string {
  const from =
    stream.source === "REMUX"
      ? t("Remux")
      : stream.source === "BluRay"
        ? "Blu-ray"
        : stream.source === "Other"
          ? null
          : stream.source;
  return [from, stream.codec === "Other" ? null : stream.codec].filter(Boolean).join(", ");
}

function Seeders({ count, most }: { count: number; most: number }) {
  const share = count > 0 ? Math.max(4, Math.round((count / Math.max(most, 1)) * 100)) : 0;
  const tone = count >= 300 ? "bg-success" : count >= 100 ? "bg-accent" : "bg-ink-subtle";
  return (
    <>
      <span className="font-semibold tabular-nums text-ink">{count.toLocaleString()}</span>
      <span
        aria-hidden="true"
        className="mt-2 block h-[3px] w-[92px] max-w-full overflow-hidden rounded-[2px] bg-edge-soft"
      >
        <span className={`block h-full rounded-[2px] ${tone}`} style={{ width: `${share}%` }} />
      </span>
    </>
  );
}

function Size({ bytes }: { bytes: number }) {
  const [number, unit] = formatSize(bytes).split(" ");
  return (
    <bdi>
      <b className="font-semibold text-ink">{number}</b> {unit}
    </bdi>
  );
}

function soundWords(stream: ScoredStream, withAtmos: boolean): string {
  const { codec, channels } = stream.audio;
  const layout = channels >= 8 ? "7.1" : channels === 7 ? "6.1" : channels === 6 ? "5.1" : null;
  const named = codec !== "Other" && (withAtmos || codec !== "Atmos");
  const onTop = withAtmos && codec !== "Atmos" && hasAtmos(stream);
  return [named ? codec : null, layout, onTop ? "Atmos" : null].filter(Boolean).join(" ");
}

function Sound({ stream, onPlay }: { stream: ScoredStream; onPlay: () => void }) {
  const t = useT();
  const words = soundWords(stream, false);
  const languages = stream.audioLanguages.filter((l) => l && l.toLowerCase() !== "unknown");
  const more = languages.length - MOST_FLAGS;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 empty:hidden">
        {words && <span className="whitespace-nowrap text-ink-muted">{words}</span>}
        {hasAtmos(stream) && <Mark>ATMOS</Mark>}
      </div>
      {languages.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <WithTooltip onPlay={onPlay}>
            <FlagStack languages={languages.slice(0, MOST_FLAGS)} max={MOST_FLAGS} size="sm" />
          </WithTooltip>
          {more > 0 && (
            <span className="text-[11px] font-semibold text-ink-muted/85">
              {t("+{n} more", { n: more })}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** In the words of the condensed card. Whether a link starts at once only its add-on can say. */
function Availability({
  stream,
  debrids,
  queued,
}: {
  stream: ScoredStream;
  debrids: ReturnType<typeof useDebridClients>;
  queued: boolean;
}) {
  const t = useT();
  const namesOf = (has: ScoredStream["cached"]) =>
    debrids
      .filter((d) => has[d.slug])
      .map((d) => d.name)
      .join(" + ");
  const library = namesOf(stream.inLibrary);
  const cached = namesOf(stream.cached);
  const line = (tone: string, sign: ReactNode, words: string) => (
    <p className={`mt-[5px] flex items-start gap-1.5 text-[12px] leading-4 ${tone}`}>
      <span className="flex h-4 shrink-0 items-center">{sign}</span>
      <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{words}</span>
    </p>
  );
  const bolt = (tone: string) => (
    <Zap size={12} fill="currentColor" strokeWidth={0} className={`shrink-0 ${tone}`} />
  );
  if (opensPage(stream)) {
    return line(
      "text-ink-muted/85",
      <ExternalLink size={12} strokeWidth={2.2} className="shrink-0" />,
      t("External"),
    );
  }
  if (library) {
    return line("text-accent", bolt(""), t("In your {providers} library", { providers: library }));
  }
  if (cached) {
    return line(
      "text-ink-muted",
      bolt("text-ink"),
      t("Cached on {providers}", { providers: cached }),
    );
  }
  if (anyStreamCached(stream)) return line("text-ink-muted", bolt("text-ink"), t("Cached"));
  if (queued) {
    const provider = debrids.find((d) => d.queueCache)?.name ?? t("debrid");
    return line(
      "text-success",
      <Check size={12} strokeWidth={2.5} className="shrink-0" />,
      t("Queued on {provider}", { provider }),
    );
  }
  if (stream.url ? hasUncachedMarker(stream) : debrids.length > 0) {
    return line(
      "text-ink-muted/85",
      <Download size={12} strokeWidth={2.2} className="shrink-0" />,
      t("Not cached yet"),
    );
  }
  return null;
}
