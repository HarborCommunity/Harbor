import * as React from "react";
import type { ReactNode } from "react";
import type { Settings } from "../../src/lib/settings/types.ts";
import type { ScoredStream } from "../../src/lib/streams/types.ts";
import type { ModernListProps } from "../../src/views/play-picker/modern/modern-list.tsx";
import type { ModernShellProps } from "../../src/views/play-picker/modern/modern-shell.tsx";
import type { ModernState } from "../../src/views/play-picker/modern/modern-state.tsx";
import { act, FILM } from "./picker-dom.tsx";

export { act, FILM, renderElement, source } from "./picker-dom.tsx";

// They need the page that picker-dom.tsx makes while they are loaded.
const { createRoot } = await import("react-dom/client");
const { DEFAULT } = await import("../../src/lib/settings/defaults.ts");
const { persistEffective } = await import("../../src/lib/settings/profile-store.ts");
const { SettingsProvider, useSettings } = await import("../../src/lib/settings.tsx");
const { ModernList } = await import("../../src/views/play-picker/modern/modern-list.tsx");
const { ModernShell } = await import("../../src/views/play-picker/modern/modern-shell.tsx");
const { useModernPickerState } =
  await import("../../src/views/play-picker/modern/modern-state.tsx");

export type Rendered = {
  state: () => ModernState;
  settings: () => Settings;
  rerender: (props?: Partial<ModernListProps>, shell?: Partial<ModernShellProps>) => Promise<void>;
  /** The page shows something else for a while, as it does while a source is being connected. */
  away: (on: boolean) => Promise<void>;
  /** Changes settings the way Harbor does. */
  update: (patch: Partial<Settings>) => Promise<void>;
  unmount: () => Promise<void>;
};

export type LookProps = Partial<ModernListProps> &
  Partial<Pick<ModernShellProps, "meta" | "isCached">> & { streams: ScoredStream[] };

/** Stores settings the way Harbor does, then draws the look inside Harbor's own settings. */
export async function renderModern(
  { meta = FILM, isCached = () => false, ...props }: LookProps,
  options: {
    settings?: Record<string, unknown>;
    shell?: Partial<ModernShellProps>;
    body?: (list: ReactNode) => ReactNode;
  } = {},
): Promise<Rendered> {
  localStorage.clear();
  persistEffective({ ...DEFAULT, ...options.settings } as Settings, "default", true);

  let state!: ModernState;
  let settings!: Settings;
  let change!: (patch: Partial<Settings>) => void;
  let isAway = false;
  /** As the page does it: the state is kept above everything it draws. */
  function Page() {
    state = useModernPickerState();
    ({ settings, update: change } = useSettings());
    if (isAway) return <p>Connecting</p>;
    return (
      <ModernShell {...shellProps} state={state}>
        {body(
          <ModernList
            {...listProps}
            noneCached={shellProps.noneCached}
            onCachedOnly={shellProps.onCachedOnly}
          />,
        )}
      </ModernShell>
    );
  }

  let listProps: Omit<ModernListProps, "noneCached" | "onCachedOnly"> = {
    ranked: props.streams,
    preferred: props.streams[0] ?? null,
    previousMatch: null,
    lastPlayedStream: null,
    failedStreams: new Set(),
    debrids: [],
    addons: null,
    getAddonLogo: () => null,
    pipelineDone: true,
    orderName: "harbor",
    isAnime: false,
    onPlay: () => {},
    onCache: () => {},
    resolvingStream: null,
    queuedHash: null,
    inSession: false,
    ...props,
  };
  let shellProps: Omit<ModernShellProps, "children" | "state"> = {
    meta,
    episode: listProps.episode,
    absoluteEpisode: listProps.absoluteEpisode,
    streams: listProps.streams,
    isCached,
    isAnime: listProps.isAnime,
    pipelineDone: listProps.pipelineDone,
    cachedOnly: false,
    noneCached: false,
    onCachedOnly: () => {},
    ...options.shell,
  };
  const body = options.body ?? ((list: ReactNode) => list);
  const tree = () => (
    <SettingsProvider>
      <Page />
    </SettingsProvider>
  );

  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => root.render(tree()));
  return {
    state: () => state,
    settings: () => settings,
    rerender: async (next = {}, shell = {}) => {
      listProps = { ...listProps, ...next };
      shellProps = { ...shellProps, streams: listProps.streams, ...shell };
      await React.act(async () => root.render(tree()));
    },
    away: async (on) => {
      isAway = on;
      await React.act(async () => root.render(tree()));
    },
    update: (patch) => React.act(async () => change(patch)),
    unmount: async () => {
      await React.act(async () => root.unmount());
    },
  };
}

let mouseAt = 0;

/** One event of the mouse where it stands right now. */
export const mouse = (type: string, element: Element, init: MouseEventInit = {}) =>
  element.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientX: mouseAt, clientY: mouseAt, ...init }),
  );

/**
 * The mouse as a browser reports it: moved onto an element, moved away from it, or at rest where
 * the element came to lie under it.
 */
export const pointer = (what: "enter" | "leave" | "rest", element: Element) =>
  act(() => {
    if (what === "leave") {
      mouse("pointerout", element, { relatedTarget: document.body });
      mouseAt += 1;
      mouse("pointermove", document.body);
      return;
    }
    mouse("pointermove", document.body);
    if (what === "enter") mouseAt += 1;
    mouse("pointerover", element, { relatedTarget: document.body });
    mouse("pointermove", element);
  });
