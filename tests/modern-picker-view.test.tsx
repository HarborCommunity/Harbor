import assert from "node:assert/strict";
import test from "node:test";
import { act, renderModern, source } from "./helpers/modern-picker.tsx";

const { setWindowFullscreen } = await import("@/lib/fullscreen-state");

const three = () => [
  source("A.Film.2020.1080p.WEB-DL.H.264-ALPHA.mkv"),
  source("A.Film.2020.2160p.WEB-DL.H.265-BRAVO.mkv"),
  source("A.Film.2020.720p.BluRay.x264-CHARLIE.mkv"),
];

test("the title stands in the left column and the page's own body beside it", async () => {
  const view = await renderModern(
    { streams: three() },
    { body: (list) => [<p key="notice">A notice of the page</p>, <div key="list">{list}</div>] },
  );
  try {
    const title = document.querySelector("h1")!;
    const notice = [...document.querySelectorAll("p")].find(
      (p) => p.textContent === "A notice of the page",
    )!;
    assert.equal(title.textContent, "A film");
    assert.ok(notice.closest("div") && !notice.parentElement!.contains(title));
    assert.ok(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING);
  } finally {
    await view.unmount();
  }
});

test("no part of the look takes the place of the app's own navigation bar", async () => {
  const view = await renderModern({ streams: three() });
  try {
    assert.ok(
      !document.querySelector("aside, [data-tv-nav-zone], [data-harbor-nav]"),
      "keyboard-navigation.ts treats everything inside an aside as the navigation bar",
    );
  } finally {
    await view.unmount();
  }
});

test("a source is played by the page, and the look itself resolves nothing", async () => {
  const streams = three();
  const played: unknown[] = [];
  const view = await renderModern({ streams, onPlay: (s) => played.push(s) });
  try {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("li button")];
    assert.equal(buttons.length, 3);
    await act(() => buttons[1].click());
    assert.deepEqual(played, [streams[1]]);
  } finally {
    await view.unmount();
  }
});

test("the remembered sort comes from the settings and goes back to them", async () => {
  const view = await renderModern(
    { streams: three() },
    { settings: { pickerModernSort: { key: "size", dir: "asc" } } },
  );
  try {
    assert.deepEqual(view.state().sort, { key: "size", dir: "asc" });
    await act(() => view.state().setSort({ key: "seeders", dir: "desc" }));
    assert.deepEqual(view.state().sort, { key: "seeders", dir: "desc" });
    assert.deepEqual(view.settings().pickerModernSort, { key: "seeders", dir: "desc" });
    await act(() => view.state().setSort(null));
    assert.equal(view.state().sort, null);
    assert.equal(view.settings().pickerModernSort, null);
  } finally {
    await view.unmount();
  }
});

test("a stored sort this look does not know is ignored", async () => {
  for (const stored of ["size-desc", { key: "date", dir: "asc" }, { key: "size", dir: "up" }, 4]) {
    const view = await renderModern(
      { streams: three() },
      { settings: { pickerModernSort: stored } },
    );
    try {
      assert.equal(view.state().sort, null, JSON.stringify(stored));
    } finally {
      await view.unmount();
    }
  }
});

test("filters belong to the visit: set, replaced, let go one by one, cleared, never saved", async () => {
  const view = await renderModern({ streams: three() });
  try {
    assert.deepEqual(view.state().filters, {});
    await act(() => view.state().setFilter("resolution", "4K"));
    await act(() => view.state().setFilter("source", "WEB-DL"));
    assert.deepEqual(view.state().filters, { resolution: "4K", source: "WEB-DL" });
    await act(() => view.state().setFilter("resolution", "1080p"));
    assert.deepEqual(view.state().filters, { resolution: "1080p", source: "WEB-DL" });
    await act(() => view.state().setFilter("resolution", null));
    assert.deepEqual(view.state().filters, { source: "WEB-DL" });
    await act(() => view.state().clearFilters());
    assert.deepEqual(view.state().filters, {});
    assert.equal(JSON.stringify(view.settings()).includes("WEB-DL"), false);
  } finally {
    await view.unmount();
  }
});

