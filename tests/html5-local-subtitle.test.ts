import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { JSDOM } from "jsdom";
import { groupByLang } from "../src/components/player/subtitle-menu/utils";
import type { TrackInfo } from "../src/lib/player/bridge";

test("HTML5 reads a Windows subtitle path through the file API and selects its cues", async (t) => {
  const dom = new JSDOM("<div id='player'></div>", { pretendToBeVisual: true });
  t.mock.method(dom.window.HTMLMediaElement.prototype, "pause", () => {});
  t.mock.method(dom.window.HTMLMediaElement.prototype, "load", () => {});
  const globals = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    HTMLMediaElement: dom.window.HTMLMediaElement,
  };
  const previous = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => {
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  const path = "C:\\Media\\字幕\\Movie.ara.srt";
  const text = "مرحبًا";
  const bytes = new TextEncoder().encode(`1\r\n00:00:01,250 --> 00:00:03,000\r\n${text}\r\n`);
  const commands: Array<[string, string]> = [];
  mockIPC((command, args) => {
    const { path: requestedPath } = args as { path: string };
    commands.push([command, requestedPath]);
    if (command === "plugin:fs|stat") return { isFile: true, size: bytes.length };
    assert.equal(command, "plugin:fs|read_file");
    return bytes;
  });
  mockConvertFileSrc("windows");
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Local subtitle loading used network fetch");
  });

  const css = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "@/harbor-cursor.css?inline") {
        return { url: "data:text/javascript,export%20default%20%27%27", shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  const { createHtml5Bridge } = await import("../src/lib/player/html5/bridge").finally(() =>
    css.deregister(),
  );
  const bridge = createHtml5Bridge();
  bridge.attach(dom.window.document.getElementById("player")!);
  let tracks: TrackInfo[] = [];
  const unsubscribe = bridge.subscribe((snap) => {
    tracks = snap.subtitleTracks;
  });
  try {
    assert.equal(await bridge.addSubtitle(path, "ar", "Arabic", true, { imported: true }), true);
    const [track] = tracks;
    assert.equal(track.imported, true);
    assert.equal(track.lang, "ar");
    assert.equal(groupByLang([track])[0]?.langDisplay, "Unknown");
    assert.deepEqual(bridge.getSelectedTrackCues?.(), [{ start: 1.25, end: 3, text }]);
    assert.equal(bridge.getSelectedTrackUrl?.(), path);
    assert.deepEqual(commands, [
      ["plugin:fs|stat", path],
      ["plugin:fs|read_file", path],
    ]);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    unsubscribe();
    bridge.destroy();
  }
});
