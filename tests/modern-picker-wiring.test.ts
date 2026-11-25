import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const picker = read("src/views/play-picker.tsx");

test("the page draws the modern look, and never for a download", () => {
  assert.match(picker, /const modern = settings\.pickerLayout === "modern" && !isDownload;/);
  assert.match(picker, /<PickerBody\b/);
  assert.match(picker, /<ModernList\b/);
});

test("the modern list, the Stremio list and the condensed parts are one branch in that order", () => {
  const modernList = picker.indexOf("<ModernList");
  const stremio = picker.indexOf("<StremioLayout");
  const condensed = picker.indexOf("<PrimaryCard");
  assert.ok(modernList >= 0 && stremio > modernList && condensed > stremio);
  assert.match(
    picker,
    /const modernList = modern && filteredPicker && filteredPicker\.all\.length > 0;/,
    "the modern list needs rows, as the Stremio list does",
  );
  assert.match(picker, /\{modernList \? \(\s*<ModernList/);
  assert.match(
    picker,
    /\) : \(settings\.pickerLayout === "stremio" \|\| isDownload\) &&\s*filteredPicker &&\s*filteredPicker\.all\.length > 0 \? \(\s*<StremioLayout/,
    "what decides about the Stremio list has not changed",
  );
});

test("the one source-mode switch still comes before the look is chosen", () => {
  const toggles = picker.match(/<StreamModeToggle/g) ?? [];
  assert.equal(toggles.length, 1);
  const toggleAt = picker.indexOf("<StreamModeToggle");
  assert.ok(toggleAt < picker.indexOf("<ModernList"));
  assert.ok(toggleAt < picker.indexOf('(settings.pickerLayout === "stremio"'));
});

test("the drawer's keys and wheel still belong to the condensed look alone", () => {
  assert.match(picker, /if \(settings\.pickerLayout !== "condensed" \|\| !node\) return;/);
});

test("the page's header and narrow column stay with the other looks", () => {
  assert.match(picker, /\{!modern && \(\s*<PickerHeader/);
  assert.equal((picker.match(/<PickerHeader/g) ?? []).length, 1);
  assert.match(
    picker,
    /<PickerBody\s[^<]*<PickerNav[^>]*\/>\}\s+shell=\{\s*modern\s+\? \{[^}]*\}\s+: null\s*\}/,
  );
});

test("the artwork behind the picker is an option of the modern look only", () => {
  assert.match(
    picker,
    /\{\(!modern \|\| settings\.pickerModernBackdrop\) && <BackdropLayer src=\{backdropSrc\} \/>\}/,
  );
  assert.equal((picker.match(/<BackdropLayer/g) ?? []).length, 1);
});

test("the modern look plays and queues through the page", () => {
  const list = picker.slice(picker.indexOf("<ModernList"), picker.indexOf("<StremioLayout"));
  assert.match(list, /onPlay=\{playManually\}/);
  assert.match(list, /onCache=\{onCache\}/);
  assert.match(list, /streams=\{displayStreams\}/);
  assert.match(list, /ranked=\{filteredPicker\.ranked\}/);
  assert.match(list, /noneCached=\{filteredPicker\.noneCached\}\s+onCachedOnly=\{setCachedOnly\}/);
  assert.match(
    picker,
    /const primaryCandidates = \[hostBest, result\.picker\.primary, \.\.\.ranked\][\s\S]*?return \{ primary, byTier, all, allRaw, ranked, fellBack, noneCached \};/,
    "the order the page itself takes its best source from: ready first, in a room the host's",
  );
  assert.match(
    list,
    /preferred=\{previousMatch \?\? sameSourceMatch \?\? filteredPicker\.primary\}/,
  );
  assert.match(
    list,
    /orderName=\{hostMatch \? "together" : addonOrderMode \? "addon" : "harbor"\}/,
  );
});

test("every refresh a person asks for forgets what has failed, in the modern look only", () => {
  const [lines] = /const askAgain = \(\) => \{[\s\S]*?\n {2}\};/.exec(picker) ?? [];
  assert.ok(lines, "the page's own lines, which are run here");
  for (const modern of [true, false]) {
    const done: string[] = [];
    const forget = (failed: Set<unknown>) => done.push(`forget ${failed.size}`);
    const refresh = () => done.push("refresh");
    new Function("modern", "setFailedStreams", "refresh", `${lines}\naskAgain();`)(
      modern,
      forget,
      refresh,
    );
    assert.deepEqual(done, modern ? ["forget 0", "refresh"] : ["refresh"]);
  }
  assert.match(
    picker,
    /<PickerNav\s+onBack=\{backToDetail\}\s+onRefresh=\{askAgain\}\s+refreshing=\{loading\}\s*\/>/,
  );
  const rechecks = [...picker.matchAll(/<button\s+onClick=\{(\w+)\}[^>]*>\s*\{t\("Recheck"\)\}/g)];
  assert.deepEqual(
    rechecks.map(([, handler]) => handler),
    ["askAgain", "askAgain"],
    "of the debrid's banner and of the sources that could not be reached",
  );
  assert.equal((picker.match(/t\("Recheck"\)/g) ?? []).length, 2);
});

type Entry = { name: string; cached: boolean; page: boolean };
const ready = { name: "ready", cached: true, page: false };
const other = { name: "not ready", cached: false, page: false };
const notice = { name: "notice with a sign", cached: true, page: true };

/** The page's own lines for Cached only, which are run here. */
const cachedOnlyLines = () => {
  const [lines] = /if \(cachedOnly && [^{]*\) \{[\s\S]*?\n {4}\}/.exec(picker) ?? [];
  assert.ok(lines, "the page's own lines have changed");
  return lines;
};
const left = (all: Entry[], modern: boolean, cachedOnly = true, debrids = ["tb"]): string[] => {
  const args = ["cachedOnly", "debrids", "all", "isCached", "modern", "opensPage"];
  const run = new Function(...args, `let noneCached;\n${cachedOnlyLines()}\nreturn all;`);
  const isCached = (s: Entry) => s.cached;
  const opensPage = (s: Entry) => s.page;
  return run(cachedOnly, debrids, all, isCached, modern, opensPage).map((s: Entry) => s.name);
};

test("with Cached only on the modern look has no entry that only opens a web page", () => {
  const list = [notice, ready, other];
  assert.deepEqual(left(list, true), ["ready"]);
  assert.deepEqual(left(list, false), ["notice with a sign", "ready"], "the other looks as before");
  assert.deepEqual(
    left([notice, other], true),
    [notice.name, other.name],
    "nothing is cached, which the look is told",
  );
  assert.deepEqual(left([notice, other], false), [notice.name]);
  const lines = cachedOnlyLines();
  const memo = picker.slice(picker.indexOf(lines), picker.indexOf("const anyAddonRanked"));
  assert.match(memo, /\}, \[[^\]]*\bmodern\b[^\]]*\]\);/, "the list follows the look");
});

