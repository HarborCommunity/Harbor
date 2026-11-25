import assert from "node:assert/strict";
import test from "node:test";
import type { Meta } from "@/lib/cinemeta";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayEpisode } from "@/lib/view";
import type { ModernListProps } from "@/views/play-picker/modern/modern-list";
import { act, pointer, renderModern, source } from "./helpers/modern-picker.tsx";

const RD = { slug: "rd", name: "Real-Debrid" };
const TB = { slug: "tb", name: "TorBox", queueCache: () => undefined };
const debrids = (...list: unknown[]) => list as ModernListProps["debrids"];
const GB = 1024 ** 3;
const SHOW = { id: "tt7", type: "series", name: "A Show" } as Meta;
const EPISODE: PlayEpisode = { season: 1, episode: 4, name: "Rescue" };

const area = () => document.querySelector<HTMLElement>("[data-pick]");
const said = () => area()?.querySelector("[data-pick-sentence]")?.textContent ?? null;
const sentence = () => said()?.replaceAll("\u00a0", " ") ?? null;
const why = () => area()?.querySelector("[data-pick-why]")?.textContent ?? null;
const main = () => area()!.querySelector<HTMLButtonElement>("button")!;
const badges = () =>
  [...(area()?.querySelectorAll<HTMLImageElement>("[data-pick-badges] img") ?? [])].map(
    (img) => img.alt,
  );

const film = (file: string, partial: Partial<ScoredStream> = {}) =>
  source(file, { size: 1.36 * GB, seeders: 10, cached: { rd: true }, ...partial });

const three = () => [
  film("A.Film.2020.1080p.WEB-DL.H.264-ALPHA.mkv"),
  film("A.Film.2020.2160p.WEB-DL.H.265-BRAVO.mkv", { size: 24.1 * GB }),
  film("A.Film.2020.720p.BluRay.x264-CHARLIE.mkv"),
];

test("the pick is said in a sentence with its group, resolution and size", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    assert.equal(sentence(), "Harbor's pick is ALPHA in 1080p, 1.36 GB.");
    await view.rerender({ preferred: streams[1] });
    assert.equal(sentence(), "Harbor's pick is BRAVO in 4K, 24.10 GB.");
  } finally {
    await view.unmount();
  }
});

test("without a believable group the sentence says where the pick comes from", async () => {
  for (const streams of [
    [film("A.Film.2020.1080p.WEB-DL.mkv", { addonName: "Comet" })],
    [film("A.Film.2020.1080p.mkv", { addonName: "Comet", releaseGroup: "S01E04" })],
  ]) {
    const view = await renderModern({ streams, debrids: debrids(RD) });
    try {
      assert.equal(sentence(), "Harbor's pick comes from Comet, in 1080p, 1.36 GB.");
      await act(() => view.state().setFilter("resolution", "1080p"));
      assert.equal(
        sentence(),
        "With these filters, Harbor's pick comes from Comet, in 1080p, 1.36 GB.",
      );
    } finally {
      await view.unmount();
    }
  }
});

test("with filters on the sentence says so, and the pick is one they leave", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    await act(() => view.state().setFilter("resolution", "1080p"));
    assert.equal(sentence(), "With these filters, Harbor's pick is ALPHA in 1080p, 1.36 GB.");
    await act(() => view.state().setFilter("resolution", "720p"));
    assert.equal(sentence(), "With these filters, Harbor's pick is CHARLIE in 720p, 1.36 GB.");
    await act(() => view.state().setFilter("source", "WEB-DL"));
    assert.ok(!area(), "nothing left, no pick");
  } finally {
    await view.unmount();
  }
});

test("what the source did not say is named as unknown", async () => {
  const bare = source("", {
    name: "Comet",
    title: "",
    behaviorHints: undefined,
    addonName: "Comet",
    size: null,
    cached: { rd: true },
  });
  const view = await renderModern({ streams: [bare], debrids: debrids(RD) });
  try {
    assert.equal(sentence(), "Harbor's pick comes from Comet, in unknown quality, size unknown.");
  } finally {
    await view.unmount();
  }
});

