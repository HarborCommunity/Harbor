import assert from "node:assert/strict";
import test from "node:test";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { act, FILM, renderElement, renderModern, source } from "./helpers/modern-picker.tsx";

const { ButtonRow } = await import("@/views/play-picker/modern/button-row");

const film = (partial: Partial<Meta> = {}) => ({ ...FILM, ...partial }) as Meta;
const SHOW = { id: "kitsu:1", type: "series", name: "A Show" } as Meta;
const EPISODE: PlayEpisode = { season: 1, episode: 4, name: "Rescue", still: "still.jpg" };

const raw = (selector: string) => document.querySelector(selector)?.textContent ?? null;
/** Without the marks that give a piece of text its own direction. */
const text = (selector: string) => raw(selector)?.replace(/[\u2068\u2069]/g, "") ?? null;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent!.startsWith(label),
  );
const group = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent === label,
  );
const choices = (label: string) =>
  [...(group(label)?.querySelectorAll("button") ?? [])].map(
    (b) =>
      `${b.textContent}${b.disabled ? " off" : ""}${b.getAttribute("aria-pressed") === "true" ? " chosen" : ""}`,
  );
const groupNames = () =>
  [...document.querySelectorAll<HTMLElement>('[role="group"]')]
    .map((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent)
    .filter(Boolean);

const anime = (file: string, languages: string[], partial = {}) =>
  source(file, { audioLanguages: languages, ...partial });

/** Two add-ons, two resolutions, one batch; sub x2, dub x1, dual x1. */
const episodeSources = () => [
  anime("[A] A Show - 04 (1080p).mkv", ["Japanese"]),
  anime("[B] A Show - 04 (720p).mkv", ["Japanese"], { addonId: "comet", addonName: "Comet" }),
  anime("[C] A Show - 04 (1080p).mkv", ["English"], { addonId: "comet", addonName: "Comet" }),
  anime("[D] A Show (1080p).mkv", ["English", "Japanese"], { seasonPack: true }),
];

// --- a row of buttons ---------------------------------------------------------------------------

async function row(value: string | null, dir: "ltr" | "rtl" = "ltr") {
  const chosen: (string | null)[] = [];
  document.documentElement.style.direction = dir;
  const view = await renderElement(
    <ButtonRow
      label="Resolution"
      value={value}
      onChange={(v) => chosen.push(v)}
      options={[
        { value: "", label: "Any" },
        { value: "4K", label: "4K", count: 2 },
        { value: "1080p", label: "1080p", count: 0, disabled: true },
        { value: "720p", label: "720p", count: 1 },
      ]}
    />,
  );
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const press = async (key: string) => {
    let prevented = false;
    await act(() => {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    return prevented;
  };
  const focused = () => (document.activeElement as HTMLElement).textContent;
  return {
    chosen,
    buttons,
    press,
    focused,
    unmount: async () => {
      document.documentElement.style.direction = "";
      await view.unmount();
    },
  };
}

test("a row of buttons shows every choice with its count and which one is chosen", async () => {
  const view = await row("4K");
  try {
    assert.deepEqual(choices("Resolution"), ["Any", "4K2 chosen", "1080p0 off", "720p1"]);
  } finally {
    await view.unmount();
  }
});

test("a row with nothing chosen has its first button pressed", async () => {
  const view = await row(null);
  try {
    assert.deepEqual(choices("Resolution"), ["Any chosen", "4K2", "1080p0 off", "720p1"]);
  } finally {
    await view.unmount();
  }
});

test("pressing a button chooses its value, and the first one lets the filter go", async () => {
  const view = await row("4K");
  try {
    await act(() => view.buttons[3].click());
    await act(() => view.buttons[0].click());
    await act(() => view.buttons[2].click());
    assert.deepEqual(view.chosen, ["720p", null], "a choice that leaves nothing cannot be pressed");
  } finally {
    await view.unmount();
  }
});

test("left and right move the focus over what can be pressed and choose nothing", async () => {
  const view = await row(null);
  try {
    await act(() => view.buttons[0].focus());
    assert.equal(await view.press("ArrowRight"), true);
    assert.equal(view.focused(), "4K2");
    await view.press("ArrowRight");
    assert.equal(view.focused(), "720p1", "the greyed out choice is passed over");
    assert.equal(await view.press("ArrowRight"), false, "the end of the row keeps the key");
    assert.equal(view.focused(), "720p1");
    await view.press("ArrowLeft");
    assert.equal(view.focused(), "4K2");
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab", "a", "d"]) {
      assert.equal(await view.press(key), false, key);
    }
    assert.deepEqual(view.chosen, []);
  } finally {
    await view.unmount();
  }
});

test("in a right-to-left language left and right are the other way round", async () => {
  const view = await row(null, "rtl");
  try {
    await act(() => view.buttons[0].focus());
    await view.press("ArrowRight");
    assert.equal(view.focused(), "Any");
    await view.press("ArrowLeft");
    assert.equal(view.focused(), "4K2");
  } finally {
    await view.unmount();
  }
});

test("the thumb is grey while a row shows everything and white when it narrows the list", async () => {
  for (const [value, colour] of [
    [null, "bg-raised"],
    ["4K", "bg-ink"],
  ] as const) {
    const view = await row(value);
    try {
      const thumb = document.querySelector<HTMLElement>("[data-thumb]")!;
      assert.ok(thumb.classList.contains(colour), `${value}`);
      assert.equal(thumb.getAttribute("aria-hidden"), "true");
    } finally {
      await view.unmount();
    }
  }
});

// --- the picture and the words ------------------------------------------------------------------

const picture = () => document.querySelector<HTMLImageElement>("[data-picture] > img");

test("the picture is the episode's still, else the artwork, else the poster upright", async () => {
  const cases: [Meta, PlayEpisode | undefined, string | null, boolean][] = [
    [film({ background: "wide.jpg", poster: "tall.jpg" }), EPISODE, "still.jpg", true],
    [film({ background: "wide.jpg", poster: "tall.jpg" }), undefined, "wide.jpg", true],
    [film({ poster: "tall.jpg" }), undefined, "tall.jpg", false],
    [film(), undefined, null, false],
  ];
  for (const [meta, episode, src, wide] of cases) {
    const view = await renderModern({ streams: [], meta, episode });
    try {
      assert.equal(picture()?.getAttribute("src") ?? null, src);
      const frame = document.querySelector("[data-picture]");
      assert.equal(frame?.getAttribute("data-picture") ?? null, src && (wide ? "wide" : "tall"));
    } finally {
      await view.unmount();
    }
  }
});

test("the logo lies on a wide picture only, and the small line then leaves the name out", async () => {
  const logo = "logo.png";
  const line = () => text("[data-place]");
  const cases: [Meta, PlayEpisode, number | null, string, boolean][] = [
    [{ ...SHOW, logo }, EPISODE, null, "Season 1 · Episode 04", true],
    [SHOW, EPISODE, null, "A Show · Season 1 · Episode 04", false],
    [
      { ...SHOW, logo, poster: "p.jpg" },
      { ...EPISODE, still: undefined },
      null,
      "A Show · Season 1 · Episode 04",
      false,
    ],
    [{ ...SHOW, logo }, EPISODE, 104, "Episode 104", true],
    [SHOW, EPISODE, 104, "A Show · Episode 104", false],
  ];
  for (const [meta, episode, absoluteEpisode, expected, withLogo] of cases) {
    const view = await renderModern({ streams: [], meta, episode, absoluteEpisode });
    try {
      assert.equal(line(), expected);
      assert.equal(document.querySelectorAll(`img[src="${logo}"]`).length, withLogo ? 1 : 0);
    } finally {
      await view.unmount();
    }
  }
});

test("a film has its own small line, and none without a year", async () => {
  for (const [meta, expected] of [
    [film({ releaseInfo: "2017", genres: ["One", "Two", "Three"] }), "2017 · One · Two"],
    [film({ genres: ["One"] }), null],
  ] as const) {
    const view = await renderModern({ streams: [], meta });
    try {
      assert.equal(text("[data-place]"), expected);
      assert.equal(text("h1"), "A film");
    } finally {
      await view.unmount();
    }
  }
});

test("a title keeps its own direction, and nothing in the column is wider than it", async () => {
  const view = await renderModern({
    streams: episodeSources(),
    meta: SHOW,
    episode: { ...EPISODE, name: "...the Bag" },
  });
  try {
    const title = document.querySelector("h1")!;
    assert.equal(title.querySelector("bdi")?.textContent, "...the Bag");
    assert.match(title.className, /\[overflow-wrap:anywhere\]/);
    assert.match(document.querySelector("[data-place]")!.className, /\[overflow-wrap:anywhere\]/);
    const filters = document.querySelector("[data-filters]")!;
    assert.match(
      filters.className,
      /@min-\[1084px\]\/modern:flex-nowrap/,
      "a column that may wrap is as wide as the longest add-on name",
    );
  } finally {
    await view.unmount();
  }
});

test("every text that comes from data has its own direction beside the app's words", async () => {
  const own = (words: string) => `\u2068${words}\u2069`;
  const streams = [
    source("A.Show.S01E04.1080p-ALPHA.mkv", { addonName: "Comet (v2)" }),
    source("A.Show.S01E04.720p-BRAVO.mkv", { addonName: "Other", addonUrl: "https://b.test" }),
  ];
  const overview = "He left (again)...";
  const show = await renderModern({
    streams,
    meta: { ...SHOW, name: "Who's There?" } as Meta,
    episode: { ...EPISODE, name: "...the Bag", overview },
  });
  try {
    assert.equal(raw("h1 > bdi"), "...the Bag");
    assert.equal(
      raw("[data-place]"),
      `${own("Who's There?")} · ${own("Season 1")} · ${own("Episode 04")}`,
    );
    const description = [...document.querySelectorAll("header p")].find(
      (p) => p.textContent === overview,
    )!;
    assert.equal(description.getAttribute("dir"), "auto", "it is cut at its own end");
    assert.match(
      description.className,
      /\[text-align:-webkit-match-parent\]/,
      "on the column's side",
    );
    assert.deepEqual(
      [...group("Addon")!.querySelectorAll("button > bdi")].map((label) => label.textContent),
      ["All", "Comet (v2)", "Other"],
    );
    assert.equal(raw('[data-cell="from"] bdi'), "Comet (v2)");
  } finally {
    await show.unmount();
  }
  const view = await renderModern({
    streams: [],
    meta: film({ releaseInfo: "2017-", genres: ["One!", "Two"] }),
  });
  try {
    assert.equal(raw("[data-place]"), `${own("2017-")} · ${own("One!")} · ${own("Two")}`);
  } finally {
    await view.unmount();
  }
});

test("the picture is flatter in a low window, by one rule at a time", async () => {
  const view = await renderModern({ streams: [], meta: film({ background: "wide.jpg" }) });
  try {
    const rules = [
      ...document
        .querySelector("[data-picture]")!
        .className.matchAll(/:\[@media\(([^)]*)\)\]:aspect-\[([^\]]*)\]/g),
    ].map(([, query, ratio]) => {
      const [, above, below] = /^(?:(\d+)px<)?height<=(\d+)px$/.exec(query) ?? [];
      assert.ok(below, `a range of heights: ${query}`);
      return { above: Number(above ?? 0), below: Number(below), ratio };
    });
    const at = (height: number) =>
      rules.filter((r) => height > r.above && height <= r.below).map((r) => r.ratio);
    for (const [height, expected] of [
      [600, ["2.2/1"]],
      [768, ["2.2/1"]],
      [820, ["2.2/1"]],
      [820.5, ["2/1"]],
      [900, ["2/1"]],
      [940, ["2/1"]],
      [940.5, []],
      [1080, []],
    ] as const) {
      assert.deepEqual(at(height), expected, `a window of ${height} px`);
    }
  } finally {
    await view.unmount();
  }
});

