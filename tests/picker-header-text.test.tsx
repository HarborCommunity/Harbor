import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { PickerHeader } from "@/views/play-picker/picker-header";

const show = { id: "tt1", type: "series", name: "A Show" } as Meta;

function header(meta: Meta, episode?: PlayEpisode, absoluteEpisode?: number | null) {
  const markup = renderToStaticMarkup(
    <PickerHeader meta={meta} episode={episode} absoluteEpisode={absoluteEpisode} />,
  );
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const result = {
    line: document.querySelector("header > p")?.textContent ?? null,
    title: document.querySelector("h1")?.textContent ?? null,
    text: document.querySelector("header > div p")?.textContent ?? null,
  };
  dom.window.close();
  return result;
}

test("the header names the season and the episode, with the show's name", () => {
  assert.deepEqual(
    header(show, { season: 1, episode: 4, name: "Rescue", overview: "What happens." }),
    {
      line: "A Show · Season 1 · Episode 04",
      title: "Rescue",
      text: "What happens.",
    },
  );
});

test("the header's description stands in the page's direction, as it always has", () => {
  const markup = renderToStaticMarkup(
    <PickerHeader
      meta={show}
      episode={{ season: 1, episode: 4, name: "Rescue", overview: "What happens." }}
    />,
  );
  assert.match(
    markup,
    /<p class="text-\[14\.5px\] leading-relaxed text-ink-muted line-clamp-2">What happens\.<\/p>/,
  );
});

test("the header follows IMDb's numbers where an episode carries them", () => {
  assert.equal(
    header(show, { season: 1, episode: 14, imdbSeason: 2, imdbEpisode: 3, name: "Rescue" }).line,
    "A Show · Season 2 · Episode 03",
  );
});

test("the header counts absolute episodes without a season", () => {
  assert.deepEqual(header(show, { season: 1, episode: 4 }, 104), {
    line: "A Show · Episode 104",
    title: "Episode 104",
    text: null,
  });
});

test("the header counts the parts of a split franchise as seasons", () => {
  assert.equal(
    header(show, { season: 17, episode: 5, kitsuStreamId: "kitsu:46903:5", imdbSeason: 17 }).line,
    "A Show · Season 2 · Episode 05",
  );
  assert.equal(
    header({ ...show, id: "kitsu:48015" }, { season: 1, episode: 12, imdbEpisode: 40 }).line,
    "A Show · Season 3 · Episode 12",
  );
});

test("an episode without a name takes the one the title's list has, else its number", () => {
  const listed = { ...show, videos: [{ season: 1, episode: 4, name: "From the list" }] } as Meta;
  assert.equal(header(listed, { season: 1, episode: 4 }).title, "From the list");
  assert.equal(header(show, { season: 1, episode: 4 }).title, "Episode 4");
});

test("a film shows its year, up to two genres and its name", () => {
  const film = { id: "tt2", type: "movie", name: "A Film" } as Meta;
  assert.deepEqual(header({ ...film, releaseInfo: "2017", genres: ["One", "Two", "Three"] }), {
    line: "2017 · One · Two",
    title: "A Film",
    text: null,
  });
  assert.equal(header({ ...film, releaseInfo: "2017" }).line, "2017");
  assert.equal(header({ ...film, genres: ["One"] }).line, null);
});
