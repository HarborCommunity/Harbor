import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./_localstorage-stub.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { parseStoredSettings } from "../src/lib/settings/load.ts";

const defaults = readFileSync(new URL("../src/lib/settings/defaults.ts", import.meta.url), "utf8");

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
