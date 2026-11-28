import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorChange,
  anchorFromState,
  decideCorrection,
  expectedPosition,
  isHostStalled,
  safeRate,
} from "../src/lib/together/timeline.ts";
import type { SyncState } from "../src/lib/together/protocol.ts";

const state = (patch: Partial<SyncState> = {}): SyncState => ({
  mediaId: "tt1",
  mediaTitle: "Fixture",
  episode: null,
  posterUrl: null,
  positionSeconds: 120,
  playing: true,
  speed: 1,
  updatedAt: 1_000_000,
  updatedBy: "host",
  hostClientId: "host",
  ...patch,
});

test("a playing anchor advances with time and rate, a paused one stays put", () => {
  const playing = anchorFromState(state({ speed: 1.5 }));
  assert.equal(expectedPosition(playing, 1_004_000), 126);
  const paused = anchorFromState(state({ playing: false }));
  assert.equal(expectedPosition(paused, 1_004_000), 120);
});

test("a buffering or stalled host stops the timeline", () => {
  assert.equal(anchorFromState(state({ buffering: true })).playing, false);
  assert.equal(anchorFromState(state(), true).playing, false);
});

test("sampledAt beats the relay receive time and playAt delays the start", () => {
  const sampled = anchorFromState(state({ sampledAt: 999_500 }));
  assert.equal(expectedPosition(sampled, 1_000_000), 120.5);
  const scheduled = anchorFromState(state({ playAt: 1_002_000 }));
  assert.equal(expectedPosition(scheduled, 1_001_000), 120);
  assert.equal(expectedPosition(scheduled, 1_003_000), 121);
});

test("projection is bounded by age and duration", () => {
  const anchor = anchorFromState(state());
  assert.equal(expectedPosition(anchor, 0), 120);
  assert.equal(expectedPosition(anchor, 1_000_000 + 600_000), 150);
  assert.equal(expectedPosition(anchor, 1_010_000, 125), 124.75);
});

test("small gaps are ignored, medium gaps nudge, large gaps seek", () => {
  assert.deepEqual(decideCorrection({ gapS: 0.1, nudging: false, canNudge: true }), {
    kind: "none",
  });
  const behind = decideCorrection({ gapS: 0.2, nudging: false, canNudge: true });
  assert.equal(behind.kind, "nudge");
  assert.ok(behind.kind === "nudge" && Math.abs(behind.factor - 1.05) < 1e-9);
  const ahead = decideCorrection({ gapS: -0.06, nudging: true, canNudge: true });
  assert.ok(ahead.kind === "nudge" && Math.abs(ahead.factor - 0.97) < 1e-9);
  assert.deepEqual(decideCorrection({ gapS: 3.2, nudging: false, canNudge: true }), {
    kind: "seek",
  });
});

test("nudging keeps going until the gap is well below the start threshold", () => {
  assert.equal(decideCorrection({ gapS: 0.1, nudging: false, canNudge: true }).kind, "none");
  assert.equal(decideCorrection({ gapS: 0.1, nudging: true, canNudge: true }).kind, "nudge");
  assert.equal(decideCorrection({ gapS: 0.03, nudging: true, canNudge: true }).kind, "none");
});

test("players without speed control seek only past half a second", () => {
  assert.equal(decideCorrection({ gapS: 0.4, nudging: false, canNudge: false }).kind, "none");
  assert.equal(decideCorrection({ gapS: -0.6, nudging: false, canNudge: false }).kind, "seek");
});

test("a host repeating the same playing position is stalled", () => {
  const first = { positionSeconds: 50, at: 0, playing: true };
  assert.equal(isHostStalled(first, { positionSeconds: 50.1, at: 500, playing: true }), false);
  assert.equal(isHostStalled(first, { positionSeconds: 50.1, at: 1000, playing: true }), true);
  assert.equal(isHostStalled(first, { positionSeconds: 52, at: 2000, playing: true }), false);
  assert.equal(isHostStalled(first, { positionSeconds: 50, at: 2000, playing: false }), false);
  assert.equal(isHostStalled(null, { positionSeconds: 50, at: 2000, playing: true }), false);
});

test("host anchor changes separate state changes from seeks", () => {
  const last = { positionSeconds: 10, startedAt: 0, rate: 1, playing: true, buffering: false };
  const at = (patch: object, pos: number) => ({ ...last, ...patch, positionSeconds: pos });
  assert.equal(anchorChange(null, last, 0), "state");
  assert.equal(anchorChange(last, at({}, 12.1), 2000), "none");
  assert.equal(anchorChange(last, at({ playing: false }, 12), 2000), "state");
  assert.equal(anchorChange(last, at({ buffering: true }, 12), 2000), "state");
  assert.equal(anchorChange(last, at({ rate: 1.5 }, 12), 2000), "state");
  assert.equal(anchorChange(last, at({}, 40), 2000), "position");
});

test("unusable rates fall back to normal speed", () => {
  for (const rate of [undefined, null, 0, -1, Infinity, NaN]) assert.equal(safeRate(rate), 1);
  assert.equal(safeRate(1.25), 1.25);
});
