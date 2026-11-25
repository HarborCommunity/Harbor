import { useEffect, useRef, type ReactNode } from "react";
import { FormatBadge, RuleBadges, streamBadges } from "@/components/format-badge";
import { bidiIsolate } from "@/lib/bidi";
import type { useDebridClients } from "@/lib/debrid/registry";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import type { ScoredStream } from "@/lib/streams/types";
import { directStreamAvailable } from "@/lib/torrent/stremio-stream";
import { PickActionButton, pickAction } from "../pick-action-button";
import { anyStreamCached, formatSize } from "../picker-utils";
import {
  knownResolution,
  knownSize,
  opensPage,
  pickReasons,
  sourceTitle,
  type ModernReason,
  type WantedEpisode,
} from "./modern-rules";
import { FAILED_INK } from "./modern-row";
import { watchPointer } from "./pointer-hold";

type Translate = ReturnType<typeof useT>;

// bidiIsolate's marks carry the parts that stand out through the translation, whatever place a
// language gives them.
const PART = /(\u2068[^\u2069]*\u2069)/;

function pickSentence(t: Translate, stream: ScoredStream, filtered: boolean): string {
  const title = sourceTitle(stream);
  const resolution = bidiIsolate(knownResolution(stream) ?? t("unknown quality"));
  const bytes = knownSize(stream);
  const size = bytes === null ? t("size unknown") : formatSize(bytes).replace(" ", "\u00a0");
  if (title.kind === "group") {
    const vars = { name: bidiIsolate(title.text), resolution, size };
    return filtered
      ? t("With these filters, Harbor's pick is {name} in {resolution}, {size}.", vars)
      : t("Harbor's pick is {name} in {resolution}, {size}.", vars);
  }
  const vars = { addon: bidiIsolate(stream.addonName || t("Source")), resolution, size };
  return filtered
    ? t("With these filters, Harbor's pick comes from {addon}, in {resolution}, {size}.", vars)
    : t("Harbor's pick comes from {addon}, in {resolution}, {size}.", vars);
}

function reasonSentence(t: Translate, reason: ModernReason): string {
  switch (reason.kind) {
    case "played-last":
      return t("Played last time.");
    case "library":
      return t("In your {providers} library.", { providers: reason.providers.join(" + ") });
    case "cached":
      return t("Cached on {providers}, so it starts at once.", {
        providers: reason.providers.join(" + "),
      });
    case "addon-cached":
      return t("Cached, so it starts at once.");
    case "not-cached":
      return reason.provider
        ? t("Not cached yet, so {provider} has to fetch it first.", { provider: reason.provider })
        : t("Not cached yet.");
    case "peers":
      return t("Streams from peers.");
    case "most-seeders":
      return t("Most seeders at {resolution}.", { resolution: reason.resolution });
    case "exact-episode":
      return t("Exactly this episode.");
    case "batch":
      return t("A batch.");
    case "hdr":
      return reason.formats.length > 1
        ? t("With {first} and {second}.", { first: reason.formats[0], second: reason.formats[1] })
        : t("With {format}.", { format: reason.formats[0] });
  }
}

type Words = {
  list: ScoredStream[];
  filtered: boolean;
  episode: WantedEpisode | null;
  playedLast: boolean;
  failed: boolean;
  debrids: ReturnType<typeof useDebridClients>;
};

function PickWords({
  stream,
  isCached,
  list,
  filtered,
  episode,
  playedLast,
  failed,
  debrids,
}: Words & { stream: ScoredStream; isCached: boolean }) {
  const t = useT();
  const { settings } = useSettings();
  const resolution = knownResolution(stream);
  const badged = resolution ? { ...stream, resolution } : stream;
  const reasons = pickReasons({
    pick: stream,
    list,
    episode,
    playedLast,
    debrids,
    addonCached: anyStreamCached(stream),
    canStreamDirectly: directStreamAvailable(stream),
    // The button plays a source remembered for this title, so nobody has to fetch it first.
  }).filter((reason) => !(reason.kind === "not-cached" && isCached));

  return (
    <>
      <p
        data-pick-sentence=""
        className="font-display text-[22px] leading-[1.25] tracking-[-0.005em] text-ink-muted"
      >
        <bdi>
          {pickSentence(t, stream, filtered)
            .split(PART)
            .map((text, i) =>
              i % 2 === 1 ? (
                <b key={i} className="font-medium text-ink [overflow-wrap:anywhere]">
                  <bdi>{text.slice(1, -1)}</bdi>
                </b>
              ) : (
                text
              ),
            )}
        </bdi>
      </p>
      {(failed || reasons.length > 0) && (
        <p
          data-pick-why=""
          className={`mt-1.5 text-[14px] ${failed ? `font-medium ${FAILED_INK}` : "text-ink-muted/85"}`}
        >
          <bdi>
            {failed
              ? t("Unavailable, try another.")
              : reasons.map((reason) => reasonSentence(t, reason)).join(" ")}
          </bdi>
        </p>
      )}
      {settings.showQualityBadge && !opensPage(stream) && (
        <div
          data-pick-badges=""
          className="mt-3 flex flex-wrap items-center gap-x-[13px] gap-y-1.5 empty:hidden"
        >
          {streamBadges(badged)
            .map((kind) => (kind === "no-label" && resolution !== null ? "sd" : kind))
            .filter((kind) => kind !== "sd" || resolution !== null)
            .map((kind) => (
              <FormatBadge key={kind} kind={kind} size="sm" />
            ))}
          <RuleBadges stream={badged} size="sm" />
        </div>
      )}
    </>
  );
}

export function ModernPick({
  stream,
  modeSwitch,
  isPreviouslyPlayed,
  resolving,
  queued,
  inSession,
  onPlay,
  onCache,
  onHold,
  ...words
}: Words & {
  /** Null while nothing is left to pick: the switch keeps its place. */
  stream: ScoredStream | null;
  modeSwitch: ReactNode;
  isPreviouslyPlayed: boolean;
  resolving: boolean;
  queued: boolean;
  inSession: boolean;
  onPlay: (s: ScoredStream) => void;
  onCache: (s: ScoredStream) => void;
  onHold: (what: "pointer" | "focus", on: boolean) => void;
}) {
  const action = stream && pickAction(stream, words.debrids, isPreviouslyPlayed);

  const areaRef = useRef<HTMLElement>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  const picked = stream !== null;
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !picked) return;
    const stop = watchPointer(area, (on) => onHold("pointer", on), { except: switchRef });
    // Nothing tells when an element under the pointer goes away.
    return () => {
      stop();
      onHold("pointer", false);
      onHold("focus", false);
    };
  }, [onHold, picked]);

  return (
    <section
      ref={areaRef}
      data-pick={picked ? "" : undefined}
      className="flex flex-wrap items-center gap-x-6 gap-y-4 @max-[1084px]/modern:[@media(max-height:760px)]:items-start"
    >
      {stream && action && (
        <div
          className="shrink-0"
          onFocus={() => onHold("focus", true)}
          onBlur={() => onHold("focus", false)}
        >
          <PickActionButton
            action={action}
            onPlay={() => onPlay(stream)}
            onCache={() => onCache(stream)}
            resolving={resolving}
            queued={queued}
            inSession={inSession}
          />
        </div>
      )}
      <div className="flow-root min-w-0 flex-1 basis-[300px]">
        {modeSwitch && (
          <div ref={switchRef} className="float-end ms-6 flex">
            {modeSwitch}
          </div>
        )}
        {stream && action && <PickWords stream={stream} isCached={action.isCached} {...words} />}
      </div>
    </section>
  );
}
