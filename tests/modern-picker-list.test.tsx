import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import type { Addon } from "@/lib/addons";
import type { Meta } from "@/lib/cinemeta";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayEpisode } from "@/lib/view";
import type { ModernListProps } from "@/views/play-picker/modern/modern-list";
import { watchPointer } from "@/views/play-picker/modern/pointer-hold";
import {
  act,
  mouse,
  pointer,
  renderModern,
  source,
  type LookProps,
  type Rendered,
} from "./helpers/modern-picker.tsx";

const GB = 1024 ** 3;
const RD = { slug: "rd", name: "Real-Debrid" };
const TB = { slug: "tb", name: "TorBox", queueCache: () => undefined };
const debrids = (...list: unknown[]) => list as ModernListProps["debrids"];
const SHOW = { id: "kitsu:1", type: "series", name: "A Show" } as Meta;
const EPISODE: PlayEpisode = { season: 1, episode: 4, name: "Rescue" };

const film = (file: string, partial: Partial<ScoredStream> = {}) => source(file, partial);

/** In the page's order: ALPHA, BRAVO, CHARLIE, DELTA. */
const four = () => [
  film("A.Film.2020.1080p.WEB-DL.H.264-ALPHA.mkv", { seeders: 20, size: 4 * GB }),
  film("A.Film.2020.2160p.WEB-DL.H.265-BRAVO.mkv", { seeders: 5, size: 24 * GB }),
  film("A.Film.2020.720p.BluRay.x264-CHARLIE.mkv", { seeders: 300, size: 1 * GB }),
  film("A.Film.2020.1080p.BluRay.x264-DELTA.mkv", { seeders: null, size: null }),
];

