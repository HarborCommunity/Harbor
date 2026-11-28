import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function controls(params: Record<string, unknown>) {
  const calls: string[] = [];
  const bridge = {
    play: async () => {
      calls.push("play");
    },
    pause: () => calls.push("pause"),
    seek: (sec: number) => calls.push(`seek ${sec}`),
  };
  const noop = () => {};
  const mocks: Record<string, any> = {
    react: {
      useCallback: (fn: any) => fn,
      useEffect: noop,
      useRef: (current: any) => ({ current }),
    },
    "@/lib/player/playback-clock": { getPlaybackPosition: () => 100 },
    "@/lib/player-prefs": { writePlayerPrefs: noop },
    "@/lib/subtitles/subtitle-memory": {},
    "@/lib/player/imported-subs": {},
    "@/lib/subtitles/selected-subtitle-cache": {},
    "@/lib/media-session": { notifyMediaSeeked: noop },
    "@/lib/playback-history": {},
  };
  const source = readFileSync("src/views/player/hooks/use-playback-controls.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", code)((name: string) => {
    assert.ok(name in mocks, name);
    return mocks[name];
  }, exports);
  const api = exports.usePlaybackControls({
    bridgeRef: { current: bridge },
    snapRef: { current: { status: "playing", durationSec: 5000, subtitleTracks: [] } },
    metaId: "tt1",
    mediaKey: "tt1||",
    inRoom: true,
    isHost: false,
    hasStarted: true,
    canControl: true,
    castDevice: null,
    startHost: noop,
    togglePlayCast: async () => {},
    seekCast: async () => {},
    sendCommand: (c: any) => calls.push(`cmd ${c.action}`),
    ...params,
  });
  return { api, calls };
}

test("a locked guest's play, pause and seek tell them why and do nothing", () => {
  let told = 0;
  const { api, calls } = controls({ controlLocked: true, onControlLocked: () => told++ });
  api.playPauseToggle();
  api.seekStep(10);
  api.seekTo(900);
  assert.deepEqual(calls, []);
  assert.equal(told, 3);
});

test("an unlocked guest still asks the host", () => {
  const { api, calls } = controls({ controlLocked: false });
  api.playPauseToggle();
  api.seekTo(900);
  assert.deepEqual(calls, ["cmd pause", "cmd seek"]);
});

test("the host's own actions are reported to the room and the lock does not apply", () => {
  const actions: string[] = [];
  const { api, calls } = controls({
    isHost: true,
    controlLocked: true,
    onRoomAction: (a: string) => actions.push(a),
  });
  api.playPauseToggle();
  api.seekTo(900);
  assert.deepEqual(actions, ["pause", "seek"]);
  assert.deepEqual(calls, ["pause", "seek 900"]);
});