test("the reasons are sentences from facts of the source", async () => {
  const cases: [string, Partial<ScoredStream>, Partial<ModernListProps>, string | null][] = [
    ["cached", {}, {}, "Cached on Real-Debrid, so it starts at once."],
    ["library", { inLibrary: { rd: true } }, {}, "In your Real-Debrid library."],
    ["add-on's word", { cached: { ad: true } }, {}, "Cached, so it starts at once."],
    [
      "can be fetched",
      { cached: {} },
      { debrids: debrids(RD, TB) },
      "Not cached yet, so TorBox has to fetch it first.",
    ],
    ["cannot be fetched", { cached: {} }, {}, "Not cached yet."],
    ["direct link", { cached: {}, infoHash: undefined, url: "https://x.test/a" }, {}, null],
    [
      "one HDR kind",
      { hdrFormat: "HDR10+" },
      {},
      "Cached on Real-Debrid, so it starts at once. With HDR10+.",
    ],
    [
      "two HDR kinds",
      { hdrFormat: "DV+HDR10" },
      {},
      "Cached on Real-Debrid, so it starts at once. With Dolby Vision and HDR10.",
    ],
  ];
  for (const [label, partial, props, expected] of cases) {
    const streams = [film("A.Film.2020.1080p.WEB-DL-ALPHA.mkv", partial)];
    const view = await renderModern({ streams, debrids: debrids(RD), ...props });
    try {
      assert.equal(why(), expected, label);
    } finally {
      await view.unmount();
    }
  }
});

test("played last, the lead in seeders and the episode are said too", async () => {
  const streams = [
    film("A.Show.S01E04.1080p.WEB-DL-ALPHA.mkv", {
      seeders: 90,
      cached: {},
      url: "u",
      infoHash: undefined,
    }),
    film("A.Show.S01E04.1080p.WEB-DL-BRAVO.mkv", { seeders: 5 }),
  ];
  const props = { streams, meta: SHOW, episode: EPISODE, debrids: debrids(RD) };
  const view = await renderModern({ ...props, lastPlayedStream: streams[0] });
  try {
    assert.equal(why(), "Played last time. Most seeders at 1080p. Exactly this episode.");
    const batch = { ...streams[0], seasonPack: true };
    await view.rerender({ streams: [batch, streams[1]], preferred: batch, lastPlayedStream: null });
    assert.equal(why(), "Most seeders at 1080p. A batch.");
  } finally {
    await view.unmount();
  }
});

test("the pick says that it was played last whenever its row does", async () => {
  const streams = three();
  const marked = () =>
    document.querySelectorAll("[data-row]")[0].textContent!.includes("Played last");
  for (const lastPlayedStream of [{ ...streams[0] }, { ...streams[0], fileIdx: 3 }]) {
    const view = await renderModern({ streams, debrids: debrids(RD), lastPlayedStream });
    try {
      assert.equal(marked(), true);
      assert.match(why()!, /^Played last time\./);
    } finally {
      await view.unmount();
    }
  }
});

/** A control of the page's, which the look only gives its place. */
const modeSwitch = <button data-mode-switch="">Both</button>;
const switches = () => [...document.querySelectorAll<HTMLElement>("[data-mode-switch]")];

test("the page's source-mode switch stands at the end of the first line, beside the sentence", async () => {
  const view = await renderModern({ streams: three(), debrids: debrids(RD), modeSwitch });
  try {
    assert.equal(switches().length, 1, "the page's own one, and no copy that keeps its room");
    const place = switches()[0].parentElement!;
    assert.match(place.className, /\bfloat-end\b.*\bms-6\b/);
    assert.ok(place.nextElementSibling?.hasAttribute("data-pick-sentence"));
    assert.equal(main().textContent, "Play", "the pick's own button is the first");
    await view.rerender({ modeSwitch: null });
    assert.ok(!area()!.querySelector('[class*="float-end"]'), "no switch, no room");
  } finally {
    await view.unmount();
  }
});

test("the switch stays where the focus is when a filter leaves no pick, and above the list", async () => {
  const view = await renderModern({ streams: three(), debrids: debrids(RD), modeSwitch });
  const [first] = switches();
  const stays = () => switches()[0] === first && document.activeElement === first;
  try {
    await act(() => first.focus());
    await act(() => view.state().setFilter("source", "Remux"));
    assert.ok(!area());
    assert.ok(stays());
    const list = document.querySelector("[data-list]")!;
    assert.ok(first.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    await act(() => view.state().clearFilters());
    assert.ok(area());
    assert.ok(stays());
  } finally {
    await view.unmount();
  }
});

test("the switch is no part of the pick, which only its own parts hold", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD), modeSwitch });
  const picked = async (preferred: ScoredStream) => {
    await view.rerender({ preferred });
    return /pick is (\w+)/.exec(sentence()!)![1];
  };
  const now = () => /pick is (\w+)/.exec(sentence()!)![1];
  try {
    await pointer("enter", switches()[0]);
    assert.equal(await picked(streams[1]), "BRAVO");
    await pointer("enter", area()!.querySelector("[data-pick-sentence]")!);
    assert.equal(await picked(streams[0]), "BRAVO");
    await pointer("enter", switches()[0]);
    assert.equal(now(), "ALPHA", "on the way to the switch it is let go");
    await act(() => main().focus());
    assert.equal(await picked(streams[2]), "ALPHA");
    await act(() => switches()[0].focus());
    assert.equal(now(), "CHARLIE");
    assert.equal(await picked(streams[1]), "BRAVO");
  } finally {
    await view.unmount();
  }
});