const rowsArea = () => document.querySelector<HTMLElement>("[data-rows]")!;
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];
const cell = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-cell="${name}"]`)?.textContent ?? null;
const names = () => rows().map((row) => row.querySelector("[data-name]")!.textContent);
const playOf = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("button[data-play]")!;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent!.startsWith(label),
  );
const heading = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-headings] button")].find(
    (b) => b.textContent === label,
  )!;
const orderLine = () => document.querySelector("[data-order]")!.textContent;
const changedLine = () => document.querySelector("[data-changed]")!.textContent || null;

const render = (props: LookProps, options = {}) => renderModern(props, options);
const update = (view: Rendered, streams: ScoredStream[]) =>
  view.rerender({ streams, ranked: streams });

// --- the order -----------------------------------------------------------------------------------

test("the list opens in the page's order and says which one that is", async () => {
  for (const [orderName, says, back] of [
    ["harbor", "In Harbor ranking order.", "Back to Harbor ranking"],
    ["addon", "In addon order.", "Back to addon order"],
    [
      "together",
      "In Watch Together order, the host's source first.",
      "Back to Watch Together order",
    ],
  ] as const) {
    const view = await render({ streams: four(), orderName });
    try {
      assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
      assert.equal(orderLine(), `${says} Click a heading to sort by it.`);
      assert.ok(!button(back));
      await act(() => heading("Size").click());
      assert.ok(button(back), back);
    } finally {
      await view.unmount();
    }
  }
});

test("a heading sorts, sorts the other way, and lets go; unknown values stay last", async () => {
  const view = await render({ streams: four() });
  try {
    await act(() => heading("Seeders").click());
    assert.deepEqual(names(), ["CHARLIE", "ALPHA", "BRAVO", "DELTA"]);
    assert.equal(orderLine(), "Sorted by seeders, most first.");
    assert.deepEqual(view.settings().pickerModernSort, { key: "seeders", dir: "desc" });
    await act(() => heading("Seeders").click());
    assert.deepEqual(names(), ["BRAVO", "ALPHA", "CHARLIE", "DELTA"]);
    assert.equal(orderLine(), "Sorted by seeders, fewest first.");
    await act(() => heading("Seeders").click());
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(view.settings().pickerModernSort, null);
  } finally {
    await view.unmount();
  }
});

test("every heading has its two orders in words", async () => {
  const view = await render({ streams: four() });
  try {
    const said: string[] = [];
    for (const label of ["Release", "Resolution", "Seeders", "Size"]) {
      await act(() => heading(label).click());
      said.push(`${names().join(" ")} | ${orderLine()}`);
      await act(() => heading(label).click());
      said.push(`${names().join(" ")} | ${orderLine()}`);
    }
    assert.deepEqual(said, [
      "ALPHA BRAVO CHARLIE DELTA | Sorted by release, A to Z.",
      "DELTA CHARLIE BRAVO ALPHA | Sorted by release, Z to A.",
      "BRAVO ALPHA DELTA CHARLIE | Sorted by resolution, highest first.",
      "CHARLIE ALPHA DELTA BRAVO | Sorted by resolution, lowest first.",
      "CHARLIE ALPHA BRAVO DELTA | Sorted by seeders, most first.",
      "BRAVO ALPHA CHARLIE DELTA | Sorted by seeders, fewest first.",
      "BRAVO ALPHA CHARLIE DELTA | Sorted by size, largest first.",
      "CHARLIE ALPHA BRAVO DELTA | Sorted by size, smallest first.",
    ]);
  } finally {
    await view.unmount();
  }
});

test("a screen reader is told the order when it changes, and not the hint beside it", async () => {
  const view = await render({ streams: four() });
  try {
    const told = () => document.querySelector('[data-order] [aria-live="polite"]')?.textContent;
    assert.equal(told(), "In Harbor ranking order.");
    await act(() => heading("Size").click());
    assert.equal(told(), "Sorted by size, largest first.");
  } finally {
    await view.unmount();
  }
});

test("the heading in use is marked, and the link above the list goes back", async () => {
  const view = await render(
    { streams: four() },
    { settings: { pickerModernSort: { key: "size", dir: "asc" } } },
  );
  try {
    assert.deepEqual(names(), ["CHARLIE", "ALPHA", "BRAVO", "DELTA"], "the remembered sort");
    assert.equal(heading("Size").getAttribute("aria-pressed"), "true");
    assert.equal(heading("Seeders").getAttribute("aria-pressed"), "false");
    await act(() => button("Back to Harbor ranking")!.click());
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(view.settings().pickerModernSort, null);
    assert.equal(heading("Size").getAttribute("aria-pressed"), "false");
  } finally {
    await view.unmount();
  }
});

test("only what can be sorted has a button for a heading", async () => {
  const view = await render({ streams: four() });
  try {
    const labels = [...document.querySelectorAll("[data-headings] button")].map(
      (b) => b.textContent,
    );
    assert.deepEqual(labels, ["Release", "Resolution", "Seeders", "Size"]);
    assert.match(document.querySelector("[data-headings]")!.textContent!, /Audio.*From/);
  } finally {
    await view.unmount();
  }
});

test("in a room the remembered sort waits for a click on a heading", async () => {
  const view = await render(
    { streams: four(), orderName: "together" },
    { settings: { pickerModernSort: { key: "size", dir: "desc" } } },
  );
  try {
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(heading("Size").getAttribute("aria-pressed"), "false");
    assert.deepEqual(view.settings().pickerModernSort, { key: "size", dir: "desc" }, "kept");
    await act(() => heading("Size").click());
    assert.deepEqual(names(), ["BRAVO", "ALPHA", "CHARLIE", "DELTA"], "largest first");
    await act(() => heading("Size").click());
    assert.deepEqual(names(), ["CHARLIE", "ALPHA", "BRAVO", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

test("a stored sort that is not valid opens the page's order", async () => {
  const view = await render(
    { streams: four() },
    { settings: { pickerModernSort: { key: "date", dir: "asc" } } },
  );
  try {
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.match(orderLine()!, /^In Harbor ranking order/);
  } finally {
    await view.unmount();
  }
});

// --- the filters ---------------------------------------------------------------------------------

test("a filter leaves its rows only, and an empty list says why and how out", async () => {
  const view = await render({ streams: four() });
  try {
    await act(() => view.state().setFilter("resolution", "1080p"));
    assert.deepEqual(names(), ["ALPHA", "DELTA"]);
    await act(() => view.state().setFilter("source", "Remux"));
    assert.deepEqual(names(), []);
    assert.match(document.body.textContent!, /All 4 sources are hidden by the active filter\./);
    await act(() => button("Clear filters")!.click());
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

test("a filtered list is sorted too", async () => {
  const view = await render({ streams: four() });
  try {
    await act(() => heading("Size").click());
    await act(() => view.state().setFilter("source", "BluRay"));
    assert.deepEqual(names(), ["CHARLIE", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

// --- holding still -------------------------------------------------------------------------------

test("while the rows are pointed at none comes, goes or moves, and then the list updates", async () => {
  const streams = four();
  const fresh = film("A.Film.2020.2160p.WEB-DL-ECHO.mkv", { seeders: 900 });
  const view = await render({ streams });
  try {
    await pointer("enter", rowsArea());
    await update(view, [fresh, streams[2], streams[0]]);
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(changedLine(), "The list has changed. Update");
    await pointer("leave", rowsArea());
    assert.deepEqual(names(), ["ECHO", "CHARLIE", "ALPHA"]);
    assert.equal(changedLine(), null);
  } finally {
    await view.unmount();
  }
});

test("rows that come to lie under a mouse nobody moved are not held", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await pointer("rest", rowsArea());
    await update(view, streams.slice(1));
    assert.deepEqual(names(), ["BRAVO", "CHARLIE", "DELTA"]);
    await pointer("rest", rows()[1]);
    await update(view, streams.slice(2));
    assert.deepEqual(names(), ["CHARLIE", "DELTA"]);
    await pointer("enter", rows()[0]);
    await update(view, streams);
    assert.deepEqual(names(), ["CHARLIE", "DELTA"], "they are once it is moved there");
  } finally {
    await view.unmount();
  }
});

test("the first move counts too, which the browser says how far it went", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    const first = new window.MouseEvent("pointermove", { bubbles: true });
    Object.defineProperty(first, "movementY", { value: -3 });
    await act(() => rows()[0].dispatchEvent(first));
    await update(view, streams.slice(1));
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

test("a press and a turn of the wheel are the user's too", async () => {
  for (const type of ["pointerdown", "wheel"]) {
    const streams = four();
    const view = await render({ streams });
    try {
      await pointer("rest", rows()[0]);
      await act(() => mouse(type, rows()[0]));
      await update(view, streams.slice(1));
      assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"], type);
    } finally {
      await view.unmount();
    }
  }
});

test("the rows are let go however the browser says that the mouse is elsewhere", async () => {
  for (const [how, gone] of [
    ["a move elsewhere and nothing else", () => pointer("leave", document.body)],
    [
      "a leave and nothing else",
      () => act(() => mouse("pointerleave", rowsArea(), { bubbles: false })),
    ],
    ["out of the window", () => act(() => mouse("mouseout", rowsArea()))],
  ] as const) {
    const streams = four();
    const view = await render({ streams });
    try {
      await pointer("enter", rows()[1]);
      await update(view, streams.slice(1));
      assert.equal(names().length, 4, how);
      await gone();
      assert.deepEqual(names(), ["BRAVO", "CHARLIE", "DELTA"], how);
    } finally {
      await view.unmount();
    }
  }
});

test("from row to row the mouse stays in the list, which is told once", async () => {
  const told: boolean[] = [];
  const view = await render({ streams: four() });
  const stop = watchPointer(rowsArea(), (on) => told.push(on));
  try {
    await pointer("enter", rows()[0]);
    await act(() => mouse("mouseout", rows()[0], { relatedTarget: rows()[1] }));
    await pointer("enter", rows()[1]);
    assert.deepEqual(told, [true]);
    await pointer("leave", rows()[1]);
    assert.deepEqual(told, [true, false]);
  } finally {
    stop();
    await view.unmount();
  }
});

test("a list that is gone listens to the mouse no longer", async () => {
  const listening = new Map<string, number>();
  const count = (by: number) => (type: string) => {
    listening.set(type, (listening.get(type) ?? 0) + by);
  };
  const { addEventListener, removeEventListener } = window;
  const spied = (note: (type: string) => void, run: typeof addEventListener) =>
    function (this: unknown, ...args: Parameters<typeof addEventListener>) {
      note(args[0]);
      return run.apply(window, args);
    } as typeof addEventListener;
  window.addEventListener = spied(count(1), addEventListener);
  window.removeEventListener = spied(count(-1), removeEventListener as typeof addEventListener);
  try {
    const view = await render({ streams: four() });
    assert.ok((listening.get("pointermove") ?? 0) > 0);
    await view.unmount();
    for (const type of ["pointermove", "pointerdown", "wheel", "mouseout"]) {
      assert.equal(listening.get(type) ?? 0, 0, type);
    }
  } finally {
    Object.assign(window, { addEventListener, removeEventListener });
  }
});

test("a held row the page has dropped still plays", async () => {
  const streams = four();
  const played: unknown[] = [];
  const view = await render({ streams, onPlay: (s) => played.push(s) });
  try {
    await pointer("enter", rowsArea());
    await update(view, [streams[0]]);
    await act(() => playOf(rows()[2]).click());
    assert.deepEqual(played, [streams[2]]);
  } finally {
    await view.unmount();
  }
});

test("a held row plays the newest object of its source and shows its newest facts", async () => {
  const streams = four();
  const played: unknown[] = [];
  const view = await render({ streams, debrids: debrids(RD), onPlay: (s) => played.push(s) });
  try {
    await pointer("enter", rowsArea());
    assert.match(cell(rows()[1], "from")!, /Not cached yet/);
    const fresh = streams.map((s) => ({ ...s, cached: { rd: true } }));
    await update(view, fresh);
    assert.match(cell(rows()[1], "from")!, /Cached on Real-Debrid/);
    assert.equal(changedLine(), null, "the same rows in the same order");
    await act(() => playOf(rows()[1]).click());
    assert.deepEqual(played, [fresh[1]]);
  } finally {
    await view.unmount();
  }
});

test("new facts of a held row do not move it, though it would sort elsewhere", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await act(() => heading("Release").click());
    await pointer("enter", rowsArea());
    const renamed = streams.map((s, i) => (i === 0 ? { ...s, releaseGroup: "ZULU" } : s));
    await update(view, renamed);
    assert.deepEqual(names(), ["ZULU", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(changedLine(), "The list has changed. Update");
    await pointer("leave", rowsArea());
    assert.deepEqual(names(), ["BRAVO", "CHARLIE", "DELTA", "ZULU"]);
  } finally {
    await view.unmount();
  }
});

test("new facts of a held row do not take it away, though a filter would", async () => {
  const streams = four().map((s, i) => ({ ...s, cached: i < 2 ? { rd: true } : {} }));
  const view = await render({ streams, debrids: debrids(RD) });
  try {
    await act(() => view.state().setFilter("availability", "Cached"));
    assert.deepEqual(names(), ["ALPHA", "BRAVO"]);
    await pointer("enter", rowsArea());
    const turned = streams.map((s, i) => ({
      ...s,
      cached: i === 1 || i === 3 ? { rd: true } : {},
    }));
    await update(view, turned);
    assert.deepEqual(names(), ["ALPHA", "BRAVO"]);
    assert.match(cell(rows()[0], "from")!, /Not cached yet/, "with its newest facts");
    await pointer("leave", rowsArea());
    assert.deepEqual(names(), ["BRAVO", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

test("sources the filters hide anyway do not say that the list has changed", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await act(() => view.state().setFilter("resolution", "1080p"));
    await pointer("enter", rowsArea());
    await update(view, [...streams, film("A.Film.2020.2160p.WEB-DL-ECHO.mkv")]);
    assert.equal(changedLine(), null);
  } finally {
    await view.unmount();
  }
});

test("a row that has the focus holds the list, and the list updates when the focus leaves", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await act(() => playOf(rows()[1]).focus());
    await update(view, [streams[1]]);
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    await act(() => playOf(rows()[3]).focus());
    assert.equal(names().length, 4, "from row to row the list stays held");
    await act(() =>
      playOf(rows()[3]).dispatchEvent(
        new window.FocusEvent("focusout", { bubbles: true, relatedTarget: playOf(rows()[0]) }),
      ),
    );
    assert.equal(names().length, 4, "also between the two events of such a step");
    await act(() => heading("Size").focus());
    assert.deepEqual(names(), ["BRAVO"]);
  } finally {
    await view.unmount();
  }
});

test("Update lets the list go while the focus is still in it", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await act(() => playOf(rows()[1]).focus());
    await update(view, [streams[1], streams[0]]);
    await act(() => button("Update")!.click());
    assert.deepEqual(names(), ["BRAVO", "ALPHA"]);
    assert.equal(changedLine(), null);
  } finally {
    await view.unmount();
  }
});

test("a heading and a filter apply at once, also to a held list", async () => {
  const streams = four();
  const fresh = film("A.Film.2020.2160p.WEB-DL-ECHO.mkv", { seeders: 900, size: 90 * GB });
  const view = await render({ streams });
  try {
    await act(() => playOf(rows()[0]).focus());
    await update(view, [...streams, fresh]);
    assert.equal(names().length, 4);
    await act(() => heading("Size").click());
    assert.deepEqual(names(), ["ECHO", "BRAVO", "ALPHA", "CHARLIE", "DELTA"]);
    await update(view, [...streams, fresh, film("A.Film.2020.1080p-FOX.mkv", { size: 500 * GB })]);
    assert.equal(names().length, 5, "and it is held from there");
    await act(() => view.state().setFilter("resolution", "4K"));
    assert.deepEqual(names(), ["ECHO", "BRAVO"]);
  } finally {
    await view.unmount();
  }
});

test("Clear applies at once, also to a held list", async () => {
  const holds = {
    focus: () => act(() => playOf(rows()[0]).focus()),
    mouse: () => pointer("enter", rowsArea()),
  };
  for (const [by, hold] of Object.entries(holds)) {
    const view = await render({ streams: four() });
    try {
      await act(() => view.state().setFilter("resolution", "1080p"));
      await hold();
      assert.deepEqual(names(), ["ALPHA", "DELTA"], by);
      await act(() => button("Clear")!.click());
      assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"], by);
      assert.equal(changedLine(), null, "nothing is left to update");
    } finally {
      await view.unmount();
    }
  }
});

test("an order nobody asked for waits for a held list, as when the host leaves the room", async () => {
  const view = await render(
    { streams: four(), orderName: "together" },
    { settings: { pickerModernSort: { key: "size", dir: "desc" } } },
  );
  try {
    await pointer("enter", rowsArea());
    await view.rerender({ orderName: "addon" });
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.equal(changedLine(), "The list has changed. Update");
    await pointer("leave", rowsArea());
    assert.deepEqual(names(), ["BRAVO", "ALPHA", "CHARLIE", "DELTA"]);
  } finally {
    await view.unmount();
  }
});

const BY_SIZE = { settings: { pickerModernSort: { key: "size", dir: "desc" } } };
const pressed = () =>
  ["Release", "Resolution", "Seeders", "Size"].filter(
    (label) => heading(label).getAttribute("aria-pressed") === "true",
  );

test("while a held list waits, the order that is shown is named and not the one that comes", async () => {
  const view = await render({ streams: four(), orderName: "together" }, BY_SIZE);
  try {
    const shown = "In Watch Together order, the host's source first.";
    assert.equal(orderLine(), `${shown} Click a heading to sort by it.`);
    await pointer("enter", rowsArea());
    await view.rerender({ orderName: "addon" });
    assert.equal(orderLine(), shown);
    assert.deepEqual(pressed(), [], "the headings show the same order");
    assert.ok(!button("Back to"));
    await view.rerender({ pipelineDone: false });
    assert.equal(orderLine(), shown, "for as long as it waits");
    await act(() => button("Update")!.click());
    assert.equal(orderLine(), "Sorted by size, largest first.");
    assert.deepEqual(pressed(), ["Size"]);
  } finally {
    await view.unmount();
  }
});

test("a sort that a room's order takes over is named until the list lets go", async () => {
  const view = await render({ streams: four() }, BY_SIZE);
  try {
    await pointer("enter", rowsArea());
    await view.rerender({ orderName: "together" });
    assert.deepEqual(names(), ["BRAVO", "ALPHA", "CHARLIE", "DELTA"]);
    assert.equal(orderLine(), "Sorted by size, largest first.");
    assert.deepEqual(pressed(), ["Size"]);
    assert.ok(button("Back to Watch Together order"), "the link says where it leads");
    await pointer("leave", rowsArea());
    assert.deepEqual(names(), ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    assert.match(orderLine()!, /^In Watch Together order/);
    assert.deepEqual(pressed(), []);
  } finally {
    await view.unmount();
  }
});

test("a click on a heading goes on from the order that is shown, also while another one waits", async () => {
  const view = await render({ streams: four(), orderName: "together" }, BY_SIZE);
  try {
    await pointer("enter", rowsArea());
    await view.rerender({ orderName: "addon" });
    await act(() => heading("Size").click());
    assert.deepEqual(names(), ["BRAVO", "ALPHA", "CHARLIE", "DELTA"]);
    assert.equal(orderLine(), "Sorted by size, largest first.", "its first click, not its second");
  } finally {
    await view.unmount();
  }
});

test("a list whose rows stand as the new order wants them names the new order at once", async () => {
  const [alpha, bravo] = four();
  const view = await render({ streams: [bravo, alpha], orderName: "together" }, BY_SIZE);
  try {
    await pointer("enter", rowsArea());
    await view.rerender({ orderName: "harbor" });
    assert.equal(changedLine(), null);
    assert.equal(orderLine(), "Sorted by size, largest first.");
  } finally {
    await view.unmount();
  }
});

test("a source that waits for a held list does not change the order that is named", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    await pointer("enter", rowsArea());
    await update(view, [...streams, film("A.Film.2020.1080p-ECHO.mkv")]);
    assert.equal(changedLine(), "The list has changed. Update");
    assert.equal(orderLine(), "In Harbor ranking order.");
    await act(() => heading("Seeders").click());
    assert.equal(orderLine(), "Sorted by seeders, most first.");
    await update(view, [...streams, film("A.Film.2020.1080p-FOX.mkv", { seeders: 900 })]);
    assert.equal(changedLine(), "The list has changed. Update");
    assert.equal(orderLine(), "Sorted by seeders, most first.", "and from there the sorted one");
  } finally {
    await view.unmount();
  }
});

test("Cached only and the source mode apply at once, also to a held list", async () => {
  const streams = four();
  const cached = [streams[1]];
  const view = await renderModern(
    { streams, isCached: (s) => s === streams[1], debrids: debrids(RD) },
    {
      shell: { onCachedOnly: () => void view.rerender({ streams: cached }, { cachedOnly: true }) },
    },
  );
  try {
    await act(() => playOf(rows()[0]).focus());
    await act(() => button("Cached only")!.click());
    assert.deepEqual(names(), ["BRAVO"]);
    await act(() => playOf(rows()[0]).focus());
    await view.rerender({ streams: [streams[2], streams[1]] });
    assert.deepEqual(names(), ["BRAVO"], "and it is held from there");
    await view.update({ streamMode: "p2p" });
    assert.deepEqual(names(), ["CHARLIE", "BRAVO"]);
  } finally {
    await view.unmount();
  }
});

test("while the rows are pointed at the pick above them does not change either", async () => {
  const streams = four();
  const sentence = () => document.querySelector("[data-pick-sentence]")!.textContent!;
  const view = await render({ streams });
  try {
    await pointer("enter", rowsArea());
    await view.rerender({ preferred: streams[1] });
    assert.match(sentence(), /ALPHA/);
    await pointer("leave", rowsArea());
    assert.match(sentence(), /BRAVO/);
  } finally {
    await view.unmount();
  }
});

// --- what holds the rows in their place ----------------------------------------------------------

/** jsdom lays nothing out: this page has a banner above the list and a scroll range of its own. */
async function inScroller(
  longest: number,
  run: (page: {
    banner: (height: number) => Promise<void>;
    view: Rendered;
    scrolled: () => number;
    /** Where the first row stands on the screen. */
    rowTop: () => number;
  }) => Promise<void>,
) {
  const main = document.createElement("main");
  const root = document.getElementById("root")!;
  root.parentElement!.insertBefore(main, root);
  main.appendChild(root);
  const px = (value: string | undefined) => Number.parseFloat(value || "0");
  let scrollTop = 0;
  Object.defineProperty(main, "clientHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(main, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (to: number) => {
      const most = longest + px(rowsArea().style.marginBottom);
      scrollTop = Math.min(most, Math.max(0, to));
    },
  });
  const own = Element.prototype.getBoundingClientRect;
  const rowTop = () =>
    400 +
    px(document.querySelector<HTMLElement>("[data-banner]")?.dataset.banner) +
    px(rowsArea()?.style.marginTop) -
    scrollTop;
  const heightOf = (row: Element) => (row.hasAttribute("data-failed") ? 50 : 70);
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.closest("[data-row]");
    const above = row ? rows().slice(0, rows().indexOf(row as HTMLElement)) : [];
    const top = rowTop() + above.reduce((sum, other) => sum + heightOf(other), 0);
    return { ...own.call(this), top, bottom: top + 70, height: 70 } as DOMRect;
  };
  let height = 0;
  const view = await render(
    { streams: four() },
    {
      body: (list: ReactNode) => (
        <>
          <div data-banner={height} />
          {list}
        </>
      ),
    },
  );
  const banner = async (next: number) => {
    height = next;
    await view.rerender();
  };
  try {
    await run({ banner, view, scrolled: () => scrollTop, rowTop });
  } finally {
    Element.prototype.getBoundingClientRect = own;
    await view.unmount();
    main.replaceWith(root);
  }
}

test("a change above the held rows is taken up by the scroll position", () =>
  inScroller(1000, async ({ banner, scrolled, rowTop }) => {
    await pointer("enter", rows()[1]);
    const place = rowTop();
    await banner(60);
    assert.equal(scrolled(), 60);
    await banner(90);
    assert.equal(scrolled(), 90);
    await banner(20);
    assert.equal(scrolled(), 20);
    assert.equal(rowTop(), place, "the row under the pointer has not moved");
  }));

test("it is the row under the pointer, or the one with the focus, that keeps its place", () =>
  inScroller(1000, async ({ view, scrolled }) => {
    const streams = four();
    await update(view, streams);
    await pointer("enter", rows()[2]);
    await view.rerender({ failedStreams: new Set([streams[0]]) });
    assert.equal(rowsArea().style.marginTop, "20px", "a row above it got lower");
    await pointer("leave", rows()[2]);
    await act(() => playOf(rows()[2]).focus());
    await view.rerender({ failedStreams: new Set() });
    assert.equal(scrolled(), 20, "and higher again");
    await view.rerender({ failedStreams: new Set([streams[3]]) });
    assert.equal(scrolled(), 20, "what changes below it does not matter");
  }));

test("what the page cannot scroll becomes room above or below the rows until they are let go", () =>
  inScroller(0, async ({ banner, scrolled, rowTop }) => {
    await banner(50);
    await pointer("enter", rows()[1]);
    const place = rowTop();
    await banner(20);
    assert.equal(rowsArea().style.marginTop, "30px", "nothing is left to scroll back");
    assert.equal(rowTop(), place);
    await banner(40);
    assert.equal(rowsArea().style.marginTop, "10px", "room is given back first");
    assert.equal(rowTop(), place);
    await banner(70);
    assert.equal(rowsArea().style.marginTop, "");
    assert.equal(scrolled(), 20, "a page that is too short gets longer");
    assert.equal(rowTop(), place);
    await pointer("leave", rows()[1]);
    assert.equal(rowsArea().style.marginTop, "");
    assert.equal(rowsArea().style.marginBottom, "");
  }));

test("a list that is not held is left where the page puts it, and so is one that was sorted", () =>
  inScroller(1000, async ({ banner, scrolled }) => {
    await banner(60);
    assert.equal(scrolled(), 0);
    await pointer("enter", rows()[1]);
    document.querySelector<HTMLElement>("[data-banner]")!.dataset.banner = "10";
    await act(() => heading("Size").click());
    assert.equal(scrolled(), 0, "the row under the pointer has gone elsewhere");
  }));

// --- rows ----------------------------------------------------------------------------------------

test("a row keeps its element when the list is sorted or grows", async () => {
  const streams = four();
  const view = await render({ streams });
  try {
    const alpha = rows()[0];
    await act(() => heading("Seeders").click());
    assert.ok(rows()[1] === alpha);
    await update(view, [film("A.Film.2020.1080p-ECHO.mkv", { seeders: 999 }), ...streams]);
    assert.ok(rows()[2] === alpha);
  } finally {
    await view.unmount();
  }
});

test("pointing at the list redraws no row, and one that got newer facts is redrawn alone", async () => {
  const streams = four();
  const drawn: string[] = [];
  const watched = (stream: ScoredStream) =>
    Object.defineProperty({ ...stream }, "edition", {
      enumerable: true,
      get: () => {
        // React asks as well, to log what changed.
        if (new Error().stack!.includes("EditionChip")) drawn.push(stream.releaseGroup!);
        return null;
      },
    });
  const list = streams.map(watched);
  const view = await render({ streams: list, onPlay: () => {} });
  try {
    assert.deepEqual(drawn, ["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    drawn.length = 0;
    await pointer("enter", rowsArea());
    await act(() => playOf(rows()[0]).focus());
    await view.rerender({ streams: [...list], onPlay: () => {}, pipelineDone: false });
    assert.deepEqual(drawn, []);
    await act(() => heading("Size").click());
    assert.deepEqual(drawn, [], "nor does a sort, though it is saved with the settings");
    await update(view, [list[0], watched({ ...streams[1], seeders: 6 }), list[2], list[3]]);
    assert.deepEqual(new Set(drawn), new Set(["BRAVO"]));
  } finally {
    await view.unmount();
  }
});

test("links to outside pages are told apart though an add-on says the same of them", async () => {
  const outside = (name: string, partial: Partial<ScoredStream>) =>
    film("Subscription", {
      behaviorHints: undefined,
      infoHash: undefined,
      releaseGroup: null,
      name,
      ...partial,
    });
  for (const streams of [
    [
      outside("Netflix", { externalUrl: "https://one.test" }),
      outside("Prime", { externalUrl: "https://two.test" }),
    ],
    [outside("Trailer", { ytId: "one" }), outside("Teaser", { ytId: "two" })],
  ]) {
    const view = await render({
      streams,
      preferred: streams[1],
      failedStreams: new Set([streams[0]]),
    });
    try {
      const says = (what: string) => rows().map((row) => row.textContent!.includes(what));
      assert.deepEqual(says("Harbor's pick"), [false, true]);
      assert.deepEqual(says("Unavailable"), [true, false]);
    } finally {
      await view.unmount();
    }
  }
});

test("two rows of one identity are two rows", async () => {
  const problems: unknown[] = [];
  const own = console.error;
  console.error = (...args) => problems.push(args[0]);
  const twin = film("A.Film.2020.1080p-ALPHA.mkv");
  const view = await render({ streams: [twin, { ...twin }, film("A.Film.2020.1080p-BRAVO.mkv")] });
  try {
    assert.deepEqual(names(), ["ALPHA", "ALPHA", "BRAVO"]);
    assert.deepEqual(problems, []);
  } finally {
    console.error = own;
    await view.unmount();
  }
});

test("one torrent from two installations or behind two links gives rows that are told apart", async () => {
  const a = film("A.Film.2020.1080p-ALPHA.mkv", { addonUrl: "https://one.test" });
  for (const b of [
    { ...a, addonUrl: "https://two.test" },
    { ...a, url: "https://one.test/link" },
  ]) {
    const played: unknown[] = [];
    const view = await render({ streams: [a, b], onPlay: (s) => played.push(s) });
    try {
      await pointer("enter", rowsArea());
      const fresh = [{ ...b }, { ...a }];
      await update(view, fresh);
      await act(() => playOf(rows()[0]).click());
      assert.equal(played[0], fresh[1]);
    } finally {
      await view.unmount();
    }
  }
});

test("a row says everything the source said", async () => {
  const streams = [
    film("A.Film.2020.2160p.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.7.1-ALPHA.mkv", {
      seeders: 1234,
      size: 79.4 * GB,
      hdrFormat: "DV+HDR10",
      audioLanguages: ["English", "French", "German", "Spanish", "Italian"],
      cached: { rd: true },
    }),
  ];
  const view = await render({ streams, debrids: debrids(RD) });
  try {
    const row = rows()[0];
    assert.equal(cell(row, "resolution"), "4KDVHDR10Remux, HEVC");
    assert.equal(cell(row, "seeders"), (1234).toLocaleString());
    assert.equal(cell(row, "size"), "79.40 GB");
    assert.equal(cell(row, "audio"), "TrueHD 7.1+2 more");
    assert.equal(
      row.querySelectorAll('[data-cell="audio"] img, [data-cell="audio"] .fi').length,
      3,
    );
    assert.equal(cell(row, "from"), "TorrentioCached on Real-Debrid");
    assert.equal(
      row.querySelector("[data-file]")!.textContent,
      "A.Film.2020.2160p.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.7.1-ALPHA.mkv",
    );
  } finally {
    await view.unmount();
  }
});

test("a source with nothing known has empty cells and still a name", async () => {
  const bare = source("", {
    name: "Comet",
    title: "",
    behaviorHints: undefined,
    addonName: "Comet",
  });
  const view = await render({ streams: [bare] });
  try {
    const row = rows()[0];
    assert.deepEqual(names(), ["Comet"]);
    for (const name of ["resolution", "seeders", "size", "audio"]) {
      assert.equal(cell(row, name), "", name);
    }
    assert.ok(!row.querySelector("[data-file]"));
    await update(view, [{ ...bare, seeders: -1, size: 0 }]);
    assert.equal(cell(rows()[0], "seeders"), "", "below nothing is not known");
    assert.equal(cell(rows()[0], "size"), "", "no size is not known");
  } finally {
    await view.unmount();
  }
});

test("the bar of the seeders shows their share of the most any source has", async () => {
  const counts = [2000, 1000, 300, 299, 100, 99, 3, 0];
  const view = await render({
    streams: counts.map((seeders) => film("A.Film.2020.1080p-ALPHA.mkv", { seeders })),
  });
  try {
    const bars = rows().map((row) => {
      const bar = row.querySelector<HTMLElement>('[data-cell="seeders"] [style]')!;
      return `${bar.style.width} ${/bg-(\S+)/.exec(bar.className)![1]}`;
    });
    assert.deepEqual(bars, [
      "100% success",
      "50% success",
      "15% success",
      "15% accent",
      "5% accent",
      "5% ink-subtle",
      "4% ink-subtle",
      "0% ink-subtle",
    ]);
  } finally {
    await view.unmount();
  }
});

test("a source without even a label is called Source", async () => {
  const bare = source("", { name: "", title: "", behaviorHints: undefined, addonName: "" });
  const view = await render({ streams: [bare] });
  try {
    assert.deepEqual(names(), ["Source"]);
  } finally {
    await view.unmount();
  }
});

test("without a believable group the file name is the first line and is not repeated", async () => {
  const view = await render({ streams: [film("A.Film.2020.1080p.WEB-DL.mkv")] });
  try {
    const name = rows()[0].querySelector<HTMLElement>("[data-name]")!;
    assert.equal(name.textContent, "A.Film.2020.1080p.WEB-DL.mkv");
    assert.ok(name.classList.contains("font-mono"));
    assert.ok(!rows()[0].querySelector("[data-file]"));
  } finally {
    await view.unmount();
  }
});

test("what the add-on says in its own words stands under its label, unless it is the same", async () => {
  const says = { behaviorHints: undefined, infoHash: undefined, releaseGroup: null };
  const view = await render({
    streams: [
      film("Subscription", { ...says, name: "Netflix", externalUrl: "https://watch.test" }),
      film("Plugin", { ...says, name: "Plugin", url: "https://play.test" }),
    ],
  });
  try {
    assert.deepEqual(names(), ["Netflix", "Plugin"]);
    const words = rows().map((row) => row.querySelector("[data-words]"));
    assert.equal(words[0]?.textContent, "Subscription");
    assert.ok(words[0] && !words[0].classList.contains("font-mono"));
    assert.ok(words[1] === null, "the same words twice");
    assert.ok(rows().every((row) => row.querySelector("[data-file]") === null));
  } finally {
    await view.unmount();
  }
});

test("what the add-on says in its own words is shown whole or cut, as the setting says, and of a web page one line", async () => {
  const says = { behaviorHints: undefined, infoHash: undefined, releaseGroup: null };
  const streams = [
    film("First words\n\nThe second line\n  And a third ", {
      ...says,
      name: "Label",
      url: "https://play.test/1",
    }),
    film("Plugin\nMore of it\nThe end", { ...says, name: "Plugin", url: "https://play.test/2" }),
    film("Page\nFirst\nSecond", { ...says, name: "Page", externalUrl: "https://watch.test" }),
  ];
  for (const [fullStreamDescription, ...expected] of [
    [true, ["First words", "The second line", "And a third"], ["More of it", "The end"], ["First"]],
    [false, ["First words"], ["More of it"], ["First"]],
  ] as const) {
    const view = await render({ streams }, { settings: { fullStreamDescription } });
    try {
      const words = rows().map((row) => [...row.querySelectorAll("[data-words] > *")]);
      assert.deepEqual(
        words.map((lines) => lines.map((line) => line.textContent)),
        expected,
      );
      for (const line of words.flat()) {
        assert.equal(line.getAttribute("dir"), "auto", "each in its own direction");
        assert.equal(line.classList.contains("truncate"), !fullStreamDescription);
        assert.equal(line.classList.contains("[overflow-wrap:anywhere]"), fullStreamDescription);
      }
      assert.deepEqual(
        rows().map((row) => playOf(row).getAttribute("title")),
        fullStreamDescription ? [null, null, null] : ["First words", "More of it", "First"],
        "what may be cut can be read in full at the row",
      );
    } finally {
      await view.unmount();
    }
  }
});

test("a row without a file name shows every line of the add-on's label", async () => {
  const says = { behaviorHints: undefined, infoHash: undefined, releaseGroup: null };
  const streams = [
    film("First words\nThe second line", {
      ...says,
      name: "Label\nNot ready\n★ 44 peers",
      url: "https://play.test/1",
    }),
    film("A.Film.2020.1080p-ALPHA.mkv", { name: "Label\nNot ready" }),
    film("Plugin", { ...says, name: "Plugin", url: "https://play.test/3" }),
  ];
  for (const [fullStreamDescription, ...expected] of [
    [true, "Not ready", "★ 44 peers", "First words", "The second line"],
    [false, "Not ready", "★ 44 peers", "First words"],
  ] as const) {
    const view = await render({ streams }, { settings: { fullStreamDescription } });
    try {
      assert.deepEqual(names(), ["Label", "ALPHA", "Plugin"]);
      const words = rows().map((row) => [...row.querySelectorAll("[data-words] > *")]);
      assert.deepEqual(
        words.map((lines) => lines.map((line) => line.textContent)),
        [expected, [], []],
        "with a file name the row says that",
      );
      assert.deepEqual(
        rows().map((row) => playOf(row).getAttribute("title")),
        fullStreamDescription
          ? [null, null, null]
          : [expected.join("\n"), "A.Film.2020.1080p-ALPHA.mkv", null],
        "what may be cut can be read in full at the row",
      );
    } finally {
      await view.unmount();
    }
  }
});

test("a source with a file name shows that and none of the add-on's words", async () => {
  const view = await render({
    streams: [
      film("A.Film.2020.1080p-ALPHA.mkv", {
        title: "A.Film.2020.1080p-ALPHA.mkv\nMore words\n👤 3 💾 2 GB",
      }),
      film("A.Film.2020.1080p.WEB-DL.mkv", { title: "A.Film.2020.1080p.WEB-DL.mkv\nMore words" }),
    ],
  });
  try {
    assert.deepEqual(names(), ["ALPHA", "A.Film.2020.1080p.WEB-DL.mkv"]);
    assert.ok(!document.querySelector("[data-words]"));
  } finally {
    await view.unmount();
  }
});

test("a file name is shown in full or on one line, as the setting for descriptions says", async () => {
  const long = `A.Film.2020.${"Very.Long.".repeat(20)}1080p`;
  const streams = [film(`${long}-ALPHA.mkv`), film(`${long}.WEB-DL.mkv`)];
  for (const fullStreamDescription of [true, false]) {
    const view = await render({ streams }, { settings: { fullStreamDescription } });
    try {
      const under = rows()[0].querySelector<HTMLElement>("[data-file]")!;
      const first = rows()[1].querySelector<HTMLElement>("[data-name]")!;
      for (const element of [under, first]) {
        assert.equal(element.classList.contains("truncate"), !fullStreamDescription);
        assert.equal(
          element.classList.contains("[overflow-wrap:anywhere]"),
          fullStreamDescription,
          "a long name never makes a row wider than the list",
        );
        assert.equal(
          element.querySelector("wbr") !== null,
          fullStreamDescription,
          "a whole name breaks behind its words first",
        );
      }
      assert.ok(under.textContent!.startsWith(long), "the whole name is there in both");
      assert.deepEqual(
        rows().map((row) => playOf(row).getAttribute("title")),
        fullStreamDescription ? [null, null] : [`${long}-ALPHA.mkv`, `${long}.WEB-DL.mkv`],
      );
    } finally {
      await view.unmount();
    }
  }
});

test("an anime row has its sub or dub mark, following the setting", async () => {
  const streams = [
    film("[A] A Show - 04 (1080p).mkv", { audioLanguages: ["English", "Japanese"] }),
  ];
  const props = { streams, meta: SHOW, episode: EPISODE, isAnime: true };
  const on = await render(props);
  try {
    assert.match(cell(rows()[0], "audio")!, /^DUAL/);
  } finally {
    await on.unmount();
  }
  const off = await render(props, { settings: { showDubBadge: false } });
  try {
    assert.doesNotMatch(rows()[0].textContent!, /DUAL/);
  } finally {
    await off.unmount();
  }
});

test("Atmos is a mark of its own", async () => {
  const atmos = film("A.Film.2020.2160p.WEB-DL.Atmos.H.265-ALPHA.mkv", {
    audio: { codec: "Atmos", channels: 8 },
  });
  const view = await render({ streams: [atmos] });
  try {
    assert.match(cell(rows()[0], "audio")!, /^7\.1ATMOS/);
  } finally {
    await view.unmount();
  }
});

test("Atmos beside another codec is the same mark, behind it", async () => {
  const view = await render({
    streams: [
      film("A.Film.2020.2160p.WEB-DL.DDP5.1.Atmos.H.265-ALPHA.mkv"),
      film("A.Film.2020.2160p.BluRay.TrueHD.7.1.Atmos-BRAVO.mkv"),
      film("A.Film.2020.2160p.WEB-DL.DDP5.1.H.265-CHARLIE.mkv"),
    ],
  });
  try {
    const sounds = rows().map((row) => cell(row, "audio"));
    assert.deepEqual(sounds, ["DD+ 5.1ATMOS", "TrueHD 7.1ATMOS", "DD+ 5.1"]);
  } finally {
    await view.unmount();
  }
});

test("with no room for the audio column its mark stands next to the name", async () => {
  const marks = () =>
    rows().map(
      (row) =>
        row.querySelector('[data-release] [class*="928px]/list:hidden"]')?.textContent ?? null,
    );
  const audio = (codec: string, channels: number, audioLanguages: string[] = []) =>
    film("A.Film.2020.1080p-ALPHA.mkv", {
      audio: { codec, channels } as ScoredStream["audio"],
      audioLanguages,
    });
  const view = await render({
    streams: [
      audio("DD+", 6),
      audio("Atmos", 8),
      audio("Atmos", 2),
      audio("Other", 2),
      film("A.Film.2020.2160p.WEB-DL.DDP5.1.Atmos.H.265-ALPHA.mkv"),
    ],
  });
  try {
    assert.deepEqual(marks(), ["DD+ 5.1", "Atmos 7.1", "Atmos", null, "DD+ 5.1 Atmos"]);
  } finally {
    await view.unmount();
  }
  const anime = await render({
    streams: [audio("AAC", 2, ["Japanese"]), audio("AAC", 2)],
    meta: SHOW,
    episode: EPISODE,
    isAnime: true,
  });
  try {
    assert.deepEqual(marks(), ["SUB", "AAC"]);
  } finally {
    await anime.unmount();
  }
});

test("the marks of a row: the pick, played last, batch, edition and the host's source", async () => {
  const streams = [
    film("A.Show.S01.1080p.WEB-DL-ALPHA.mkv", { seasonPack: true, edition: "Extended" }),
    film("A.Show.S01E04.1080p.WEB-DL-BRAVO.mkv"),
  ];
  const view = await render({
    streams,
    meta: SHOW,
    episode: EPISODE,
    lastPlayedStream: streams[1],
    matchFor: (s) => (s === streams[0] ? "same" : "close"),
  });
  try {
    const marks = rows().map((row) => row.querySelector("[data-release]")!.textContent!);
    assert.match(marks[0], /Harbor's pick/);
    assert.match(marks[0], /Batch/);
    assert.match(marks[0], /Extended/);
    assert.match(marks[0], /Same file/);
    assert.doesNotMatch(marks[0], /Played last/);
    assert.match(marks[1], /Played last/);
    assert.match(marks[1], /Close match/);
    assert.doesNotMatch(marks[1], /Harbor's pick|Batch/);
  } finally {
    await view.unmount();
  }
});

test("a film's source is never called a batch", async () => {
  const view = await render({ streams: [film("A.Film.1080p-ALPHA.mkv", { seasonPack: true })] });
  try {
    assert.doesNotMatch(rows()[0].textContent!, /Batch/);
  } finally {
    await view.unmount();
  }
});

test("played last and the pick are found on fresh objects too", async () => {
  const streams = four();
  const view = await render({ streams, lastPlayedStream: streams[2] });
  try {
    await view.rerender({ streams: streams.map((s) => ({ ...s })) });
    assert.match(rows()[2].textContent!, /Played last/);
    assert.match(rows()[0].textContent!, /Harbor's pick/);
  } finally {
    await view.unmount();
  }
});

test("a source that failed says so and steps back, and can be tried again", async () => {
  const streams = four();
  const played: unknown[] = [];
  const view = await render({ streams, onPlay: (s) => played.push(s) });
  try {
    await view.rerender({ failedStreams: new Set([streams[1]]) });
    const row = rows()[1];
    assert.match(row.textContent!, /Unavailable, try another\./);
    const failed = () => rows().map((r) => r.hasAttribute("data-failed"));
    assert.deepEqual(failed(), [false, true, false, false]);
    assert.deepEqual(
      rows().map((r) => playOf(r).getAttribute("aria-label")),
      [
        "Play ALPHA 1080p",
        "Play BRAVO 4K. Unavailable, try another.",
        "Play CHARLIE 720p",
        "Play DELTA 1080p",
      ],
      "who goes from button to button hears it too",
    );
    assert.equal(playOf(row).getAttribute("aria-disabled"), null);
    assert.doesNotMatch(
      row.querySelector('[data-cell="actions"]')!.className,
      /opacity-45/,
      "a control that works does not look as if it was off",
    );
    await act(() => playOf(row).click());
    assert.deepEqual(played, [streams[1]]);
    await view.rerender({ streams: streams.map((s) => ({ ...s })) });
    assert.deepEqual(
      failed(),
      [false, true, false, false],
      "every partial result brings new objects",
    );
  } finally {
    await view.unmount();
  }
});

test("the state of a source is said in Harbor's words", async () => {
  const cases: [Partial<ScoredStream>, Partial<ModernListProps>, string][] = [
    [{ inLibrary: { rd: true }, cached: { rd: true } }, {}, "In your Real-Debrid library"],
    [{ cached: { rd: true, tb: true } }, {}, "Cached on Real-Debrid + TorBox"],
    [{ cached: { ad: true } }, {}, "Cached"],
    [{}, {}, "Not cached yet"],
    [{}, { debrids: debrids() }, ""],
    [{ infoHash: undefined, url: "https://x.test/a" }, {}, ""],
    [{ infoHash: undefined, url: "https://x.test/a" }, { debrids: debrids() }, ""],
    [{ infoHash: undefined, externalUrl: "https://x.test/a" }, {}, "External"],
    ...[
      { name: "[RD download] Torrentio" },
      { name: "Comet\n⏳ TorBox" },
      { title: "Words\n⬇ TB" },
      { description: "uncached" },
    ].flatMap((says): [Partial<ScoredStream>, Partial<ModernListProps>, string][] => {
      const link = { ...says, infoHash: undefined, url: "https://x.test/a" };
      return [
        [link, {}, "Not cached yet"],
        [link, { debrids: debrids() }, "Not cached yet"],
        [{ ...link, infoHash: "a".repeat(40) }, {}, "Not cached yet"],
        [{ ...link, cached: { rd: true } }, {}, "Cached on Real-Debrid"],
        [{ ...says, infoHash: "a".repeat(40) }, { debrids: debrids() }, ""],
        [{ ...link, url: undefined, externalUrl: "https://x.test/a" }, {}, "External"],
      ];
    }),
  ];
  for (const [partial, props, expected] of cases) {
    const stream = film("A.Film.2020.1080p-ALPHA.mkv", partial);
    const view = await render({ streams: [stream], debrids: debrids(RD, TB), ...props });
    try {
      assert.equal(cell(rows()[0], "from"), `Torrentio${expected}`);
    } finally {
      await view.unmount();
    }
  }
  const queued = film("A.Film.2020.1080p-ALPHA.mkv");
  const view = await render({
    streams: [queued],
    debrids: debrids(RD, TB),
    queuedHash: queued.infoHash!,
  });
  try {
    assert.equal(cell(rows()[0], "from"), "TorrentioQueued on TorBox");
  } finally {
    await view.unmount();
  }
});

test("the state of a source may take two lines, and its sign stays with the first", async () => {
  const stream = film("A.Film.2020.1080p-ALPHA.mkv", { cached: { rd: true, tb: true } });
  const view = await render({ streams: [stream], debrids: debrids(RD, TB) });
  try {
    const [sign, words] = rows()[0].querySelector('[data-cell="from"] p')!.children;
    assert.ok(sign.querySelector("svg"));
    assert.equal(words.textContent, "Cached on Real-Debrid + TorBox");
    assert.ok(words.classList.contains("line-clamp-2"));
    assert.ok(words.classList.contains("[overflow-wrap:anywhere]"), "a long word breaks");
    assert.ok(sign.parentElement!.classList.contains("items-start"));
  } finally {
    await view.unmount();
  }
});

test("the play button plays its row through the page and has a name of its own", async () => {
  const streams = four();
  const played: unknown[] = [];
  const view = await render({ streams, onPlay: (s) => played.push(s) });
  try {
    const labels = rows().map((row) => playOf(row).getAttribute("aria-label"));
    assert.deepEqual(labels, [
      "Play ALPHA 1080p",
      "Play BRAVO 4K",
      "Play CHARLIE 720p",
      "Play DELTA 1080p",
    ]);
    await act(() => heading("Size").click());
    await act(() => playOf(rows()[0]).click());
    assert.deepEqual(played, [streams[1]]);
  } finally {
    await view.unmount();
  }
});

test("the flags and the add-on's logo lie over the stretched button, and a click there plays too", async () => {
  const streams = [
    film("A.Film.2020.1080p-ALPHA.mkv", { audioLanguages: ["English", "German"] }),
    film("A.Film.2020.1080p-BRAVO.mkv", { audioLanguages: ["English"] }),
  ];
  const played: unknown[] = [];
  const view = await render({ streams, onPlay: (s) => played.push(s) });
  try {
    for (const [at, row] of rows().entries()) {
      const marked = [...row.querySelectorAll<HTMLElement>("[title]")].filter(
        (element) => !element.closest('[data-cell="actions"]'),
      );
      const languages = streams[at].audioLanguages;
      assert.deepEqual(
        marked.map((element) => element.title),
        [...languages, "Torrentio"],
        "what has a tooltip",
      );
      for (const element of marked) {
        const over = element.closest<HTMLElement>(".z-10");
        assert.ok(over?.classList.contains("relative"), element.title);
        assert.ok(!over!.closest('button, a, [tabindex], [role="button"]'));
        played.length = 0;
        await act(() => element.click());
        assert.deepEqual(played, [streams[at]], `${element.title}: once`);
      }
    }
    await view.rerender({ failedStreams: new Set([streams[0]]) });
    const faded = [...rows()[0].querySelectorAll<HTMLElement>("[data-cell].opacity-45")];
    assert.equal(faded.length, 5);
    for (const cell of faded) {
      // Its opacity would keep what is in it under the stretched button.
      for (const way of ["relative", "z-10", "pointer-events-none"]) {
        assert.ok(cell.classList.contains(way), `${cell.dataset.cell}: ${way}`);
      }
    }
    const over = faded.flatMap((cell) => [...cell.querySelectorAll("[title]")]);
    assert.equal(over.length, 3);
    for (const element of over) assert.ok(element.closest(".pointer-events-auto"), "can be found");
  } finally {
    await view.unmount();
  }
});

test("a row plays through the page's newest handler", async () => {
  const played: string[] = [];
  const view = await render({ streams: four(), onPlay: () => played.push("older") });
  try {
    await view.rerender({ onPlay: () => played.push("newer") });
    await act(() => playOf(rows()[0]).click());
    assert.deepEqual(played, ["newer"]);
  } finally {
    await view.unmount();
  }
});

test("no control stands inside another, and every one of them can be reached", async () => {
  const view = await render({ streams: four(), debrids: debrids(RD) });
  try {
    const controls = [
      ...document.querySelectorAll<HTMLElement>('a[href], button, [tabindex], [role="button"]'),
    ];
    assert.ok(controls.length > 20);
    for (const control of controls) {
      assert.ok(!control.parentElement!.closest('a[href], button, [tabindex], [role="button"]'));
      assert.equal(
        /(^|\s)opacity-0(\s|$)/.test(control.className),
        false,
        "a control at opacity 0 is skipped",
      );
    }
    for (const row of rows()) {
      assert.equal(row.querySelectorAll("button[data-play]").length, 1);
      assert.ok(
        playOf(row).classList.contains("no-press"),
        "Harbor's press effect scales a button, and a scaled one no longer covers its row",
      );
      const copy = [...row.querySelectorAll('[role="button"]')];
      assert.equal(copy.length, 1, "copy link");
      const around = copy[0].parentElement!.classList;
      assert.ok(around.contains("opacity-0"), "it fades with what is around it");
      assert.ok(around.contains("group-focus-within/row:opacity-100"));
      assert.ok(around.contains("z-10"), "and stays above the stretched play button");
      assert.equal(row.getAttribute("tabindex"), null);
      assert.equal(row.getAttribute("role"), null);
    }
    assert.ok(!document.querySelector('[role="grid"], [role="listbox"], [role="menu"]'));
  } finally {
    await view.unmount();
  }
});

test("a long list draws its first hundred rows, and the rest on demand", async () => {
  const streams = Array.from({ length: 130 }, (_, i) =>
    film(`A.Film.2020.1080p-G${i}.mkv`, { seeders: i }),
  );
  const view = await render({ streams });
  try {
    assert.equal(rows().length, 100);
    await act(() => heading("Seeders").click());
    assert.equal(names()[0], "G129", "the whole list is sorted, not only what is drawn");
    await act(() => button("Show all 130")!.click());
    assert.equal(rows().length, 130);
    assert.ok(!button("Show all"));
  } finally {
    await view.unmount();
  }
});

// --- while add-ons still answer ------------------------------------------------------------------

const addon = (id: string, name: string, resources: unknown[] = ["stream"]) =>
  ({ transportUrl: `https://${id}.test`, manifest: { id, name, resources } }) as unknown as Addon;
