import { fmtTime } from "@/components/player/transport/transport-utils";
import { useT } from "@/lib/i18n";
import type { PlaybackAction } from "@/lib/together/protocol";

/** A short, passing line about something someone in the room just did. */
export type RoomActivityNoticeInfo =
  | { kind: "playback"; name: string; action: PlaybackAction; positionSeconds?: number }
  | { kind: "lock"; name: string; locked: boolean }
  | { kind: "locked-out"; name: string };

export function RoomActivityNotice(props: { notice: RoomActivityNoticeInfo }) {
  const t = useT();
  const { notice } = props;
  const text =
    notice.kind === "lock"
      ? notice.locked
        ? t("{name} locked playback", { name: notice.name })
        : t("{name} unlocked playback", { name: notice.name })
      : notice.kind === "locked-out"
        ? t("Only {name} can control playback", { name: notice.name })
        : notice.action === "pause"
          ? t("{name} paused", { name: notice.name })
          : notice.action === "play"
            ? t("{name} resumed", { name: notice.name })
            : notice.positionSeconds != null
              ? t("{name} skipped to {time}", {
                  name: notice.name,
                  time: fmtTime(notice.positionSeconds),
                })
              : t("{name} skipped", { name: notice.name });
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none max-w-full truncate rounded-full border border-white/12 bg-black/60 px-3.5 py-1.5 text-[12.5px] font-medium text-white/90 backdrop-blur-xl animate-popover-in"
    >
      {text}
    </div>
  );
}
