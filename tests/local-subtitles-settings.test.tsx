import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { LANGUAGES } from "../src/lib/i18n/languages";

test("the desktop subtitle folder can be chosen, kept on cancel or error, and cleared", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const root = createRoot(document.getElementById("root")!);
  let selection: string | null | Error = "/home/viewer/字幕";
  const options: Array<{ directory: boolean; recursive: boolean; defaultPath?: string }> = [];
  Object.defineProperties(dom.window, {
    __TAURI_OS_PLUGIN_INTERNALS__: { value: { platform: "linux" } },
    __TAURI_INTERNALS__: {
      value: {
        metadata: { currentWindow: { label: "main" } },
        invoke: async (name: string, args: { options: (typeof options)[number] }) => {
          assert.equal(name, "plugin:dialog|open");
          options.push(args.options);
          if (selection instanceof Error) throw selection;
          return selection;
        },
      },
    },
  });

  const section = () => document.getElementById("set-local-subtitles")!;
  const click = (label: string) =>
    act(async () => {
      const button = [...section().querySelectorAll("button")].find(
        (candidate) => candidate.textContent === label,
      );
      assert.ok(button, label);
      button.click();
    });

  try {
    const icons = new URL("../src/views/settings/set-icon.tsx", import.meta.url).href;
    const assets = registerHooks({
      load(url, context, next) {
        if (url !== icons) return next(url, context);
        return {
          format: "module",
          shortCircuit: true,
          source:
            "export const SetIcon = () => null; export const setIconComponent = () => SetIcon;",
        };
      },
    });
    const { LocalSubtitlesSection } =
      await import("../src/views/settings/language-panel/local-subtitles-section").finally(() =>
        assets.deregister(),
      );
    function Fixture() {
      const [folder, setFolder] = useState("");
      return <LocalSubtitlesSection folder={folder} onChange={setFolder} />;
    }
    await act(async () => root.render(<Fixture />));
    assert.match(section().textContent!, /No folder selected/);

    await click("Choose folder");
    assert.equal(section().querySelector("bdi")?.textContent, "/home/viewer/字幕");
    assert.equal(options[0].directory, true);
    assert.equal(options[0].recursive, true);
    assert.equal(options[0].defaultPath, undefined);

    selection = null;
    await click("Change folder");
    assert.equal(options[1].defaultPath, "/home/viewer/字幕");
    assert.equal(section().querySelector("bdi")?.textContent, "/home/viewer/字幕");
    assert.equal(section().querySelector('[role="alert"]'), null);

    selection = new Error("Picker unavailable");
    await click("Change folder");
    assert.equal(section().querySelector("bdi")?.textContent, "/home/viewer/字幕");
    assert.match(section().querySelector('[role="alert"]')!.textContent!, /Could not open/);

    await click("Clear");
    assert.match(section().textContent!, /No folder selected/);
    assert.equal(section().querySelector('[role="alert"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("subtitle folder strings are localized and kept in sync with Crowdin", async () => {
  const keys = [
    "Local subtitles",
    "Choose a folder to automatically load matching subtitles for movies and episodes.",
    "Subtitle folder",
    "No folder selected",
  ];
  for (const { code } of LANGUAGES) {
    const catalog = (await import(`../src/lib/i18n/locales/${code}.ts`)).default;
    const crowdin = JSON.parse(
      await readFile(new URL(`../i18n/${code}.json`, import.meta.url), "utf8"),
    );
    for (const key of keys) {
      assert.ok(catalog[key]?.trim(), `${code}: ${key}`);
      assert.equal(crowdin[key], catalog[key], `${code}: ${key}`);
      if (code !== "en") assert.notEqual(catalog[key], key, `${code}: ${key}`);
    }
  }
});
