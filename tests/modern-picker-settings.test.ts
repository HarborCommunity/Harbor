import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settingsSearchEntries } from "../scripts/settings-search-entries.mjs";
import "./_localstorage-stub.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { parseStoredSettings } from "../src/lib/settings/load.ts";

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const defaults = read("lib/settings/defaults.ts");
const pickerTab = read("views/settings/streaming-sources-panel/picker-tab.tsx");
const preview = read("views/settings/streaming-sources-panel/picker-layout-preview.tsx");
const search = settingsSearchEntries(read("views/settings/nav.tsx"));

test("the picker still opens in the Stremio look, and the modern look starts plain and unsorted", () => {
  assert.match(defaults, /^ {2}pickerLayout: "stremio",$/m);
  assert.match(defaults, /^ {2}pickerModernSort: null,$/m);
  assert.match(defaults, /^ {2}pickerModernBackdrop: false,$/m);
});

test("settings from before the modern look get its starting values", () => {
  for (const raw of [null, "{}", '{"pickerLayout":"stremio"}']) {
    const { settings } = parseStoredSettings(raw);
    assert.equal(settings.pickerLayout, "stremio", String(raw));
    assert.equal(settings.pickerModernSort, null, String(raw));
    assert.equal(settings.pickerModernBackdrop, false, String(raw));
  }
});

test("the modern look and its two values survive a restart", () => {
  const stored = {
    ...DEFAULT,
    pickerLayout: "modern",
    pickerModernSort: { key: "seeders", dir: "asc" },
    pickerModernBackdrop: true,
  };
  for (const raw of [stored, { ...stored, _pickerLayoutStremioV2: true }]) {
    const { settings } = parseStoredSettings(JSON.stringify(raw));
    assert.equal(settings.pickerLayout, "modern");
    assert.deepEqual(settings.pickerModernSort, { key: "seeders", dir: "asc" });
    assert.equal(settings.pickerModernBackdrop, true);
  }
});

test("the condensed look chosen by hand is still kept", () => {
  const raw = JSON.stringify({ pickerLayout: "condensed", _pickerLayoutStremioV2: true });
  assert.equal(parseStoredSettings(raw).settings.pickerLayout, "condensed");
});

test("the modern look is the last choice, and the two others stand where they stood", () => {
  const [options] = /const options = \[[\s\S]*?\] as const;/.exec(pickerTab)!;
  assert.deepEqual(
    [...options.matchAll(/id: "(\w+)"/g)].map(([, id]) => id),
    ["condensed", "stremio", "modern"],
  );
  const says = (words: string) => pickerTab.indexOf(words);
  assert.ok(says("Stremio is a flat list") > 0);
  assert.ok(says('"Harbor Modern puts the picture') > says("Stremio is a flat list"));
});

test("the settings offer the modern look, say what it is and what its artwork does", () => {
  assert.match(pickerTab, /id: "modern", label: t\("Harbor Modern"\)/);
  assert.match(pickerTab, /t\(\s*"Harbor Modern puts the picture and the filters at the side/);
  assert.match(
    pickerTab,
    /label=\{t\("Artwork behind the picker"\)\}[\s\S]*?value=\{settings\.pickerModernBackdrop\}\s+onChange=\{\(v\) => update\(\{ pickerModernBackdrop: v \}\)\}/,
  );
  assert.match(
    pickerTab,
    /t\(\s*"In Harbor Modern it shows file names in full, and the addon's whole description where there is no file name\.",?\s*\)/,
  );
});

test("what Harbor says today and has translated is kept word for word", () => {
  for (const words of [
    "Condensed shows a top pick, quality tiles, and a drawer. Stremio is a flat list grouped by addon, no scoring.",
    "Show release filenames in the Condensed picker and Big Picture.",
    "Show complete addon descriptions in the Stremio picker, downloads, and Big Picture.",
    "Condensed",
  ]) {
    assert.ok(pickerTab.includes(`"${words}"`), words);
  }
  const labels = search.filter((entry) => entry.anchor === "Picker layout").map((e) => e.label);
  assert.deepEqual(labels, ["Picker layout (Condensed / Stremio)", "Picker layout"]);
});

test("the small picture in the settings is drawn from the look's own parts", () => {
  const modern = preview.slice(preview.indexOf('layout === "modern"'));
  assert.match(modern, /<ModernShell\b/);
  assert.match(modern, /<ModernList\b/);
});

test("the settings search finds the modern look and its artwork", () => {
  const found = (word: string) =>
    search
      .filter((entry) => [entry.label, ...entry.keywords].some((text) => text.includes(word)))
      .map((entry) => `${entry.section} > ${entry.tab} > ${entry.anchor}`);
  assert.ok(found("harbor modern").includes("streaming > picker > Picker layout"));
  assert.deepEqual(found("Artwork behind the picker"), ["streaming > picker > Picker details"]);
});