test("a first line without a pick holds none back", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD), modeSwitch });
  try {
    await act(() => view.state().setFilter("source", "Remux"));
    await pointer("enter", switches()[0].closest("section")!);
    const remux = [...streams, film("A.Film.2020.1080p.BluRay.REMUX.AVC-DELTA.mkv")];
    await view.rerender({ streams: remux, ranked: remux });
    assert.match(sentence()!, /DELTA/);
  } finally {
    await view.unmount();
  }
});

test("a pick that goes away while it is pointed at or has the focus is let go", async () => {
  const streams = three();
  for (const reach of [() => pointer("enter", main()), () => act(() => main().focus())]) {
    const view = await renderModern({ streams, debrids: debrids(RD), modeSwitch });
    try {
      await reach();
      await act(() => view.state().setFilter("source", "Remux"));
      assert.ok(!area());
      await act(() => view.state().clearFilters());
      await view.rerender({ preferred: streams[1] });
      assert.match(sentence()!, /BRAVO/);
    } finally {
      await view.unmount();
    }
  }
});

test("a size is not torn from its unit at the end of a line", async () => {
  const view = await renderModern({ streams: three(), debrids: debrids(RD) });
  try {
    assert.match(said()!, /, 1\.36\u00a0GB\.$/);
  } finally {
    await view.unmount();
  }
});

test("a source remembered for the title is played, and nobody has to fetch it first", async () => {
  const streams = ["ALPHA", "BRAVO"].map((group) =>
    film(`A.Film.2020.1080p.WEB-DL-${group}.mkv`, { cached: {}, seeders: null }),
  );
  const view = await renderModern({ streams, debrids: debrids(TB) });
  try {
    for (const previousMatch of [null, streams[1]]) {
      await view.rerender({ previousMatch });
      assert.equal(main().textContent, "Cache on TorBox");
      assert.equal(why(), "Not cached yet, so TorBox has to fetch it first.");
    }
    await view.rerender({ previousMatch: streams[0] });
    assert.equal(main().textContent, "Play");
    assert.equal(why(), null);
  } finally {
    await view.unmount();
  }
});

test("the main button plays or queues through the page", async () => {
  const streams = [
    film("A.Film.2020.1080p.WEB-DL-ALPHA.mkv"),
    film("A.Film.2020.1080p.WEB-DL-BRAVO.mkv", { cached: {} }),
  ];
  const calls: [string, unknown][] = [];
  const view = await renderModern({
    streams,
    debrids: debrids(TB, RD),
    onPlay: (s) => calls.push(["play", s]),
    onCache: (s) => calls.push(["cache", s]),
  });
  try {
    await act(() => main().click());
    await view.rerender({ preferred: streams[1] });
    await act(() => main().click());
    assert.deepEqual(calls, [
      ["play", streams[0]],
      ["cache", streams[1]],
    ]);
    await view.rerender({ queuedHash: streams[1].infoHash });
    assert.equal(main().textContent, "Queued on TorBox");
    assert.equal(main().disabled, true);
    await view.rerender({ preferred: streams[0], inSession: true });
    assert.equal(main().textContent, "Play Together");
    await view.rerender({ resolvingStream: streams[1] });
    assert.equal(main().textContent, "Play Together", "another source is being connected");
    await view.rerender({ resolvingStream: streams[0] });
    assert.equal(main().textContent, "Connecting");
  } finally {
    await view.unmount();
  }
});

test("a source that failed is not the pick, and stays out after the next partial result", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    await view.rerender({ failedStreams: new Set([streams[0]]) });
    assert.equal(sentence(), "Harbor's pick is BRAVO in 4K, 24.10 GB.");
    const fresh = streams.map((s) => ({ ...s }));
    await view.rerender({ streams: fresh, ranked: fresh, preferred: fresh[0] });
    assert.equal(
      sentence(),
      "Harbor's pick is BRAVO in 4K, 24.10 GB.",
      "every partial result brings new objects",
    );
  } finally {
    await view.unmount();
  }
});

