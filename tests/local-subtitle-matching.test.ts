// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { findMatchingSubtitles } from "../src/lib/subtitles/local-subtitle-matching.ts";

const show = { title: "Dark", season: 2, episode: 3 };

test("matches translated anime titles through provider aliases and the resolved release", () => {
  const root = "/subs";
  const anime = `${root}/[Crunchyroll] Watashi wo Tabetai, Hitodenashi - 02.ass`;
  const wrongEpisode = `${root}/[Crunchyroll] Watashi wo Tabetai, Hitodenashi - 01.ass`;
  const media = {
    title: "This Monster Wants to Eat Me",
    mediaType: "anime" as const,
    season: 1,
    episode: 2,
  };
  const files = [wrongEpisode, anime];
  assert.deepEqual(
    findMatchingSubtitles(files, { ...media, alternateTitles: ["Watashi o Tabetai, Hitodenashi"] }),
    [{ path: anime }],
  );
  assert.deepEqual(
    findMatchingSubtitles(files, {
      ...media,
      releaseFilename: "[SubsPlease] Watashi wo Tabetai, Hitodenashi - 02 (1080p).mkv",
    }),
    [{ path: anime }],
  );
  assert.deepEqual(
    findMatchingSubtitles(files, {
      ...media,
      releaseFilename: "[SubsPlease] Watashi wo Tabetai, Hitodenashi - 01 (1080p).mkv",
    }),
    [],
  );
});

test("release aliases require the correct season, episode, or movie year", () => {
  const tv = "/subs/Der.Palast.S02E03.en.srt";
  const movie = "/subs/Il.Viaggio.2024.ar.srt";
  const files = [tv, movie, "/subs/Il.Viaggio.2019.ar.srt", "/subs/Episode.S02E03.en.srt"];
  assert.deepEqual(
    findMatchingSubtitles(files, {
      ...show,
      title: "The Palace",
      releaseFilename: "Der.Palast.S02E03.WEB-DL.mkv",
    }),
    [{ path: tv, language: "en" }],
  );
  for (const releaseFilename of [
    "Der.Palast.S01E03.mkv",
    "Der.Palast.S02E03E04.mkv",
    "Episode.S02E03.mkv",
  ]) {
    assert.deepEqual(
      findMatchingSubtitles(files, { ...show, title: "The Palace", releaseFilename }),
      [],
    );
  }
  const film = { title: "The Journey", year: 2024, mediaType: "movie" as const };
  assert.deepEqual(
    findMatchingSubtitles(files, { ...film, releaseFilename: "Il.Viaggio.2024.1080p.mkv" }),
    [{ path: movie, language: "ar" }],
  );
  assert.deepEqual(
    findMatchingSubtitles(files, { ...film, releaseFilename: "Il.Viaggio.2019.mkv" }),
    [],
  );
});

test("matches a movie subtitle with a release label and spelled-out ampersand", () => {
  const movie =
    "/subs/[Nazo] Trinity Seven Movie - Eternity Library and Alchemic Girl [BD][DameDesuYo].ass";
  const episode = "/subs/[Zero-Kon] Trinity Seven - 02 [BD][DameDesuYo].ass";
  assert.deepEqual(
    findMatchingSubtitles([episode, movie], {
      title: "Trinity Seven: Eternity Library & Alchemic Girl",
      year: 2017,
      mediaType: "movie",
    }),
    [{ path: movie }],
  );
});

test("matches extracted SubSource season packs with Romanized filenames", () => {
  const root = "C:\\Subtitles";
  const pack = (season: number, file: string, slug = "re-zero") =>
    `${root}\\${slug}-starting-life-in-another-world-season-${season}-2016_arabic_123-[SubSource]\\${file}`;
  const season2 = pack(2, "[Group] Re Zero kara Hajimeru Isekai Seikatsu - 27 [S2-02][BD].ass");
  const season3 = pack(3, "[Group]  ReZero kara Hajimeru Isekai Seikatsu S03 - 02.ass");
  const season4 = pack(
    4,
    "[CR] Re Zero kara Hajimeru Isekai Seikatsu 4th Season - 02.ass",
    "rezero",
  );
  const files = [
    pack(1, "[CR] ReZero kara Hajimeru Isekai Seikatsu Shin Henshuu-ban - 02.ass"),
    season2,
    season3,
    season4,
    pack(3, "[CR] ReZero kara Hajimeru Isekai Seikatsu S04 - 02.ass"),
    pack(3, "[Group] ReZero kara Hajimeru Isekai Seikatsu S03 - 01.ass"),
  ];
  const media = { title: "Re:ZERO -Starting Life in Another World- Season 3", episode: 2 };
  for (const [season, path] of [
    [2, season2],
    [3, season3],
    [4, season4],
  ] as const) {
    assert.deepEqual(findMatchingSubtitles(files, { ...media, season }, ["ar"], root), [
      { path, language: "ar" },
    ]);
  }
  assert.deepEqual(findMatchingSubtitles(files, { ...media, season: 1 }, ["ar"], root), []);
  assert.deepEqual(findMatchingSubtitles(files, { ...media, season: 3 }, ["en"], root), []);
});

