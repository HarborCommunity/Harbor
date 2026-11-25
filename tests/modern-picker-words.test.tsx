import assert from "node:assert/strict";
import test from "node:test";
import { act, renderModern, source } from "./helpers/modern-picker.tsx";

const { registerUiCatalog } = await import("../src/lib/i18n/translate.ts");

const tally = () => document.querySelector("[data-tally]")!.textContent;
const films = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    source(`A.Film.2020.${i === 0 ? "2160p" : "1080p"}.WEB-DL-G${i}.mkv`),
  );

test("each count of the left column takes a language's own plural form", async () => {
  const forms = (key: string) => ({
    [key]: `many: ${key}`,
    [`${key}#one`]: `one: ${key}`,
    [`${key}#few`]: `few: ${key}`,
  });
  registerUiCatalog("pl", {
    ...forms("{n} source"),
    ...forms("{n} sources"),
    ...forms("{n} sources so far"),
    ...forms("{shown} of {total} sources"),
    ...forms("{ready} ready to start at once"),
    ...forms("None of the {n} sources match these filters."),
  });
  for (const [count, form, word, ready, readyForm] of [
    [1, "one", "source", 0, "many"],
    [3, "few", "sources", 1, "one"],
    [5, "many", "sources", 2, "few"],
    [22, "few", "sources", 5, "many"],
    [5, "many", "sources", 1, "one"],
  ] as const) {
    const streams = films(count);
    const view = await renderModern(
      { streams, isCached: (s) => streams.indexOf(s) < ready },
      { settings: { uiLanguage: "pl" } },
    );
    try {
      const start = `${readyForm}: ${ready} ready to start at once`;
      assert.equal(tally(), `${form}: ${count} ${word} · ${start}`);
      if (count === 1) continue;
      await view.rerender({}, { pipelineDone: false });
      assert.equal(tally(), `${form}: ${count} sources so far · ${start}`);
      await act(() => view.state().setFilter("resolution", "4K"));
      assert.equal(
        tally(),
        `one: 1 of ${count} sources · ${ready > 0 ? "one: 1" : "many: 0"} ready to start at once`,
      );
      await act(() => view.state().setFilter("source", "CAM"));
      assert.equal(tally(), `${form}: None of the ${count} sources match these filters.`);
    } finally {
      await view.unmount();
    }
  }
});
