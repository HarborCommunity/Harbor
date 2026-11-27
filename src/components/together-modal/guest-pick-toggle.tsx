import { ListChecks, Lock, PlayCircle, WifiOff, type LucideIcon } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { useKnobAnim } from "@/lib/knob-anim";
import { useT } from "@/lib/i18n";

type RoomSettingKey = "togetherGuestsPick" | "togetherAutoStart" | "togetherHostOnlyControls";

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
      description={t("Counts down, then plays for the room")}
    />
  );
}

export function HostOnlyToggle() {
  const t = useT();
  return (
    <RoomSettingToggle
      setting="togetherHostOnlyControls"
      icon={Lock}
      title={t("Only I control playback")}
      description={t("Guests can't play, pause or skip")}
    />
  );
}

const DROP_POLICIES = ["keep-playing", "auto", "always"] as const;

/**
 * What the host's room does when someone's connection drops. Holding a
 * dropped person needs relay v12; on older relays the room always keeps playing.
 */
export function DropPolicySelect(props: { supported: boolean }) {
  const { settings, update } = useSettings();
  const t = useT();
  const current = props.supported ? settings.togetherDropPolicy : "keep-playing";
  const label = {
    "keep-playing": t("Keep playing"),
    auto: t("Automatic"),
    always: t("Always wait"),
  };
  const hint = {
    "keep-playing": t("Everyone else carries on"),
    auto: t("Pauses and waits in rooms of up to 3 people"),
    always: t("Pauses and waits up to 2 minutes for them to rejoin"),
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-edge px-3 py-2.5 text-[12.5px] text-ink-muted">
      <span className="flex items-center gap-2">
        <WifiOff size={13} strokeWidth={1.9} className="shrink-0" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{t("When someone drops")}</span>
          <span className="truncate text-[10.5px] text-ink-subtle">
            {props.supported ? hint[current] : t("Update your relay to use this")}
          </span>
        </span>
      </span>
      <div role="radiogroup" className="grid grid-cols-3 gap-1">
        {DROP_POLICIES.map((policy) => (
          <button
            key={policy}
            type="button"
            role="radio"
            aria-checked={current === policy}
            disabled={!props.supported}
            onClick={() => update({ togetherDropPolicy: policy })}
            className={`h-7 rounded-md px-1 text-[11.5px] transition-colors ${
              current === policy
                ? "bg-accent text-white"
                : "bg-white/[0.06] hover:bg-white/[0.10] hover:text-ink disabled:opacity-50 disabled:hover:bg-white/[0.06]"
            }`}
          >
            {label[policy]}
          </button>
        ))}
      </div>
    </div>
  );
}