test("requires the right season or a matching season directory", () => {
  const files = [
    "/subs/Dark.S01E03.srt",
    "/subs/Dark.S01E04.03.srt",
    "/subs/Dark.1x03.srt",
    "/subs/Dark.Episode.03.srt",
    "/subs/Dark/Season 1/03.srt",
    "/subs/Dark/Season 1/Dark.S02E03.srt",
    "/subs/Dark/Season 2/03.srt",
    "/subs/Dark/Season 2/Dark.S02E04.03.srt",
    "/subs/Dark/Season 2/Other Show.E03.srt",
    "/subs/Dark Matter.S02E03.srt",
    "/subs/Dark.S02E03.srt",
    "/subs/Dark.E03.Season.1.srt",
  ];
  assert.deepEqual(findMatchingSubtitles(files, show), [{ path: files[10] }, { path: files[6] }]);
});

test("matches Windows paths, written season-episode markers and alternate numbering", () => {
  const files = [
    "C:\\Subtitle Library\\Dark.2x03.eng.ass",
    "C:\\Subtitle Library\\Dark Season 2 Episode 03.en.vtt",
    "C:\\Subtitle Library\\Dark.S02E03-E04.en.srt",
    "C:\\Subtitle Library\\Dark.S02E03E04.en.srt",
  ];
  assert.deepEqual(findMatchingSubtitles(files, show, ["English"], "C:\\Subtitle Library\\"), [
    { path: files[1], language: "en" },
    { path: files[0], language: "en" },
  ]);
});

test("supports season-one and absolute anime numbering without overriding explicit seasons", () => {
  const bare = "/subs/[Team] One Piece - 03v2 [1080p].ass";
  const absolute = "/subs/One Piece/103.srt";
  assert.deepEqual(findMatchingSubtitles([bare], { title: "One Piece", episode: 3 }), [
    { path: bare },
  ]);
  assert.deepEqual(
    findMatchingSubtitles(
      [bare, absolute, "/subs/One Piece.S01E103.srt", "/subs/One Piece.S02E103.srt"],
      { title: "One Piece", season: 2, episode: 3, absoluteNumber: 103 },
    ),
    [{ path: absolute }],
  );
  assert.deepEqual(
    findMatchingSubtitles([absolute], {
      title: "One Piece",
      mediaType: "series",
      season: 2,
      episode: 3,
      absoluteNumber: 103,
    }),
    [],
  );
});

test("uses season folders with a release year to resolve bare episode numbers", () => {
  const correct = "/subs/Dark/Season 2 (2019)/03.eng.srt";
  const wrong = "/subs/Dark/Season 1 (2017)/Dark.S02E03.eng.srt";
  assert.deepEqual(findMatchingSubtitles([wrong, correct], show, ["en"], "/subs"), [
    { path: correct, language: "en" },
  ]);
});

test("keeps specials separate from regular episodes", () => {
  const files = [
    "/subs/Dark.OVA.03.srt",
    "/subs/Dark/Specials/03.srt",
    "/subs/Dark.03.srt",
    "/subs/Dark.E03.OVA.srt",
  ];
  assert.deepEqual(findMatchingSubtitles(files, { ...show, season: 1 }), [{ path: files[2] }]);
  assert.deepEqual(findMatchingSubtitles(files, { ...show, season: 0 }), [
    { path: files[3] },
    { path: files[0] },
    { path: files[1] },
  ]);
});

test("handles dated episode releases and bracketed numbers in a title folder", () => {
  const files = ["/subs/Dark.2017.Episode.03.en.srt", "/subs/Dark/[03].en.srt"];
  assert.deepEqual(findMatchingSubtitles(files, { ...show, season: 1 }), [
    { path: files[0], language: "en" },
    { path: files[1], language: "en" },
  ]);
});

