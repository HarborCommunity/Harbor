import type { CSSProperties, ReactNode } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayEpisode } from "@/lib/view";
import { ModernSide } from "./modern-side";
import { ModernStateProvider, type ModernState } from "./modern-state";
import { useTitleBarHeight } from "./use-title-bar-height";

export type ModernShellProps = {
  state: ModernState;
  meta: Meta;
  episode?: PlayEpisode;
  absoluteEpisode?: number | null;
  streams: ScoredStream[];
  isCached: (s: ScoredStream) => boolean;
  isAnime: boolean;
  pipelineDone: boolean;
  cachedOnly: boolean;
  noneCached: boolean;
  onCachedOnly: (v: boolean) => void;
  children: ReactNode;
};

/**
 * The steps follow the room the page gives and not the window, so that the small preview in
 * Settings shows the same.
 */
export function ModernShell({ state, children, ...side }: ModernShellProps) {
  const covered = useTitleBarHeight();
  return (
    <ModernStateProvider state={state}>
      {/* The page gets no ring from the TV navigation, and focus-visible does not match what a
          controller has moved to before any key was pressed. */}
      <div
        data-look=""
        className="@container/modern [html[data-input-modality=keys]_&_:focus]:outline-2 [html[data-input-modality=keys]_&_:focus]:outline-offset-2 [html[data-input-modality=keys]_&_:focus]:outline-accent"
        style={{ "--modern-top": `${covered}px` } as CSSProperties}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-7 gap-y-8 [@media(max-height:760px)]:gap-y-5 @min-[1084px]/modern:grid-cols-[300px_minmax(0,1fr)] @min-[1200px]/modern:grid-cols-[340px_minmax(0,1fr)] @min-[1200px]/modern:gap-x-9 @min-[1404px]/modern:gap-x-12">
          <ModernSide {...side} />
          <div className="flex min-w-0 flex-col gap-5">{children}</div>
        </div>
      </div>
    </ModernStateProvider>
  );
}