const waiting = () =>
  document.querySelector("[data-waiting]")?.textContent?.replace("Waiting for", "Waiting for ") ??
  null;

test("while add-ons still answer one of those without rows is named", async () => {
  const addons = [
    addon("torrentio", "Torrentio"),
    addon("subs", "Subtitles", ["subtitles"]),
    addon("comet", "Comet", [{ name: "stream" }]),
  ];
  const view = await render({ streams: four(), addons, pipelineDone: false });
  try {
    assert.equal(waiting(), "Waiting for Comet");
    await view.rerender({ addons: addons.slice(0, 2) });
    assert.equal(waiting(), "Loading more sources");
    await view.rerender({ pipelineDone: true });
    assert.equal(waiting(), null);
  } finally {
    await view.unmount();
  }
});

test("several add-ons are named one after the other", async () => {
  const own = window.setInterval;
  const turns: (() => void)[] = [];
  window.setInterval = ((turn: () => void) => turns.push(turn)) as typeof window.setInterval;
  const addons = [addon("comet", "Comet"), addon("media", "MediaFusion")];
  const view = await render({ streams: four(), addons, pipelineDone: false });
  try {
    const said = [waiting()];
    await act(() => turns.at(-1)!());
    said.push(waiting());
    await act(() => turns.at(-1)!());
    said.push(waiting());
    assert.deepEqual(said, ["Waiting for Comet", "Waiting for MediaFusion", "Waiting for Comet"]);
  } finally {
    window.setInterval = own;
    await view.unmount();
  }
});

