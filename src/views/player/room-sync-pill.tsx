import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export type RoomSyncPillNotice =
  | { kind: "countdown"; at: number }
  | { kind: "host-buffering"; host: string };

function useSecondsUntil(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [at]);
  return at == null ? 0 : Math.max(1, Math.ceil((at - now) / 1000));
}

/** Tells a viewer why playback is holding: a countdown, or a host that is loading. */
export function RoomSyncPill(props: { notice: RoomSyncPillNotice }) {
  const t = useT();
  const { notice } = props;
  const seconds = useSecondsUntil(notice.kind === "countdown" ? notice.at : null);
  const text =
    notice.kind === "countdown"
      ? t("Starting together in {n}…", { n: seconds })
      : t("Waiting for {name} to load…", { name: notice.host });
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-20 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/72 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-xl"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white/80" />
      <span className="truncate">{text}</span>
    </div>
  );
}