test("in a low window the description goes, with the left column beside the list and above it", async () => {
  const view = await renderModern({
    streams: [],
    meta: SHOW,
    episode: { ...EPISODE, overview: "What happens in it." },
  });
  try {
    const around = [...document.querySelectorAll("header div")].find((e) =>
      /hidden/.test(e.className),
    );
    assert.equal(around?.className, "[@media(max-height:820px)]:hidden");
    assert.equal(around?.textContent, "What happens in it.");
  } finally {
    await view.unmount();
  }
});

test("the left column shows with Harbor's own thin scrollbar that it goes on", async () => {
  const view = await renderModern({ streams: episodeSources(), meta: SHOW, episode: EPISODE });
  try {
    const classes = [...document.querySelector("section")!.classList];
    assert.ok(classes.includes("harbor-scroll"));
    assert.ok(classes.includes("@min-[1084px]/modern:overflow-y-auto"));
    assert.ok(
      classes.includes("@min-[1084px]/modern:[scrollbar-gutter:stable]"),
      "its content keeps its width when the bar comes",
    );
    assert.deepEqual(
      classes.filter((c) => /scrollbar-width|::-webkit-scrollbar/.test(c)),
      [],
      "nothing hides it",
    );
  } finally {
    await view.unmount();
  }
});

