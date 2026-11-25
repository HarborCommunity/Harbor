import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type { Meta } from "@/lib/cinemeta";
import type { ScoredStream } from "@/lib/streams/types";
import { act, FILM, renderElement, source } from "./helpers/picker-dom.tsx";

const { PrimaryCard } = await import("@/views/play-picker/primary-card");

type CardProps = Parameters<typeof PrimaryCard>[0];
const RD = { slug: "rd", name: "Real-Debrid" };
const TB = { slug: "tb", name: "TorBox", queueCache: () => undefined };
const debrids = (...list: unknown[]) => list as CardProps["debrids"];

let show: () => void;
/** Draws its content later: Harbor's settings do desktop work when they start inside the app. */
function Later({ children }: { children: React.ReactNode }) {
  const [on, setOn] = React.useState(false);
  show = () => setOn(true);
  return on ? children : null;
}

/** The card's main button in one state: what it says, whether it can be pressed, what it does. */
async function mainButton(
  stream: ScoredStream,
  props: Partial<CardProps> = {},
  desktop = false,
): Promise<{ text: string; enabled: boolean; does: string }> {
  let does = "";
  const view = await renderElement(
    <Later>
      <PrimaryCard
        meta={FILM as Meta}
        stream={stream}
        debrids={debrids()}
        addonLogo={null}
        onPlay={() => (does += "play")}
        onCache={() => (does += "cache")}
        resolving={false}
        queued={false}
        inSession={false}
        {...props}
      />
    </Later>,
  );
  try {
    if (desktop) Object.assign(window, { __TAURI_INTERNALS__: {} });
    await act(() => show());
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    assert.equal(buttons.length, 1, "the card has one main button");
    await act(() => buttons[0].click());
    return { text: buttons[0].textContent!, enabled: !buttons[0].disabled, does };
  } finally {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    await view.unmount();
  }
}

const torrent = (partial: Partial<ScoredStream> = {}) => source("A.Film.2020.1080p.mkv", partial);
const link = (partial: Partial<ScoredStream> = {}) =>
  torrent({ infoHash: undefined, url: "https://example.test/a.mkv", ...partial });

test("a page outside Harbor opens in the browser", async () => {
  const outside = torrent({ infoHash: undefined, externalUrl: "https://example.test/watch" });
  assert.deepEqual(await mainButton(outside, { debrids: debrids(TB) }), {
    text: "Open in browser",
    enabled: true,
    does: "play",
  });
});

test("what can start at once is played", async () => {
  const play = { text: "Play", enabled: true, does: "play" };
  assert.deepEqual(await mainButton(link()), play, "a direct link");
  assert.deepEqual(
    await mainButton(torrent({ cached: { rd: true } }), { debrids: debrids(RD) }),
    play,
    "cached on a debrid",
  );
  assert.deepEqual(
    await mainButton(torrent({ cached: { ad: true } }), { debrids: debrids(RD) }),
    play,
    "cached on a debrid of the add-on",
  );
  assert.deepEqual(await mainButton(torrent({ name: "⚡ Torrentio" })), play, "marked as cached");
  assert.deepEqual(
    await mainButton(torrent(), { isPreviouslyPlayed: true, debrids: debrids(TB) }),
    play,
    "remembered for this title",
  );
  assert.deepEqual(await mainButton(link(), { inSession: true }), {
    ...play,
    text: "Play Together",
  });
  assert.deepEqual(await mainButton(link(), { resolving: true }), {
    text: "Connecting",
    enabled: false,
    does: "",
  });
});

test("what a debrid can fetch is cached there", async () => {
  const props = { debrids: debrids(RD, TB) };
  assert.deepEqual(await mainButton(torrent(), props, true), {
    text: "Cache on TorBox",
    enabled: true,
    does: "cache",
  });
  assert.deepEqual(await mainButton(torrent(), { ...props, resolving: true }), {
    text: "Sending to TorBox",
    enabled: false,
    does: "",
  });
  assert.deepEqual(await mainButton(torrent(), { ...props, queued: true }), {
    text: "Queued on TorBox",
    enabled: false,
    does: "",
  });
});

test("a torrent nobody fetches is streamed where that is possible", async () => {
  const props = { debrids: debrids(RD) };
  assert.deepEqual(await mainButton(torrent(), props, true), {
    text: "Stream",
    enabled: true,
    does: "play",
  });
  assert.deepEqual(await mainButton(torrent(), { ...props, inSession: true }, true), {
    text: "Stream Together",
    enabled: true,
    does: "play",
  });
  assert.deepEqual(await mainButton(torrent(), { ...props, resolving: true }, true), {
    text: "Connecting",
    enabled: false,
    does: "",
  });
  const none = { text: "Not cached", enabled: false, does: "" };
  assert.deepEqual(await mainButton(torrent(), props), none);
  assert.deepEqual(await mainButton(link({ name: "[RD download] Torrentio" }), props, true), none);
});