test("Cached only needs no debrid in Harbor in the modern look, and one in the others, as before", () => {
  const lists = [[notice, ready, other], [notice, other], [other], [ready], []];
  for (const list of lists) {
    const names = list.map((s) => s.name);
    assert.deepEqual(left(list, true, true, []), left(list, true), "with or without a debrid");
    for (const modern of [true, false]) {
      for (const debrids of [[], ["tb"]]) {
        assert.deepEqual(left(list, modern, false, debrids), names, "the switch is off");
      }
    }
    assert.deepEqual(left(list, false, true, []), names, "the other looks, and a download");
    const cached = list.filter((s) => s.cached).map((s) => s.name);
    assert.deepEqual(left(list, false), cached.length > 0 ? cached : names);
  }
  assert.match(
    picker,
    /const uncachedHiddenCount = useMemo\(\(\) => \{\s+if \(!result \|\| debrids\.length === 0\) return 0;/,
    "their own switch is not there without one",
  );
  assert.match(picker, /\{uncachedHiddenCount > 0 && \(\s*<CachedFilterPill/);
});

test("what has failed is taken back nowhere else, so the Stremio and Condensed looks show what they did", () => {
  assert.deepEqual(
    [...picker.matchAll(/^.*\bsetFailedStreams\b.*$/gm)].map(([line]) => line.trim()),
    [
      "const [failedStreams, setFailedStreams] = useState<Set<ScoredStream>>(new Set());",
      "if (modern) setFailedStreams(new Set());",
      "setFailedStreams,",
    ],
    "the page's own state, a refresh in the modern look, and the play handler that adds to it",
  );
  const part = (from: string) => {
    const at = picker.indexOf(from);
    assert.ok(at >= 0, from);
    return picker.slice(at, picker.indexOf("/>", at));
  };
  assert.match(part("<StremioLayout"), /\n\s*failedStreams=\{failedStreams\}\n/);
  for (const condensed of ["<PrimaryCard", "<TierStrip", "<SourceDrawer"]) {
    assert.doesNotMatch(part(condensed), /failed/i, condensed);
  }
  for (const own of ["<PickerScrollTop", "<SeasonPackEmptyState"]) {
    assert.match(part(own), /onRefresh=\{refresh\}/, `${own} is never drawn in the modern look`);
  }
});

test("that nothing is cached is told to the modern look alone", () => {
  const told = [...picker.matchAll(/^.*\bnoneCached\b.*$/gm)].map(([line]) => line.trim());
  assert.deepEqual(told, [
    "let noneCached = false;",
    "else noneCached = modern && all.length > 0;",
    "else fellBack = !noneCached;",
    "return { primary, byTier, all, allRaw, ranked, fellBack, noneCached };",
    "noneCached: filteredPicker?.noneCached ?? false,",
    "!filteredPicker?.noneCached && (",
    "noneCached={filteredPicker.noneCached}",
  ]);
});

test("the page itself keeps what was filtered, because a Play attempt takes the look off it", () => {
  const kept = picker.indexOf("const modernState = useModernPickerState();");
  assert.ok(kept >= 0 && kept < picker.indexOf("if (pendingPreselect) {"));
  assert.match(picker, /\? \{\s*state: modernState,/);
});

test("everything the page draws under Back and Refresh stands beside the left column", () => {
  const body = picker.indexOf("<PickerBody");
  const bodyEnd = picker.indexOf("</PickerBody>");
  assert.match(
    picker,
    /<PickerBody\s+nav=\{<PickerNav\b/,
    "Back and Refresh stay above both columns",
  );
  for (const part of [
    "<LocalStreamList",
    "<HostSourceBanner",
    "<CinematicLoader",
    "<PickerEmptyLadder",
    "<ActiveFilterHint",
    "{modeSwitch}</div>",
    "<ModernList",
    "<StremioLayout",
    "<SourceDrawer",
  ]) {
    const at = picker.indexOf(part);
    assert.ok(at > body && at < bodyEnd, part);
  }
});

test("the bar and the look ask one hook whether Harbor's own title bar is drawn", () => {
  const bar = read("src/chrome/hybrid-title-bar.tsx");
  assert.match(
    bar,
    /const shown = useHybridTitleBar\(\);\s*if \(suppressed \|\| !shown\) return null;/,
    "by the bar too",
  );
  for (const file of readdirSync(new URL("../src/views/play-picker/modern", import.meta.url))) {
    const source = read(`src/views/play-picker/modern/${file}`);
    assert.doesNotMatch(source, /__TAURI|hybridTitleBar|useNativeTitleBar/, file);
  }
});

const buttonRow = read("src/views/play-picker/modern/button-row.tsx");
const side = read("src/views/play-picker/modern/modern-side.tsx");

test("arrow keys in a row of buttons only move the focus", () => {
  const start = buttonRow.indexOf("const moveFocus = ");
  const end = buttonRow.indexOf("\n  };", start);
  assert.ok(start >= 0 && end > start, "the arrow handler is missing");
  const handler = buttonRow.slice(start, end);
  assert.match(handler, /"ArrowLeft"/);
  assert.match(handler, /"ArrowRight"/);
  assert.doesNotMatch(handler, /onChange/);
});

test("the left column shows the episode's own picture first", () => {
  assert.match(side, /episode\?\.still \|\| meta\.background/);
});

test("nothing in the look blurs what is behind it", () => {
  for (const file of [
    "button-row",
    "modern-side",
    "modern-filters",
    "modern-shell",
    "modern-list",
  ]) {
    const source = read(`src/views/play-picker/modern/${file}.tsx`);
    assert.doesNotMatch(source, /backdrop-blur|backdrop-filter|\bblur-/, file);
    assert.doesNotMatch(source, /<aside\b|role="grid"|content-visibility/, file);
  }
});

test("the page hands the list its one source-mode switch, and else gives it a line of its own", () => {
  assert.match(
    picker,
    /const modeSwitch = !isDownload && result && result\.picker\.all\.length > 0 && \(\s*<StreamModeToggle\s+mode=\{settings\.streamMode\}\s+onChange=\{\(mode\) => update\(\{ streamMode: mode \}\)\}\s+\/>\s*\);/,
    "when there is one has not changed",
  );
  assert.match(picker, /<ModernList\s+modeSwitch=\{modeSwitch\}/);
  assert.match(
    picker,
    /\{modeSwitch && !modernList && <div className="flex justify-end">\{modeSwitch\}<\/div>\}/,
    "in the other looks as before",
  );
  assert.equal((picker.match(/\{modeSwitch\}/g) ?? []).length, 2);
});

test("the condensed card and the modern pick share one main button", () => {
  const card = read("src/views/play-picker/primary-card.tsx");
  const pick = read("src/views/play-picker/modern/modern-pick.tsx");
  for (const source of [card, pick]) assert.match(source, /<PickActionButton\b/);
  assert.doesNotMatch(card, /Cache on \{provider\}/);
  assert.doesNotMatch(pick, /Cache on \{provider\}/);
});

const list = read("src/views/play-picker/modern/modern-list.tsx");
const row = read("src/views/play-picker/modern/modern-row.tsx");

test("the list is held, filtered, sorted and told apart by the rules", () => {
  for (const call of ["holdRows(", "applyModernFilters(", "sortModern(", "streamIdentity("]) {
    assert.ok(list.includes(call), call);
  }
});

test("a row is no control, keeps the arrow keys free and follows the setting for descriptions", () => {
  assert.doesNotMatch(row, /role="grid"/);
  const opening = /<li\b[^>]*>/.exec(row.replace(/=>/g, "=]"))?.[0] ?? "";
  assert.match(opening, /data-row/);
  assert.doesNotMatch(opening, /tabIndex|onClick|onKeyDown|role=/);
  assert.match(row, /settings\.fullStreamDescription/);
});

test("rows carry no blur and no shadow, and move by transform alone", () => {
  for (const source of [row, read("src/views/play-picker/modern/row-motion.ts")]) {
    assert.doesNotMatch(source, /backdrop-blur|backdrop-filter|shadow|\bblur\(/);
  }
  const motion = read("src/views/play-picker/modern/row-motion.ts");
  const frames = motion.slice(motion.indexOf(".animate"));
  assert.match(frames, /transform:/);
  assert.doesNotMatch(frames, /opacity|top:|left:|height:|margin/);
  assert.match(motion, /prefers-reduced-motion/);
});

test("the warm-up is wired as in the Stremio rows", () => {
  assert.match(list, /prewarmP2pStream\(/);
  assert.match(list, /INTENT_PREWARM_ABANDON_MS/);
  assert.match(list, /intent: true/);
  assert.match(list, /onIntentCancel=\{abandonPrewarmedStream\}/);
});
