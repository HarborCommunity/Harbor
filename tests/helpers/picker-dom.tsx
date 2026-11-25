import { JSDOM } from "jsdom";
import * as React from "react";
import type { ReactNode } from "react";
import type { ScoredStream } from "../../src/lib/streams/types.ts";

// The parts read window and localStorage while they are loaded, so the page has to be there first.
const dom = new JSDOM("<div id='root'></div>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.matchMedia = (query: string) =>
  ({
    matches: query.includes("reduced-motion"),
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { createRoot } = await import("react-dom/client");
const { SettingsProvider } = await import("../../src/lib/settings.tsx");
const { parseStream } = await import("../../src/lib/streams/parser/parser-stream.ts");

export const FILM = { id: "tt0000001", type: "movie", name: "A film" } as const;

let made = 0;

/** A source as Harbor's parser reads it from a file name, with what a test wants to set itself. */
export function source(file: string, partial: Partial<ScoredStream> = {}): ScoredStream {
  made += 1;
  return {
    ...parseStream({
      addonId: "torrentio",
      addonName: "Torrentio",
      name: "Torrentio",
      title: file,
      behaviorHints: { filename: file },
      infoHash: made.toString(16).padStart(40, "0"),
    }),
    score: 100 - made,
    reasons: [],
    tier: "1080p",
    ...partial,
  };
}

/** The same sources, cached on a debrid where `which` says so. */
export const withCached = (streams: ScoredStream[], which: (at: number) => boolean) =>
  streams.map((s, at): ScoredStream => ({ ...s, cached: which(at) ? { rd: true } : {} }));

/** Draws one part alone inside Harbor's own settings. */
export async function renderElement(element: ReactNode): Promise<{ unmount: () => Promise<void> }> {
  localStorage.clear();
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => root.render(<SettingsProvider>{element}</SettingsProvider>));
  return { unmount: () => React.act(async () => root.unmount()) };
}

export const act = (run: () => unknown) => React.act(async () => void (await run()));
