import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { DirEntry } from "@tauri-apps/plugin-fs";
import { scanLocalSubtitles } from "../src/lib/subtitles/local-subtitle-scanner";

function mockDirectories(t: TestContext, separator: string, read: (path: string) => DirEntry[]) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { plugins: { path: { sep: separator } } } },
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const paths: string[] = [];
  mockIPC((command, args) => {
    assert.equal(command, "plugin:fs|read_dir");
    const path = (args as { path: string }).path;
    paths.push(path);
    return read(path);
  });
  return paths;
}

function directory(name: string, isSymlink = false): DirEntry {
  return { name, isDirectory: true, isFile: false, isSymlink };
}

function file(name: string, isSymlink = false): DirEntry {
  return { name, isDirectory: false, isFile: true, isSymlink };
}

test("folder scans skip unreadable children, symlinks, and non-subtitle files", async (t) => {
  const denied = new Error("Permission denied");
  const warnings = t.mock.method(console, "warn", () => {});
  const paths = mockDirectories(t, "/", (path) => {
    if (path === "/subs/") {
      return [
        directory("海辺"),
        file("video.mkv"),
        file("A.SRT"),
        file("linked.ass", true),
        directory("denied"),
        directory("loop", true),
      ];
    }
    if (path === "/subs/denied") throw denied;
    assert.equal(path, "/subs/海辺");
    return [file("02.vtt"), file("01.ass")];
  });

  assert.deepEqual(await scanLocalSubtitles("/subs/"), [
    "/subs/A.SRT",
    "/subs/海辺/01.ass",
    "/subs/海辺/02.vtt",
  ]);
  assert.deepEqual(paths, ["/subs/", "/subs/denied", "/subs/海辺"]);
  assert.equal(warnings.mock.callCount(), 1);
});

test("blank folders do no work and a failed root read propagates its cause", async (t) => {
  const denied = new Error("Permission denied");
  const paths = mockDirectories(t, "/", () => {
    throw denied;
  });

  assert.deepEqual(await scanLocalSubtitles("  "), []);
  await assert.rejects(scanLocalSubtitles("/missing"), {
    message: "Unable to read the local subtitle folder.",
    cause: denied,
  });
  assert.deepEqual(paths, ["/missing"]);
});

test("folder scans preserve native Windows paths, including a share root", async (t) => {
  const root = "\\\\server\\share\\";
  const paths = mockDirectories(t, "\\", (path) =>
    path === root ? [directory("字幕")] : [file("Film.ara.srt")],
  );

  assert.deepEqual(await scanLocalSubtitles(root), [`${root}字幕\\Film.ara.srt`]);
  assert.deepEqual(paths, [root, `${root}字幕`]);
});

test("folder scans respect the recursion limit", async (t) => {
  const paths = mockDirectories(t, "/", () => [directory("deeper"), file("film.srt")]);

  const subtitles = await scanLocalSubtitles("/subs");
  assert.equal(paths.length, 9);
  assert.equal(subtitles.length, 9);
  assert.equal(paths.at(-1), `/subs${"/deeper".repeat(8)}`);
});

test("large folder scans stop at the directory budget and warn once", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const paths = mockDirectories(t, "/", (path) => {
    if (path !== "/subs") return [];
    return Array.from({ length: 2_048 }, (_, index) =>
      directory(`folder-${String(2_048 - index).padStart(4, "0")}`),
    );
  });

  assert.deepEqual(await scanLocalSubtitles("/subs"), []);
  assert.equal(paths.length, 2_048);
  assert.equal(paths.at(-1), "/subs/folder-2047");
  assert.equal(warnings.mock.callCount(), 1);
});

test("cancelled folder scans stop before scheduling more directory reads", async (t) => {
  const cancelled = new AbortController();
  const paths = mockDirectories(t, "/", () => {
    cancelled.abort();
    return [directory("child")];
  });

  await assert.rejects(scanLocalSubtitles("/subs", cancelled.signal), { name: "AbortError" });
  await assert.rejects(scanLocalSubtitles("/subs", cancelled.signal), { name: "AbortError" });
  assert.deepEqual(paths, ["/subs"]);
});
