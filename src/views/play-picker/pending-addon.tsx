import { useEffect, useMemo, useState } from "react";
import { addonLogoSrc, resolveAddonLogo } from "@/components/addon-logo";
import type { Addon } from "@/lib/addons";
import { useT } from "@/lib/i18n";
import type { ScoredStream } from "@/lib/streams/types";

export function usePendingAddon(addons: Addon[] | null, streams: ScoredStream[]): Addon | null {
  const pending = useMemo(() => {
    if (!addons || addons.length === 0) return [] as Addon[];
    const returned = new Set(streams.map((s) => s.addonId));
    return addons.filter((a) => {
      const id = a.manifest?.id;
      if (!id) return false;
      const hasStream = (a.manifest?.resources ?? []).some((r) =>
        typeof r === "string" ? r === "stream" : r.name === "stream",
      );
      if (!hasStream) return false;
      return !returned.has(id);
    });
  }, [addons, streams]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pending.length <= 1) return;
    const t = window.setInterval(() => setTick((v) => v + 1), 1800);
    return () => window.clearInterval(t);
  }, [pending.length]);
  return pending.length > 0 ? pending[tick % pending.length] : null;
}

export function Spinner() {
  return (
    <span className="relative inline-block h-3 w-3">
      <span className="absolute inset-0 rounded-full border-[1.5px] border-edge" />
      <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-transparent border-t-ink" />
    </span>
  );
}

export function PendingChip({ addon }: { addon: Addon }) {
  const t = useT();
  const id = addon.manifest?.id ?? "";
  const name = addon.manifest?.name ?? id ?? "addon";
  const remoteLogo = resolveAddonLogo(addon.manifest?.logo, addon.transportUrl);
  const bundled = addonLogoSrc(id, name);
  const src = remoteLogo ?? bundled ?? null;
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink">
      <span className="text-ink-subtle">{t("Waiting for")}</span>
      <span className="flex items-center gap-1.5">
        {src ? (
          <img src={src} alt="" className="h-4 w-4 rounded-sm object-contain" />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-raised text-[8.5px] font-semibold text-ink-muted">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="font-medium text-ink">{name}</span>
      </span>
    </span>
  );
}
