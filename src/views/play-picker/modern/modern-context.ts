import { useMemo } from "react";
import { streamDubSub } from "@/components/dub-sub-pill";
import { useSettings } from "@/lib/settings";
import type { ScoredStream } from "@/lib/streams/types";
import { addonInstanceKey, buildAddonOptions } from "../picker-utils";
import { opensPage, type ModernContext } from "./modern-rules";

export function useModernContext(
  streams: ScoredStream[],
  isEpisode: boolean,
  isAnime: boolean,
): ModernContext {
  const { settings } = useSettings();
  const marksDub = settings.showDubBadge;
  const addonNames = useMemo(
    () => new Map(buildAddonOptions(streams).map((option) => [option.id, option.name])),
    [streams],
  );
  return useMemo(
    () => ({
      isEpisode,
      dubSub: (s) => (marksDub && !opensPage(s) ? streamDubSub(s.audioLanguages, isAnime) : null),
      addonOf: (s) => {
        const id = addonInstanceKey(s);
        return { id, name: addonNames.get(id) ?? s.addonName };
      },
    }),
    [isEpisode, isAnime, marksDub, addonNames],
  );
}