// --- warming up ----------------------------------------------------------------------------------

test("a row that is pointed at or focused long enough is warmed up, and let go when it is left", async () => {
  const prewarm = await import("@/lib/streams/p2p-prewarm");
  const added: string[] = [];
  const dropped: string[] = [];
  prewarm.__setPrewarmDepsForTest({
    add: async (magnet) => (added.push(magnet), null),
    abandon: (hash) => void dropped.push(hash),
  });
  const streams = four();
  const failed = film("A.Film.2020.1080p-ECHO.mkv");
  const view = await render({
    streams: [...streams, failed],
    failedStreams: new Set([failed]),
  });
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    await pointer("enter", rows()[0]);
    await wait(200);
    await pointer("leave", rows()[0]);
    await wait(1000);
    assert.deepEqual(added, [], "passing over a row warms nothing up");
    await pointer("enter", rows()[4]);
    await wait(1050);
    await pointer("leave", rows()[4]);
    assert.deepEqual(added, [], "nor does a source that failed");
    await pointer("enter", rows()[1]);
    await wait(1050);
    assert.equal(added.length, 1);
    assert.ok(added[0].includes(streams[1].infoHash!));
    await pointer("leave", rows()[1]);
    await wait(20);
    assert.deepEqual(dropped, [streams[1].infoHash]);
    await act(() => playOf(rows()[2]).focus());
    await wait(200);
    await act(() => playOf(rows()[3]).focus());
    await wait(1050);
    assert.equal(added.length, 2, "only the row that kept the focus");
    assert.ok(added[1].includes(streams[3].infoHash!));
  } finally {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    prewarm.__resetPrewarmForTest();
    await view.unmount();
  }
});
