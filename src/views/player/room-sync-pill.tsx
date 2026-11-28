import { useEffect, useState } from "react";
import { useT, useUiLanguage } from "@/lib/i18n";
import { formatNames } from "./player-utils";

export type RoomSyncPillNotice =
  | { kind: "countdown"; at: number }
  | { kind: "host-buffering"; host: string }
  | { kind: "host-away"; host: string }
  | { kind: "waiting"; names: string[] }
  | { kind: "reconnect"; names: string[] };

export function useSecondsUntil(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [at]);
  return at == null ? 0 : Math.max(1, Math.ceil((at - now) / 1000));
}

/** Tells a viewer why playback is holding: a countdown, or who the room waits for. */
export function RoomSyncPill(props: { notice: RoomSyncPillNotice; onKeepWatching?: () => void }) {
  const t = useT();
  const language = useUiLanguage();
  const { notice } = props;
  const seconds = useSecondsUntil(notice.kind === "countdown" ? notice.at : null);
  const text =
    notice.kind === "countdown"
      ? t("Starting together in {n}…", { n: seconds })
      : notice.kind === "host-buffering"
        ? t("Waiting for {name} to load…", { name: notice.host })
        : notice.kind === "host-away"
          ? t("{name} lost connection. Waiting for them to come back…", { name: notice.host })
          : notice.kind === "reconnect"
            ? t("Waiting for {names} to reconnect…", { names: formatNames(notice.names, language) })
            : t("Waiting for {names} to load…", { names: formatNames(notice.names, language) });
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-black/72 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-xl"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white/80" />
      <span className="truncate">{text}</span>
      {props.onKeepWatching && (
        <button
          type="button"
          onClick={props.onKeepWatching}
          className="pointer-events-auto ms-1 shrink-0 rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold hover:bg-white/25"
        >
          {t("Keep watching")}
        </button>
      )}
    </div>
  );
}