test("above the list in the smallest window everything steps closer, so that the button is in sight", async () => {
  const view = await renderModern({
    streams: episodeSources(),
    meta: { ...SHOW, background: "wide.jpg" } as Meta,
    episode: EPISODE,
  });
  try {
    const low = "@max-[1084px]/modern:[@media(max-height:760px)]:";
    for (const part of ["section", "[data-picture]", "h1", "[data-filters]", "[data-pick]"]) {
      assert.ok(document.querySelector(part)!.className.includes(low), part);
    }
  } finally {
    await view.unmount();
  }
});

test("an episode without a name is called by its number, in the app's language", async () => {
  const view = await renderModern({ streams: [], meta: SHOW, episode: { season: 1, episode: 4 } });
  try {
    assert.equal(text("h1"), "Episode 4");
  } finally {
    await view.unmount();
  }
});

test("an episode has its description, a film has none", async () => {
  const overview = "What happens in it.";
  for (const [episode, expected] of [
    [{ ...EPISODE, overview }, true],
    [undefined, false],
  ] as const) {
    const view = await renderModern({
      streams: [],
      meta: film({ description: overview }),
      episode,
    });
    try {
      assert.equal(document.body.textContent!.includes(overview), expected);
    } finally {
      await view.unmount();
    }
  }
});