test("what was filtered, sorted and opened is still so after a Play attempt", async () => {
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent!.startsWith(label),
    )!;
  const rowCount = () => document.querySelectorAll("[data-row]").length;
  const streams = Array.from({ length: 260 }, (_, i) =>
    source(`A.Film.2020.${i % 2 ? "1080p" : "720p"}.WEB-DL.${i % 3 ? "x264" : "HEVC"}-G${i}.mkv`),
  );
  const view = await renderModern(
    { streams, orderName: "together" },
    { settings: { pickerModernSort: { key: "size", dir: "asc" } } },
  );
  try {
    await act(() => button("More filters").click());
    await act(() => view.state().setFilter("resolution", "1080p"));
    await act(() => button("Show all 130").click());
    await act(() => button("Size").click());
    assert.deepEqual([rowCount(), button("Size").getAttribute("aria-pressed")], [130, "true"]);
    await view.away(true);
    assert.equal(rowCount(), 0);
    await view.away(false);
    assert.deepEqual(view.state().filters, { resolution: "1080p" });
    assert.equal(rowCount(), 130);
    assert.equal(button("Size").getAttribute("aria-pressed"), "true", "also in a room");
    assert.ok(button("Fewer filters"));
  } finally {
    await view.unmount();
  }
});

test("what sticks to the top keeps clear of Harbor's own title bar, which lies over the page", async () => {
  const room = () =>
    document
      .querySelector("h1")!
      .closest<HTMLElement>('[class*="@container/modern"]')!
      .style.getPropertyValue("--modern-top");
  for (const [settings, inApp, expected] of [
    [{ hybridTitleBar: true }, true, "36px"],
    [{ hybridTitleBar: true, useNativeTitleBar: true }, true, "0px"],
    [{ hybridTitleBar: false }, true, "0px"],
    [{ hybridTitleBar: true }, false, "0px"],
  ] as const) {
    const view = await renderModern({ streams: three() }, { settings });
    if (inApp) Object.assign(window, { __TAURI_INTERNALS__: {} });
    try {
      await view.rerender();
      assert.equal(room(), expected, JSON.stringify([settings, inApp]));
      await act(() => setWindowFullscreen(true));
      assert.equal(room(), "0px", "and in full screen there is none");
    } finally {
      await act(() => setWindowFullscreen(false));
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
      await view.unmount();
    }
  }
});

test("the headings get a ground of their own once they stick, and lose it again", async () => {
  type Told = Pick<
    IntersectionObserverEntry,
    "isIntersecting" | "boundingClientRect" | "rootBounds"
  >;
  let tell!: (entry: Told) => void;
  let options!: IntersectionObserverInit;
  class Observer {
    constructor(callback: IntersectionObserverCallback, given: IntersectionObserverInit) {
      options = given;
      tell = (entry) => callback([entry as IntersectionObserverEntry], this as never);
    }
    observe() {}
    disconnect() {}
  }
  Object.assign(globalThis, { IntersectionObserver: Observer });
  const headings = () => [...document.querySelector("[data-headings]")!.classList];
  const ground = () => headings().includes("bg-canvas");
  /** What lies over the coloured edge of a row, which stands outside of the list. */
  const cover = ["absolute", "top-0", "-bottom-px", "-start-0.5", "w-0.5", "bg-canvas"];
  const covered = () => cover.filter((name) => headings().includes(`before:${name}`)).length;
  const at = (top: number, isIntersecting: boolean): Told => ({
    isIntersecting,
    boundingClientRect: { top } as DOMRect,
    rootBounds: { top: 36 } as DOMRect,
  });
  const view = await renderModern({ streams: three() });
  try {
    const row = document.querySelector("[data-row]")!.classList;
    assert.ok(row.contains("border-s-2") && row.contains("-ms-0.5"));
    assert.deepEqual([ground(), covered()], [false, 0]);
    await act(() => tell(at(20, false)));
    assert.deepEqual([ground(), covered()], [true, cover.length]);
    await act(() => tell(at(300, true)));
    assert.deepEqual([ground(), covered()], [false, 0]);
    await act(() => tell(at(2000, false)));
    assert.equal(ground(), false, "below the window they do not stick");
    assert.match(options.rootMargin!, /^-?\d+(\.\d+)?px 0px 0px 0px$/);
  } finally {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    await view.unmount();
  }
});
