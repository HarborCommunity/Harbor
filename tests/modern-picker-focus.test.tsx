import assert from "node:assert/strict";
import test from "node:test";
import { useLayoutEffect } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayEpisode } from "@/lib/view";
import type { ModernListProps } from "@/views/play-picker/modern/modern-list";
import { act, renderModern, source, withCached, type Rendered } from "./helpers/modern-picker.tsx";

const { moveFocus } = await import("@/lib/keyboard-navigation");

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];
const play = (n: number) => rows()[n].querySelector<HTMLElement>("[data-play]")!;
const copy = (n: number) =>
  rows()[n].querySelector<HTMLElement>('[data-cell="actions"] [aria-label="Copy link"]')!;
const headings = () => [...document.querySelectorAll<HTMLElement>("[data-headings] button")];
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent!.startsWith(label),
  )!;
const groups = () => [...document.querySelectorAll<HTMLElement>('[data-filters] [role="group"]')];
const groupName = (group: HTMLElement) =>
  document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent!;
const choice = (group: string, label: string) =>
  [
    ...(groups()
      .find((g) => groupName(g) === group)
      ?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((b) => b.textContent!.startsWith(label))!;
const focused = () => document.activeElement as HTMLElement;
const focusSays = () => (focused() === document.body ? "nothing" : focused().textContent);
/** Elements are never handed to assert itself, which would print the whole page. */
const focusIsOn = (expected: HTMLElement, where = "") => {
  const at = focused();
  const said = at.getAttribute("aria-label") ?? at.textContent;
  assert.ok(at === expected, `${where} the focus is on ${at.tagName} "${said?.slice(0, 60)}"`);
};

const films = (count: number): ScoredStream[] =>
  Array.from({ length: count }, (_, i) =>
    source(`A.Film.2020.${i % 2 ? "1080p" : "720p"}.WEB-DL.x264-G${i}.mkv`, {
      size: i + 1,
      url: `https://play.test/${i}`,
      cached: { rd: true },
    }),
  );
const debrids = [{ slug: "rd", name: "Real-Debrid" }] as unknown as ModernListProps["debrids"];

/** jsdom lays nothing out, so the parts are put where the look has them in a window of 1680 px. */
async function laidOut(run: () => Promise<void>) {
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const place = (el: Element): DOMRect => {
    const row = el.closest("[data-row]");
    const top = row ? 400 + 70 * rows().indexOf(row as HTMLElement) : 0;
    if (el === row) return box(420, top, 1200, 70);
    if (el.matches("[data-play]")) return box(1570, top + 16, 38, 38);
    if (row && el.closest('[data-cell="actions"]')) return box(1530, top + 19, 32, 32);
    const heading = headings().indexOf(el as HTMLElement);
    if (heading >= 0) return box([434, 1000, 1150, 1280][heading], 360, 70, 20);
    if (el.closest("[data-pick]") && el.matches("button")) return box(420, 280, 180, 56);
    const filters = [...document.querySelectorAll('[data-filters] [role="group"] button')];
    const filter = filters.indexOf(el);
    if (filter >= 0) return box(40 + (filter % 4) * 70, 420 + Math.floor(filter / 4) * 60, 60, 30);
    return box(0, 0, 0, 0);
  };
  const own = Element.prototype;
  const { getBoundingClientRect, getClientRects, scrollIntoView } = own;
  own.getBoundingClientRect = function (this: Element) {
    return place(this);
  };
  own.getClientRects = function (this: Element) {
    return [place(this)] as unknown as DOMRectList;
  };
  own.scrollIntoView = () => {};
  try {
    await run();
  } finally {
    Object.assign(own, { getBoundingClientRect, getClientRects, scrollIntoView });
  }
}

const shown = async (
  streams: ScoredStream[],
  run: (view: Rendered) => Promise<void>,
  options: Parameters<typeof renderModern>[1] = {},
) => {
  const view = await renderModern({ streams, debrids }, options);
  try {
    await run(view);
  } finally {
    await view.unmount();
  }
};

test("a controller walks from the pick over the headings into the rows and along them", () =>
  laidOut(() =>
    shown(films(4), async () => {
      const walk = (dir: Parameters<typeof moveFocus>[0]) => act(() => moveFocus(dir));
      await act(() => document.querySelector<HTMLElement>("[data-pick] button")!.focus());
      await walk("down");
      focusIsOn(headings()[0]);
      for (const heading of headings()) {
        await act(() => heading.focus());
        await walk("down");
        focusIsOn(play(0), `from ${heading.textContent}`);
      }
      await walk("down");
      focusIsOn(play(1));
      await walk("right");
      focusIsOn(copy(1), "its link stands at the end of the row");
      await walk("down");
      focusIsOn(copy(2));
      await walk("left");
      focusIsOn(play(2));
      await walk("up");
      await walk("up");
      focusIsOn(play(0));
      await walk("up");
      assert.ok(headings().includes(focused()));
    }),
  ));

test("what a controller has reached can be seen, which the engine does not show by itself", () =>
  shown(films(2), async () => {
    const look = document.querySelector("[data-list]")!.closest('[class*="@container/modern"]')!;
    assert.match(
      look.className,
      /\[html\[data-input-modality=keys\]_&_:focus\]:outline-2/,
      "focus-visible does not match what a script has focused before any key was pressed",
    );
    assert.match(
      rows()[0].className,
      /\[html\[data-input-modality=keys\]_&:has\(\[data-play\]:focus\)\]:bg-elevated\/50/,
    );
    assert.match(
      play(0).firstElementChild!.className,
      /\[html\[data-input-modality=keys\]_:focus>&\]:bg-accent/,
    );
  }));

test("Show all leaves the focus where the list went on", () =>
  shown(films(120), async () => {
    const more = button("Show all 120");
    await act(() => more.focus());
    await act(() => more.click());
    assert.equal(rows().length, 120);
    focusIsOn(play(99));
  }));

test("the way back from a sort leaves the focus on the heading it was", () =>
  shown(films(4), async () => {
    await act(() => button("Size").click());
    const back = button("Back to Harbor ranking");
    await act(() => back.focus());
    await act(() => back.click());
    assert.equal(back.isConnected, false);
    focusIsOn(button("Size"));
  }));

test("Update and Clear filters leave the focus at the top of the list", () =>
  shown(films(4), async (view) => {
    await act(() => view.state().setFilter("source", "Remux"));
    const clear = button("Clear filters");
    await act(() => clear.focus());
    await act(() => clear.click());
    assert.equal(clear.isConnected, false);
    focusIsOn(headings()[0]);

    await act(() => play(0).focus());
    const fresh = films(2);
    await view.rerender({ streams: fresh, ranked: fresh });
    const update = button("Update");
    await act(() => update.click());
    assert.equal(update.isConnected, false);
    focusIsOn(headings()[0]);
  }));

test("Clear leaves the focus on what stands next to it", async () => {
  const streams = films(4).concat(source("A.Film.2020.1080p.WEB-DL.HEVC-H.mkv"));
  for (const [cachedUseful, filter, expected] of [
    [true, "resolution", "Cached only"],
    [false, "resolution", "More filters"],
    [false, "codec", "Fewer filters"],
  ] as const) {
    await shown(
      withCached(streams, () => cachedUseful),
      async (view) => {
        await act(() => view.state().setFilter(filter, filter === "codec" ? "HEVC" : "1080p"));
        const clear = button("Clear");
        await act(() => clear.focus());
        await act(() => clear.click());
        assert.equal(clear.isConnected, false);
        assert.equal(focusSays(), expected);
      },
    );
  }
});

const losing4K = (codec: string) => [
  source("A.Film.2020.2160p.WEB-DL.H.264-ALPHA.mkv"),
  source("A.Film.2020.1080p.WEB-DL.H.264-BRAVO.mkv"),
  source(`A.Film.2020.1080p.BluRay.${codec}-CHARLIE.mkv`),
];

/** The list loses its one film in 4K; the row of the resolutions stays for what is chosen in it. */
const loses4K = async (
  { codec, chosen, cached = false }: { codec: string; chosen: string; cached?: boolean },
  run: (view: Rendered, left: ScoredStream[]) => Promise<void>,
) => {
  const [gone, ...left] = withCached(losing4K(codec), () => cached);
  await shown([gone, ...left], async (view) => {
    await act(() => view.state().setFilter("resolution", chosen));
    await view.rerender({ streams: left, ranked: left });
    await run(view, left);
  });
};

const nextTo = [
  ["what is cached can be shown alone", "HEVC", true, "Cached only"],
  ["there is more to filter", "HEVC", false, "More filters"],
  ["there is nothing more to filter", "H.264", false, "Release"],
] as const;

test("a row that goes with the filter it was there for hands the focus on", async () => {
  for (const [when, codec, cachedUseful, expected] of nextTo) {
    for (const chosen of ["4K", "1080p"]) {
      await loses4K({ codec, chosen, cached: cachedUseful }, async () => {
        const any = choice("Resolution", "Any");
        await act(() => any.focus());
        await act(() => any.click());
        assert.equal(any.isConnected, false);
        assert.equal(focusSays(), expected, `${chosen}, ${when}`);
      });
    }
  }
});

test("Clear hands the focus on to what is there when it has cleared", async () => {
  for (const [when, codec, cachedUseful, expected] of nextTo) {
    await loses4K({ codec, chosen: "4K", cached: cachedUseful }, async () => {
      const clear = button("Clear");
      await act(() => clear.focus());
      await act(() => clear.click());
      assert.deepEqual(groups().map(groupName), ["Source"], "the first row is gone");
      assert.equal(focusSays(), expected, when);
    });
  }
});

test("Clear switches Cached only off too, and leaves the focus where something can be pressed", async () => {
  const streams = losing4K("HEVC");
  const view = await renderModern(
    { streams, debrids },
    {
      shell: {
        cachedOnly: true,
        onCachedOnly: (cachedOnly) => void view.rerender({}, { cachedOnly }),
      },
    },
  );
  try {
    const clear = button("Clear");
    await act(() => clear.focus());
    await act(() => clear.click());
    assert.equal(document.querySelector('[role="switch"]')!.getAttribute("aria-checked"), "false");
    assert.equal(clear.isConnected, false);
    assert.equal(focusSays(), "More filters", "the switch can do nothing any more");
  } finally {
    await view.unmount();
  }
});

test("what cannot be pressed is passed over", () =>
  loses4K({ codec: "HEVC", chosen: "4K" }, async (view) => {
    await act(() => view.state().setFilter("codec", "HEVC"));
    const any = choice("Resolution", "Any");
    await act(() => any.focus());
    await act(() => any.click());
    assert.equal(any.isConnected, false);
    assert.equal(button("Fewer filters").disabled, true);
    focusIsOn(headings()[0]);
  }));

test("a press that does not come from the focus leaves it where it is", () =>
  loses4K({ codec: "HEVC", chosen: "4K" }, async () => {
    const any = choice("Resolution", "Any");
    await act(() => headings()[2].focus());
    await act(() => any.click());
    assert.equal(any.isConnected, false);
    focusIsOn(headings()[2]);
  }));

/** What was used last in the app, as Harbor writes it on the page. */
const using = async (what: "keys" | "pointer", run: () => Promise<void>) => {
  document.documentElement.setAttribute("data-input-modality", what);
  try {
    await run();
  } finally {
    document.documentElement.removeAttribute("data-input-modality");
  }
};

/** In a window in the background the focus moves without an event. */
const inTheBackground = async (run: () => Promise<void>) => {
  const stop = (event: Event) => event.stopImmediatePropagation();
  const types = ["focus", "blur", "focusin", "focusout"];
  for (const type of types) window.addEventListener(type, stop, true);
  try {
    await run();
  } finally {
    for (const type of types) window.removeEventListener(type, stop, true);
  }
};

test("a group that goes behind More filters under the focus leaves it on More filters", async () => {
  for (const cachedUseful of [true, false]) {
    const { six, noAddon, noHdr } = episode(cachedUseful);
    for (const before of [noAddon, noHdr]) {
      const view = await renderEpisode(before);
      try {
        const web = choice("Source", "WEB-DL");
        await act(() => web.focus());
        await view.rerender({ streams: six, ranked: six });
        assert.equal(web.isConnected, false);
        assert.equal(focusSays(), "More filters");
        assert.equal(button("More filters").getAttribute("aria-expanded"), "false");
      } finally {
        await view.unmount();
      }
    }
  }
});

test("a group that goes away altogether hands the focus on", async () => {
  for (const [when, codec, cachedUseful, expected] of nextTo) {
    const streams = withCached(losing4K(codec), () => cachedUseful);
    await shown(streams, async (view) => {
      const some = choice("Resolution", "1080p");
      await act(() => some.focus());
      await view.rerender({ streams: streams.slice(1), ranked: streams.slice(1) });
      assert.equal(some.isConnected, false);
      assert.equal(focusSays(), expected, when);
    });
  }
});

test("More filters that goes away hands the focus on", async () => {
  for (const [cachedUseful, expected] of [
    [true, "Cached only"],
    [false, "Release"],
  ] as const) {
    const [before, alike] = ["HEVC", "H.264"].map((codec) =>
      withCached(losing4K(codec), () => cachedUseful),
    );
    await shown(before, async (view) => {
      const more = button("More filters");
      await act(() => more.focus());
      await view.rerender({ streams: alike, ranked: alike });
      assert.equal(more.isConnected, false);
      assert.equal(focusSays(), expected);
    });
  }
});

test("Cached only that greys out under the focus hands it on", async () => {
  for (const pressed of [true, false]) {
    for (const [codec, expected] of [
      ["HEVC", "More filters"],
      ["H.264", "Release"],
    ] as const) {
      const streams = withCached(losing4K(codec), () => !pressed);
      const view = await renderModern(
        { streams, debrids },
        {
          shell: {
            cachedOnly: pressed,
            onCachedOnly: (cachedOnly) => void view.rerender({}, { cachedOnly }),
          },
        },
      );
      try {
        const cachedOnly = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
        await act(() => cachedOnly.focus());
        if (pressed) await act(() => cachedOnly.click());
        else await view.rerender({ streams: withCached(streams, () => false) });
        assert.equal(cachedOnly.disabled, true);
        assert.equal(
          focusSays(),
          expected,
          pressed ? "switched off" : "nothing is cached any more",
        );
      } finally {
        await view.unmount();
      }
    }
  }
});

test("what a group that stays loses hands the focus on as everything else does", async () => {
  const all = withCached(
    [
      source("A.Film.2020.2160p.WEB-DL.HEVC-ALPHA.mkv"),
      source("A.Film.2020.2160p.WEB-DL.H.264-BRAVO.mkv"),
      source("A.Film.2020.1080p.BluRay.HEVC-CHARLIE.mkv"),
      source("A.Film.2020.2160p.WEB-DL-DELTA.mkv", { codec: "AV1" }),
    ],
    () => true,
  );
  for (const [gone, label, there] of [
    [all[0], "HEVC", true],
    [all[3], "AV1", false],
  ] as const) {
    await shown(all, async (view) => {
      await act(() => view.state().openMore(true));
      await act(() => view.state().setFilter("resolution", "4K"));
      const some = choice("Video codec", label);
      await act(() => some.focus());
      const left = all.filter((s) => s !== gone);
      await view.rerender({ streams: left, ranked: left });
      assert.ok(groups().map(groupName).includes("Video codec"));
      assert.deepEqual([some.isConnected, some.disabled], [there, there]);
      assert.equal(focusSays(), "Cached only", label);
    });
  }
});

test("the focus stays in its own look", async () => {
  const other = document.createElement("div");
  other.innerHTML =
    '<div data-look=""><div data-filters=""><button aria-expanded="false">Another</button></div></div>';
  document.body.prepend(other);
  const { six, noAddon } = episode();
  const view = await renderEpisode(noAddon);
  try {
    await act(() => choice("Source", "WEB-DL").focus());
    await view.rerender({ streams: six, ranked: six });
    assert.equal(focusSays(), "More filters");
  } finally {
    await view.unmount();
    other.remove();
  }
});

test("what the mouse has focused needs no new place", () =>
  using("pointer", async () => {
    const { six, noAddon } = episode(true);
    const view = await renderEpisode(noAddon);
    try {
      await act(() => choice("Source", "WEB-DL").focus());
      await view.rerender({ streams: six, ranked: six });
      assert.equal(focusSays(), "nothing");
      const cachedOnly = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
      await act(() => cachedOnly.focus());
      await view.rerender({ streams: withCached(six, () => false) });
      focusIsOn(cachedOnly, "the browser takes it from what has greyed out");
    } finally {
      await view.unmount();
    }
  }));

test("a key or a controller takes over what the mouse has focused", () =>
  using("pointer", async () => {
    type Use = (any: HTMLButtonElement) => void;
    const key =
      (down: KeyboardEventInit): Use =>
      (any) =>
        any.dispatchEvent(new window.KeyboardEvent("keydown", { ...down, bubbles: true }));
    const up = key({ key: "ArrowUp" });
    const mouse: Use = (any) =>
      any.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
    const another: Use = () => choice("Source", "WEB-DL").focus();
    const nowhere: Use = () => document.documentElement.setAttribute("data-input-modality", "keys");
    for (const [by, expected, ...uses] of [
      ["a key", "More filters", up],
      ["a controller", "More filters", (any: HTMLButtonElement) => any.click()],
      ["a controller that finds nowhere to go", "More filters", nowhere],
      ["the mouse", "nothing", mouse],
      ["a key, then the mouse", "nothing", up, mouse],
      ["a key, then the mouse on another one", "nothing", up, another],
      ["Alt", "nothing", key({ key: "Alt", altKey: true })],
      ["Control", "nothing", key({ key: "Control", ctrlKey: true })],
      ["Meta", "nothing", key({ key: "Meta", metaKey: true })],
    ] as [by: string, expected: string, ...uses: Use[]][]) {
      const { six, noAddon } = episode(true);
      const view = await renderEpisode(noAddon);
      try {
        const any = choice("Source", "Any");
        await act(() => any.focus());
        for (const use of uses) await act(() => use(any));
        await view.rerender({ streams: six, ranked: six });
        assert.equal(any.isConnected, false);
        assert.equal(focusSays(), expected, by);
      } finally {
        document.documentElement.setAttribute("data-input-modality", "pointer");
        await view.unmount();
      }
    }
  }));

test("what a key has taken over stays its own when the window comes back", () =>
  using("pointer", async () => {
    const { six, noAddon } = episode(true);
    const view = await renderEpisode(noAddon);
    try {
      const web = choice("Source", "WEB-DL");
      await act(() => web.focus());
      for (const event of [
        new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        new window.FocusEvent("focusout", { bubbles: true }),
        new window.FocusEvent("focusin", { bubbles: true }),
      ]) {
        await act(() => web.dispatchEvent(event));
      }
      await view.rerender({ streams: six, ranked: six });
      assert.equal(focusSays(), "More filters");
    } finally {
      await view.unmount();
    }
  }));

test("where the focus was handed on to is not the mouse's either", () =>
  using("pointer", async () => {
    await loses4K({ codec: "HEVC", chosen: "4K", cached: true }, async (view, left) => {
      const any = choice("Resolution", "Any");
      await act(() => any.focus());
      await act(() => any.click());
      assert.equal(focusSays(), "Cached only");
      await view.rerender({ streams: withCached(left, () => false) });
      assert.equal(focusSays(), "More filters");
    });
  }));

test("the focus is handed on once", () =>
  loses4K({ codec: "H.264", chosen: "4K" }, async (view) => {
    const any = choice("Resolution", "Any");
    await act(() => any.focus());
    await act(() => any.click());
    focusIsOn(headings()[0]);
    await act(() => headings()[0].blur());
    await view.rerender({}, { pipelineDone: false });
    focusIsOn(document.body);
  }));

test("what takes the focus itself in the same draw keeps it", async () => {
  /** As a dialog does that gives the focus back when it closes. */
  function Dialog() {
    useLayoutEffect(() => () => headings()[2].focus(), []);
    return null;
  }
  const { six, noAddon } = episode();
  let open = true;
  const view = await renderModern(
    {
      streams: noAddon,
      meta: { id: "kitsu:1", type: "series", name: "A Show" } as Meta,
      episode: { season: 1, episode: 4 } as PlayEpisode,
      isAnime: true,
    },
    { body: (list) => [<div key="list">{list}</div>, open && <Dialog key="dialog" />] },
  );
  try {
    const web = choice("Source", "WEB-DL");
    await act(() => web.focus());
    open = false;
    await view.rerender({ streams: six, ranked: six });
    assert.equal(web.isConnected, false);
    focusIsOn(headings()[2]);
  } finally {
    await view.unmount();
  }
});

test("the focus is kept while only the window has lost its own", async () => {
  const { six, noAddon } = episode(true);
  const view = await renderEpisode(noAddon);
  try {
    const web = choice("Source", "WEB-DL");
    await act(() => web.focus());
    await act(() => web.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
    await view.rerender({ streams: six, ranked: six });
    assert.equal(focusSays(), "More filters");
  } finally {
    await view.unmount();
  }
});

test("a window in the background hands the focus on as well", async () => {
  await loses4K({ codec: "HEVC", chosen: "4K" }, () =>
    inTheBackground(async () => {
      const any = choice("Resolution", "Any");
      await act(() => any.focus());
      await act(() => any.click());
      assert.equal(any.isConnected, false);
      assert.equal(focusSays(), "More filters", "pressed, as the remote on a phone does");
    }),
  );
  const { six, noAddon } = episode(true);
  const view = await renderEpisode(noAddon);
  try {
    await inTheBackground(async () => {
      await act(() => choice("Source", "WEB-DL").focus());
      await view.rerender({ streams: six, ranked: six });
      assert.equal(focusSays(), "More filters", "not pressed");
    });
  } finally {
    await view.unmount();
  }
});

test("what goes away outside of the filters is not handed on", async () => {
  let there = true;
  const view = await renderModern(
    { streams: films(2), debrids },
    { body: (list) => [<div key="list">{list}</div>, there && <button key="own">Other</button>] },
  );
  try {
    const other = button("Other");
    await act(() => other.focus());
    there = false;
    await view.rerender({ pipelineDone: false });
    assert.equal(other.isConnected, false);
    assert.equal(focusSays(), "nothing");
  } finally {
    await view.unmount();
  }
});

test("a mouse that takes the focus in the background takes it for good", async () => {
  const { six, noAddon } = episode(true);
  const view = await renderEpisode(noAddon);
  try {
    const web = choice("Source", "WEB-DL");
    await act(() => web.focus());
    await inTheBackground(() => act(() => web.blur()));
    await view.rerender({ streams: six, ranked: six });
    assert.equal(focusSays(), "nothing");
  } finally {
    await view.unmount();
  }
});

test("handing the focus on scrolls nothing", () =>
  loses4K({ codec: "HEVC", chosen: "4K" }, async () => {
    const any = choice("Resolution", "Any");
    await act(() => any.focus());
    const { focus } = HTMLElement.prototype;
    const asked: (FocusOptions | undefined)[] = [];
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      asked.push(options);
      focus.call(this, options);
    };
    try {
      await act(() => any.click());
    } finally {
      HTMLElement.prototype.focus = focus;
    }
    assert.deepEqual(asked, [{ preventScroll: true }]);
  }));

test("a greyed out control that has the TV navigation's ring hands that on too", async () => {
  const own = Element.prototype;
  const { scrollIntoView } = own;
  const scrolledTo: string[] = [];
  own.scrollIntoView = function (this: Element) {
    scrolledTo.push(this.textContent!);
  };
  const streams = withCached(losing4K("HEVC"), () => true);
  const view = await renderModern({ streams, debrids });
  try {
    const cachedOnly = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(() => cachedOnly.focus());
    cachedOnly.setAttribute("data-tv-focused", "true");
    await view.rerender({ streams: withCached(streams, () => false) });
    assert.equal(focusSays(), "More filters");
    assert.deepEqual(scrolledTo, ["More filters"]);
    assert.equal(cachedOnly.hasAttribute("data-tv-focused"), false);
  } finally {
    own.scrollIntoView = scrollIntoView;
    await view.unmount();
  }
});

test("the focus stays where it is when the row does", () =>
  shown(losing4K("HEVC"), async (view) => {
    await act(() => view.state().setFilter("resolution", "4K"));
    const any = choice("Resolution", "Any");
    await act(() => any.focus());
    await act(() => any.click());
    assert.deepEqual(view.state().filters, {});
    focusIsOn(any);
  }));

test("a row of buttons that goes after the focus has left it moves none", async () => {
  for (const reading of [true, false]) {
    await shown(losing4K("HEVC"), async (view) => {
      const any = choice("Resolution", "Any");
      await act(() => any.focus());
      await act(() => any.click());
      const at = reading ? play(0) : document.body;
      await act(() => (reading ? at.focus() : any.blur()));
      const [one] = losing4K("HEVC");
      await view.rerender({ streams: [one], ranked: [one] });
      assert.equal(any.isConnected, false);
      focusIsOn(at);
    });
  }
});

/** An anime episode with six groups of filters, and with five: without Addon, and without HDR. */
const episode = (cached = false) => {
  const made = (partial: Partial<ScoredStream>) =>
    source("[A] A Show - 04 (1080p WEB-DL H.264).mkv", {
      audioLanguages: ["Japanese"],
      cached: cached ? { rd: true } : {},
      ...partial,
    });
  const [one, other, comet] = [
    made({}),
    made({
      source: "BluRay",
      codec: "HEVC",
      resolution: "720p",
      hdrFormat: "HDR10",
      audioLanguages: ["English"],
      seasonPack: true,
    }),
    made({ addonId: "comet", addonName: "Comet" }),
  ];
  return {
    six: [one, other, comet],
    noAddon: [one, other],
    noHdr: [one, { ...other, hdrFormat: null }, comet],
  };
};
const renderEpisode = (streams: ScoredStream[]) =>
  renderModern({
    streams,
    meta: { id: "kitsu:1", type: "series", name: "A Show" } as Meta,
    episode: { season: 1, episode: 4 } as PlayEpisode,
    isAnime: true,
  });
const FOUR = ["Release", "Audio", "Resolution", "HDR"];

test("a row behind More filters stays when its filter is let go, and the focus in it", async () => {
  const view = await renderEpisode(episode().six);
  const there = [...FOUR, "Addon", "Source", "Video codec"];
  try {
    await act(() => view.state().setFilter("source", "WEB-DL"));
    assert.deepEqual(groups().map(groupName), there);
    const any = choice("Source", "Any");
    await act(() => any.focus());
    await act(() => any.click());
    assert.deepEqual(view.state().filters, {});
    assert.deepEqual(groups().map(groupName), there);
    focusIsOn(any);
  } finally {
    await view.unmount();
  }
});

test("what the TV navigation had focused stays its own, and is scrolled to", async () => {
  const own = Element.prototype;
  const { scrollIntoView } = own;
  for (const ring of [true, false]) {
    const scrolledTo: string[] = [];
    own.scrollIntoView = function (this: Element) {
      scrolledTo.push(this.textContent!);
    };
    try {
      await loses4K({ codec: "HEVC", chosen: "4K" }, async () => {
        const any = choice("Resolution", "Any");
        await act(() => any.focus());
        if (ring) any.setAttribute("data-tv-focused", "true");
        await act(() => any.click());
        assert.equal(focusSays(), "More filters");
      });
    } finally {
      own.scrollIntoView = scrollIntoView;
    }
    assert.deepEqual(scrolledTo, ring ? ["More filters"] : []);
  }
});

test("a group that changes sides of More filters keeps its buttons and the focus", async () => {
  const { six, noAddon, noHdr } = episode();
  const drawn = new Map([
    [six, [...FOUR, "Addon", "Source", "Video codec"]],
    [noAddon, [...FOUR, "Source", "Video codec"]],
    [noHdr, ["Release", "Audio", "Resolution", "Source", "Addon", "Video codec"]],
  ]);
  for (const [before, after, group, label] of [
    [noAddon, six, "Source", "WEB-DL"],
    [six, noAddon, "Source", "WEB-DL"],
    [noHdr, six, "Source", "WEB-DL"],
    [six, noHdr, "Source", "WEB-DL"],
    [noHdr, six, "Addon", "Comet"],
    [six, noHdr, "Addon", "Comet"],
  ] as const) {
    for (const opened of [true, false]) {
      const view = await renderEpisode(before);
      try {
        if (opened) await act(() => view.state().openMore(true));
        else await act(() => view.state().setFilter("source", "WEB-DL"));
        const resting = choice(group, label);
        await act(() => resting.focus());
        await view.rerender({ streams: after, ranked: after });
        assert.deepEqual(groups().map(groupName), drawn.get(after));
        assert.equal(resting.isConnected, true);
        focusIsOn(resting);
      } finally {
        await view.unmount();
      }
    }
  }
});

test("a click of the mouse takes no focus anywhere", () =>
  shown(films(120), async () => {
    const more = button("Show all 120");
    await act(() =>
      more.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 })),
    );
    assert.equal(rows().length, 120);
    focusIsOn(document.body);
  }));

test("nor does one that takes a row of buttons away", () =>
  loses4K({ codec: "HEVC", chosen: "4K" }, async (view) => {
    const any = choice("Resolution", "Any");
    await act(() =>
      any.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 })),
    );
    assert.deepEqual(view.state().filters, {});
    assert.equal(any.isConnected, false);
    focusIsOn(document.body);
    await act(() => choice("Source", "Blu-ray").click());
    focusIsOn(document.body, "nor does the next press of something that stays");
  }));

test("what gets the focus is not hidden under the headings that stick to the top", () =>
  shown(films(2), async () => {
    for (const control of [play(0), copy(0)]) {
      assert.match(control.className, /scroll-mt-\[calc\(var\(--modern-top\)\+\d+px\)\]/);
    }
  }));