const tally = () => text("[data-tally]");

test("the count line says how long it is, how many sources there are and how many are ready", async () => {
  const streams = episodeSources();
  const ready = new Set([streams[0], streams[3]]);
  const view = await renderModern({
    streams,
    meta: SHOW,
    episode: { ...EPISODE, runtime: 24 },
    isCached: (s) => ready.has(s),
  });
  try {
    assert.equal(tally(), "24 min · 4 sources · 2 ready to start at once");
    const said = [...document.querySelectorAll("[data-tally] > bdi")].map((e) => e.textContent);
    assert.deepEqual(said, ["24 min", "4 sources", "2 ready to start at once"], "each by itself");
    const numbers = [...document.querySelectorAll("[data-tally] b")].map((e) => e.textContent);
    assert.deepEqual(numbers, ["4", "2"], "the counts stand out");
    await view.rerender({ streams: streams.slice(0, 1) });
    assert.equal(tally(), "24 min · 1 source · 1 ready to start at once");
    await view.rerender({ streams: [] });
    assert.equal(tally(), "24 min");
  } finally {
    await view.unmount();
  }
});

test("while add-ons still answer the count line says so far", async () => {
  const streams = episodeSources();
  const view = await renderModern(
    { streams, meta: SHOW, episode: EPISODE },
    { shell: { pipelineDone: false } },
  );
  try {
    assert.equal(tally(), "4 sources so far · 0 ready to start at once");
    await view.rerender({ streams: streams.slice(0, 1) });
    assert.equal(tally(), "1 source so far · 0 ready to start at once");
  } finally {
    await view.unmount();
  }
});

test("a film's length is read from its text, hours too", async () => {
  for (const [runtime, expected] of [
    ["164 min", "164 min · 1 source · 0 ready to start at once"],
    ["2h 44min", "164 min · 1 source · 0 ready to start at once"],
    ["2h", "120 min · 1 source · 0 ready to start at once"],
    ["", "1 source · 0 ready to start at once"],
    [undefined, "1 source · 0 ready to start at once"],
  ] as const) {
    const view = await renderModern({ streams: [source("A.mkv")], meta: film({ runtime }) });
    try {
      assert.equal(tally(), expected);
    } finally {
      await view.unmount();
    }
  }
});

test("the count line counts what the filters leave", async () => {
  const streams = episodeSources();
  const view = await renderModern({
    streams,
    meta: SHOW,
    episode: EPISODE,
    isAnime: true,
    isCached: (s) => s === streams[0] || s === streams[3],
  });
  try {
    await act(() => view.state().setFilter("dub", "sub"));
    assert.equal(tally(), "2 of 4 sources · 1 ready to start at once");
    await act(() => view.state().setFilter("release", "batch"));
    assert.equal(tally(), "None of the 4 sources match these filters.");
  } finally {
    await view.unmount();
  }
});

// --- the filters --------------------------------------------------------------------------------

test("an anime episode gets the groups its sources offer, with counts", async () => {
  const view = await renderModern({
    streams: episodeSources(),
    meta: SHOW,
    episode: EPISODE,
    isAnime: true,
  });
  try {
    assert.deepEqual(groupNames(), ["Release", "Audio", "Resolution", "Addon"]);
    assert.deepEqual(choices("Release"), ["All chosen", "Single episode3", "Batch1"]);
    assert.deepEqual(choices("Audio"), ["Any chosen", "Subbed2", "Dubbed1", "Dual1"]);
    assert.deepEqual(choices("Resolution"), ["Any chosen", "1080p3", "720p1"]);
    assert.deepEqual(choices("Addon"), ["All chosen", "Comet2", "Torrentio2"]);
  } finally {
    await view.unmount();
  }
});