test("uses movie aliases and release years, and avoids similarly named sequels and episodes", () => {
  const movie = {
    title: "Dune",
    alternateTitles: ["Duna"],
    mediaType: "movie" as const,
    year: 2021,
  };
  const files = [
    "/subs/Dune.1984.English.srt",
    "/subs/Dune.Part.Two.2024.en.srt",
    "/subs/Dune.S01E01.en.srt",
    "/subs/Duna.2021.1080p.WEB-DL.en.srt",
    "/subs/Dune.eng.srt",
    "/subs/Dune (1984)/English.srt",
    "/subs/Dune (2021)/Subs/en.srt",
    "/subs/Dune (2021)/Other Movie/en.srt",
  ];
  assert.deepEqual(findMatchingSubtitles(files, movie, ["en"]), [
    { path: files[3], language: "en" },
    { path: files[6], language: "en" },
    { path: files[4], language: "en" },
  ]);
});

test("requires complete title matches for short or numeric movie titles", () => {
  const it = "/subs/It.2017.en.srt";
  assert.deepEqual(
    findMatchingSubtitles(["/subs/It.Follows.2014.en.srt", "/subs/ITV.2017.en.srt", it], {
      title: "It",
      year: 2017,
    }),
    [{ path: it, language: "en" }],
  );
  const movie = "/subs/1917.2019.srt";
  assert.deepEqual(findMatchingSubtitles([movie], { title: "1917", year: 2019 }), [
    { path: movie },
  ]);
});

test("matches Japanese, Chinese and Arabic titles without losing Unicode distinctions", () => {
  const cases = [
    {
      title: "すずめの戸締まり",
      file: "/subs/【字幕組】すずめの戸締まり - S01E03.jpn.ass",
      language: "ja",
    },
    { title: "三体", file: "/subs/三体第０３集.中文.srt", language: "zh" },
    { title: "الاختيار", file: "/subs/الاِختِيَار - Episode ٠٣.العربية.srt", language: "ar" },
  ];
  for (const { title, file, language } of cases) {
    assert.deepEqual(
      findMatchingSubtitles(
        [file],
        { title: "English title", alternateTitles: [title], episode: 3 },
        [language],
      ),
      [{ path: file, language }],
    );
  }
  assert.deepEqual(
    findMatchingSubtitles(["/subs/すすめの戸締まり.03.srt"], {
      title: "すずめの戸締まり",
      episode: 3,
    }),
    [],
  );
});

test("recognizes accented language names on files and in folders", () => {
  const french = "/subs/Dark.S02E03.Français.srt";
  const spanish = "/subs/Dark/Season 2/Español/03.srt";
  const untagged = "/subs/Dark.S02E03.srt";
  assert.deepEqual(findMatchingSubtitles([french, spanish, untagged], show, ["Spanish"]), [
    { path: spanish, language: "es" },
    { path: untagged },
  ]);
});

test("ranks preferred subtitle languages, including aliases and regional variants", () => {
  const files = [
    "/subs/Dark.S02E03.srt",
    "/subs/Dark.S02E03.eng.SDH.srt",
    "/subs/Dark.S02E03.pt-BR.srt",
    "/subs/Dark.S02E03.por.srt",
    "/subs/Dark.S02E03.ar.srt",
    "/subs/Dark/Season 2/English/E03.srt",
  ];
  const expected = [
    { path: files[2], language: "pt-br" },
    { path: files[3], language: "pt" },
    { path: files[1], language: "en" },
    { path: files[5], language: "en" },
    { path: files[0] },
  ];
  assert.deepEqual(
    findMatchingSubtitles(files, show, ["Portuguese (Brazil)", "English"]),
    expected,
  );
  assert.deepEqual(findMatchingSubtitles([...files].reverse(), show, ["pt-br", "en"]), expected);
  assert.deepEqual(findMatchingSubtitles([files[4]], show, ["English"]), []);
});

test("only considers title and language directories at or below the selected folder", () => {
  const file = "/subs/Arabic/Dark/Season 2/03.srt";
  assert.deepEqual(findMatchingSubtitles([file], show, ["en"], "/subs/Arabic/Dark/"), [
    { path: file },
  ]);
  assert.deepEqual(findMatchingSubtitles([file], show, ["en"], "/subs/Arabic/Dark/Season 2"), []);
});

test("reports forced subtitle tags without treating a title as a forced tag", () => {
  const plain = "/subs/Forced.Vengeance.1982.en.srt";
  const forced = "/subs/Forced.Vengeance.1982.eng.forced.srt";
  assert.deepEqual(
    findMatchingSubtitles([plain, forced], { title: "Forced Vengeance", year: 1982 }, ["en"]),
    [
      { path: plain, language: "en" },
      { path: forced, language: "en", forced: true },
    ],
  );
  const episode = "/subs/Dark.S02E03.The.Forced.Hand.en.srt";
  assert.deepEqual(findMatchingSubtitles([episode], show), [{ path: episode, language: "en" }]);
});