test("when every source has failed the pick stays, says so, and can be tried again", async () => {
  const streams = three();
  const played: unknown[] = [];
  const view = await renderModern({
    streams,
    debrids: debrids(RD),
    preferred: streams[1],
    failedStreams: new Set(streams),
    onPlay: (s) => played.push(s),
  });
  try {
    assert.equal(sentence(), "Harbor's pick is BRAVO in 4K, 24.10 GB.");
    assert.equal(why(), "Unavailable, try another.", "and not that it starts at once");
    await act(() => main().click());
    assert.deepEqual(played, [streams[1]]);
    await act(() => view.state().setFilter("resolution", "720p"));
    assert.match(sentence()!, /CHARLIE/);
    assert.equal(why(), "Unavailable, try another.");
    await view.rerender({ failedStreams: new Set([streams[0]]) });
    assert.notEqual(why(), "Unavailable, try another.");
  } finally {
    await view.unmount();
  }
});

test("the page's remembered source is the pick also as a copy with another file number", async () => {
  const streams = three();
  const copy = { ...streams[2], fileIdx: 7 };
  const played: unknown[] = [];
  const view = await renderModern({
    streams,
    debrids: debrids(RD),
    preferred: copy,
    previousMatch: copy,
    onPlay: (s) => played.push(s),
  });
  try {
    assert.equal(sentence(), "Harbor's pick is CHARLIE in 720p, 1.36 GB.");
    assert.equal(why(), "Cached on Real-Debrid, so it starts at once.", "its row is no rival");
    await act(() => main().click());
    assert.deepEqual(played, [copy], "the page's own object is played, with its file number");
  } finally {
    await view.unmount();
  }
});

test("while the pick is pointed at it does not change, and it still plays", async () => {
  const streams = three();
  const played: unknown[] = [];
  const view = await renderModern({
    streams,
    debrids: debrids(RD),
    onPlay: (s) => played.push(s),
  });
  try {
    await pointer("enter", area()!);
    await view.rerender({ streams: [streams[1]], ranked: [streams[1]], preferred: streams[1] });
    assert.equal(sentence(), "Harbor's pick is ALPHA in 1080p, 1.36 GB.");
    await act(() => main().click());
    assert.deepEqual(played, [streams[0]], "the page has dropped it meanwhile");
    const fresh = streams.map((s) => ({ ...s, size: 2 * GB }));
    await view.rerender({ streams: fresh, ranked: fresh, preferred: fresh[1] });
    assert.equal(
      sentence(),
      "Harbor's pick is ALPHA in 1080p, 2.00 GB.",
      "the newest facts of the same source",
    );
    await pointer("leave", area()!);
    assert.equal(sentence(), "Harbor's pick is BRAVO in 4K, 2.00 GB.");
  } finally {
    await view.unmount();
  }
});

test("a pick that comes to lie under a mouse nobody moved is not held, and one that is let go", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    await pointer("rest", area()!);
    await view.rerender({ preferred: streams[1] });
    assert.match(sentence(), /BRAVO/);
    await pointer("enter", main());
    await view.rerender({ preferred: streams[2] });
    assert.match(sentence(), /BRAVO/);
    await pointer("leave", document.body);
    assert.match(sentence(), /CHARLIE/);
  } finally {
    await view.unmount();
  }
});

test("a pick that has the focus does not change either", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    await act(() => main().focus());
    await view.rerender({ preferred: streams[1] });
    assert.equal(sentence(), "Harbor's pick is ALPHA in 1080p, 1.36 GB.");
    await act(() => main().blur());
    assert.equal(sentence(), "Harbor's pick is BRAVO in 4K, 24.10 GB.");
  } finally {
    await view.unmount();
  }
});

test("a filter always applies to the pick at once", async () => {
  const streams = three();
  const view = await renderModern({ streams, debrids: debrids(RD) });
  try {
    await pointer("enter", area()!);
    await act(() => view.state().setFilter("resolution", "720p"));
    assert.equal(sentence(), "With these filters, Harbor's pick is CHARLIE in 720p, 1.36 GB.");
  } finally {
    await view.unmount();
  }
});

test("Harbor's badges stand under the sentence while that setting is on", async () => {
  const streams = [film("A.Film.2020.2160p.WEB-DL.DV.DDP5.1.H.265-ALPHA.mkv")];
  const props = { streams, debrids: debrids(RD) };
  const on = await renderModern(props, { settings: { showQualityBadge: true } });
  try {
    assert.deepEqual(badges(), [
      "4K UHD",
      "WEB-DL",
      "HEVC / x265",
      "Dolby Vision",
      "Dolby Digital Plus",
    ]);
  } finally {
    await on.unmount();
  }
  const off = await renderModern(props, { settings: { showQualityBadge: false } });
  try {
    assert.deepEqual(badges(), []);
    assert.ok(sentence());
  } finally {
    await off.unmount();
  }
});