test("the sub and dub group follows the setting for that mark, and only anime has it", async () => {
  const props = { streams: episodeSources(), meta: SHOW, episode: EPISODE };
  for (const [isAnime, showDubBadge, there] of [
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ] as const) {
    const view = await renderModern({ ...props, isAnime }, { settings: { showDubBadge } });
    try {
      assert.equal(groupNames().includes("Audio"), there);
    } finally {
      await view.unmount();
    }
  }
});

test("pressing a choice filters, greys out what would leave nothing, and can be let go", async () => {
  const view = await renderModern({
    streams: episodeSources(),
    meta: SHOW,
    episode: EPISODE,
    isAnime: true,
  });
  try {
    await act(() => button("Batch")!.click());
    assert.deepEqual(view.state().filters, { release: "batch" });
    assert.deepEqual(choices("Release"), ["All", "Single episode3", "Batch1 chosen"]);
    assert.deepEqual(choices("Audio"), ["Any chosen", "Subbed0 off", "Dubbed0 off", "Dual1"]);
    await act(() => group("Release")!.querySelector("button")!.click());
    assert.deepEqual(view.state().filters, {});
  } finally {
    await view.unmount();
  }
});

test("the chosen choice stays pressable when it leaves nothing", async () => {
  const view = await renderModern({
    streams: episodeSources(),
    meta: SHOW,
    episode: EPISODE,
    isAnime: true,
  });
  try {
    await act(() => view.state().setFilter("dub", "dub"));
    await act(() => view.state().setFilter("release", "batch"));
    assert.deepEqual(choices("Audio"), ["Any", "Subbed0 off", "Dubbed0 chosen", "Dual1"]);
  } finally {
    await view.unmount();
  }
});

test("Clear is there while something is filtered, and lets go of everything", async () => {
  const cachedOnly: boolean[] = [];
  const streams = episodeSources();
  const view = await renderModern(
    { streams, meta: SHOW, episode: EPISODE, isAnime: true, isCached: () => true },
    { shell: { onCachedOnly: (v) => cachedOnly.push(v) } },
  );
  try {
    assert.ok(!button("Clear"));
    await act(() => button("Subbed")!.click());
    await act(() => button("Batch")!.click());
    await act(() => button("Clear")!.click());
    assert.deepEqual(view.state().filters, {});
    assert.ok(!button("Clear"));
    await view.rerender({}, { cachedOnly: true });
    await act(() => button("Clear")!.click());
    assert.equal(cachedOnly.at(-1), false, "Cached only stands among the filters");
  } finally {
    await view.unmount();
  }
});

test("Cached only is the page's own switch, greyed out when it could do nothing", async () => {
  const cachedOnly: boolean[] = [];
  const onCachedOnly = (v: boolean) => cachedOnly.push(v);
  const control = () => document.querySelector<HTMLButtonElement>('button[role="switch"]')!;
  const streams = episodeSources();
  const view = await renderModern(
    { streams, meta: SHOW, episode: EPISODE, isCached: (s) => s === streams[0] },
    { shell: { onCachedOnly } },
  );
  try {
    assert.equal(control().textContent, "Cached only");
    assert.equal(control().getAttribute("aria-checked"), "false");
    assert.equal(control().disabled, false);
    await act(() => control().click());
    assert.deepEqual(cachedOnly, [true]);
    await view.rerender({}, { cachedOnly: true });
    assert.equal(control().getAttribute("aria-checked"), "true");
    await act(() => control().click());
    assert.deepEqual(cachedOnly, [true, false]);
    await view.rerender({}, { cachedOnly: false, isCached: () => false });
    assert.equal(control().disabled, true, "with nothing ready");
    await view.rerender({}, { cachedOnly: true });
    assert.equal(control().disabled, false, "a switch that is on can be switched off");
  } finally {
    await view.unmount();
  }
});

