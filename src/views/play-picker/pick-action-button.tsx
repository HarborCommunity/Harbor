import { Check, Download, ExternalLink, Loader2 } from "lucide-react";
import { Play } from "@/components/icons/play-filled";
import type { DebridStore } from "@/lib/debrid/types";
import { useT } from "@/lib/i18n";
import type { ScoredStream } from "@/lib/streams/types";
import { directStreamAvailable } from "@/lib/torrent/stremio-stream";
import { anyStreamCached, hasUncachedMarker } from "./picker-utils";

export type PickAction = {
  externalOnly: boolean;
  isCached: boolean;
  queueTarget: DebridStore | undefined;
  canStream: boolean;
};

/** A source remembered for the title counts as ready. */
export function pickAction(
  stream: ScoredStream,
  debrids: DebridStore[],
  isPreviouslyPlayed: boolean,
): PickAction {
  const isCached =
    (stream.url != null && !stream.infoHash && !hasUncachedMarker(stream)) ||
    debrids.some((d) => stream.cached[d.slug]) ||
    anyStreamCached(stream) ||
    isPreviouslyPlayed;
  return {
    externalOnly: !stream.url && !stream.infoHash && !!stream.externalUrl,
    isCached,
    queueTarget: debrids.find((d) => d.queueCache),
    canStream: !isCached && directStreamAvailable(stream),
  };
}

export function PickActionButton({
  action,
  onPlay,
  onCache,
  resolving,
  queued,
  inSession,
}: {
  action: PickAction;
  onPlay: () => void;
  onCache: () => void;
  resolving: boolean;
  queued: boolean;
  inSession: boolean;
}) {
  const t = useT();
  const { externalOnly, isCached, queueTarget, canStream } = action;
  if (externalOnly) {
    return (
      <button
        onClick={onPlay}
        className="group flex h-14 items-center gap-3 rounded-full border border-ink/30 bg-ink/[0.04] px-7 text-[14.5px] font-semibold tracking-[0.04em] text-ink transition-[transform,background-color,opacity] duration-200 hover:scale-[1.02] hover:bg-ink/[0.08] active:scale-[0.98]"
      >
        <ExternalLink size={18} strokeWidth={2.2} />
        {t("Open in browser")}
      </button>
    );
  }
  if (isCached) {
    return (
      <button
        onClick={onPlay}
        disabled={resolving}
        className="group flex h-14 items-center gap-3 rounded-full bg-ink px-9 text-[15px] font-semibold tracking-[0.04em] text-canvas shadow-[0_12px_36px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
      >
        {resolving ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Play
            size={20}
            fill="currentColor"
            strokeWidth={0}
            className="transition-transform group-hover:translate-x-0.5"
          />
        )}
        {resolving ? t("Connecting") : inSession ? t("Play Together") : t("Play")}
      </button>
    );
  }
  if (queued) {
    return (
      <button
        disabled
        className="flex h-14 items-center gap-3 rounded-full bg-emerald-400/15 px-7 text-[14px] font-semibold tracking-[0.04em] text-emerald-300 ring-1 ring-emerald-400/40"
      >
        <Check size={18} strokeWidth={2.5} />
        {t("Queued on {provider}", { provider: queueTarget?.name ?? t("debrid") })}
      </button>
    );
  }
  if (queueTarget) {
    return (
      <button
        onClick={onCache}
        disabled={resolving}
        className="group flex h-14 items-center gap-3 rounded-full border border-accent/55 bg-accent/12 px-7 text-[14.5px] font-semibold tracking-[0.04em] text-accent transition-[transform,background-color,opacity] duration-200 hover:scale-[1.02] hover:bg-accent/20 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
      >
        {resolving ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Download size={18} strokeWidth={2.4} />
        )}
        {resolving
          ? t("Sending to {provider}", { provider: queueTarget.name })
          : t("Cache on {provider}", { provider: queueTarget.name })}
      </button>
    );
  }
  if (canStream) {
    return (
      <button
        onClick={onPlay}
        disabled={resolving}
        className="group flex h-14 items-center gap-3 rounded-full bg-ink px-9 text-[15px] font-semibold tracking-[0.04em] text-canvas shadow-[0_12px_36px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
      >
        {resolving ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Play
            size={20}
            fill="currentColor"
            strokeWidth={0}
            className="transition-transform group-hover:translate-x-0.5"
          />
        )}
        {resolving ? t("Connecting") : inSession ? t("Stream Together") : t("Stream")}
      </button>
    );
  }
  return (
    <button
      disabled
      className="flex h-14 items-center gap-3 rounded-full bg-canvas/60 px-7 text-[14px] font-semibold tracking-[0.04em] text-ink-subtle ring-1 ring-edge-soft"
    >
      {t("Not cached")}
    </button>
  );
}
