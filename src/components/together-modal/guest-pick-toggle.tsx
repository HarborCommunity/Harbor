import { ListChecks, PlayCircle, type LucideIcon } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { useKnobAnim } from "@/lib/knob-anim";
import { useT } from "@/lib/i18n";

type RoomSettingKey = "togetherGuestsPick" | "togetherAutoStart";

function RoomSettingToggle(props: {
  setting: RoomSettingKey;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const { settings, update } = useSettings();
  const on = settings[props.setting];
  const knob = useKnobAnim(on);
  const Icon = props.icon;
  return (
    <button
      onClick={() => update({ [props.setting]: !on })}
      className="flex h-12 items-center justify-between gap-2 rounded-lg border border-edge px-3 text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
      aria-pressed={on}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={13} strokeWidth={1.9} className="shrink-0" />
        <span className="flex min-w-0 flex-col text-start">
          <span className="truncate">{props.title}</span>
          <span className="truncate text-[10.5px] text-ink-subtle">{props.description}</span>
        </span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          on ? "bg-accent" : "bg-edge"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white shadow-sm ${
            on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
          } ${knob}`}
        />
      </span>
    </button>
  );
}

export function GuestPickToggle() {
  const t = useT();
  return (
    <RoomSettingToggle
      setting="togetherGuestsPick"
      icon={ListChecks}
      title={t("Guests pick their own source")}
      description={t("Prompts guests to choose instead of auto-matching")}
    />
  );
}

export function AutoStartToggle() {
  const t = useT();
  return (
    <RoomSettingToggle
      setting="togetherAutoStart"
      icon={PlayCircle}
      title={t("Start when everyone is ready")}
      description={t("Counts down 5 seconds, then plays for the room")}
    />
  );
}