test("More filters opens the rest in place, and says how to close it", async () => {
  const streams = [
    source("A.Film.2020.1080p.WEB-DL.H.264.DTS-ALPHA.mkv"),
    source("A.Film.2020.1080p.WEB-DL.HEVC.Atmos-BRAVO.mkv"),
  ];
  const view = await renderModern({ streams, meta: film() });
  try {
    assert.equal(groupNames().includes("Video codec"), false);
    const more = button("More filters")!;
    assert.equal(more.getAttribute("aria-expanded"), "false");
    await act(() => more.click());
    assert.deepEqual(groupNames().slice(-2), ["Video codec", "Audio codec"]);
    assert.deepEqual(choices("Video codec"), ["Any chosen", "HEVC1", "AVC1"]);
    assert.equal(button("Fewer filters")!.getAttribute("aria-expanded"), "true");
    await act(() => button("Fewer filters")!.click());
    assert.equal(groupNames().includes("Video codec"), false);
  } finally {
    await view.unmount();
  }
});

test("a filter that is on among the rest keeps the rest open", async () => {
  const streams = [
    source("A.Film.2020.1080p.WEB-DL.H.264-ALPHA.mkv"),
    source("A.Film.2020.1080p.WEB-DL.HEVC-BRAVO.mkv"),
  ];
  const view = await renderModern({ streams, meta: film() });
  try {
    await act(() => view.state().setFilter("codec", "HEVC"));
    assert.deepEqual(choices("Video codec"), ["Any", "HEVC1 chosen", "AVC1"]);
    assert.equal(button("Fewer filters")!.disabled, true, "there is nothing it could close");
    await act(() => view.state().setFilter("codec", null));
    assert.deepEqual(choices("Video codec"), ["Any chosen", "HEVC1", "AVC1"], "until it is closed");
    assert.equal(button("Fewer filters")!.disabled, false);
    await act(() => button("Fewer filters")!.click());
    assert.deepEqual(choices("Video codec"), []);
    await act(() => view.state().setFilter("codec", "HEVC"));
    await act(() => view.state().clearFilters());
    assert.ok(button("Fewer filters"), "also when Clear lets it go");
  } finally {
    await view.unmount();
  }
});

test("without anything more to filter there is nothing to open", async () => {
  const view = await renderModern({ streams: [source("A.1080p.mkv")], meta: film() });
  try {
    assert.ok(!button("More filters"));
    assert.deepEqual(groupNames(), []);
  } finally {
    await view.unmount();
  }
});

test("a film's groups say HDR kinds and source kinds in plain words", async () => {
  const streams = [
    source("A.Film.2020.2160p.BluRay.REMUX.DV.HEVC-ALPHA.mkv"),
    source("A.Film.2020.1080p.BluRay.x264-BRAVO.mkv"),
    source("A.Film.2020.1080p.WEB-DL.HDR10.HEVC-CHARLIE.mkv"),
  ];
  const view = await renderModern({ streams, meta: film() });
  try {
    assert.deepEqual(groupNames().slice(0, 3), ["Resolution", "HDR", "Source"]);
    assert.deepEqual(choices("HDR"), ["Any chosen", "Dolby Vision1", "HDR101", "SDR1"]);
    assert.deepEqual(choices("Source"), ["Any chosen", "Remux1", "Blu-ray1", "WEB-DL1"]);
  } finally {
    await view.unmount();
  }
});

test("an add-on is never shown by its address, which holds its private keys", async () => {
  const secret = "https://addon.test/realdebrid=SECRETKEY123/manifest.json";
  const streams = [
    source("A.Film.2020.1080p-ALPHA.mkv", { addonUrl: secret, addonName: "Private add-on" }),
    source("A.Film.2020.1080p-BRAVO.mkv", { addonUrl: "https://other.test", addonName: "Other" }),
  ];
  const shown = () => document.body.innerHTML;
  const view = await renderModern({ streams });
  try {
    await act(() => view.state().setFilter("addon", secret));
    assert.match(shown(), /Private add-on/);
    assert.doesNotMatch(shown(), /SECRETKEY123/);
    // Refresh empties the page's list and leaves the left column where it is.
    await view.rerender({ streams: [], ranked: [], preferred: null });
    assert.doesNotMatch(shown(), /SECRETKEY123/);
    assert.match(shown(), /Private add-on/, "and it keeps the name it had");
    await view.rerender({ streams: [streams[1]], ranked: [streams[1]] });
    assert.doesNotMatch(shown(), /SECRETKEY123/);
  } finally {
    await view.unmount();
  }
  const unseen = await renderModern({ streams: [streams[1]] });
  try {
    await act(() => unseen.state().setFilter("addon", secret));
    assert.doesNotMatch(shown(), /SECRETKEY123/);
  } finally {
    await unseen.unmount();
  }
});
