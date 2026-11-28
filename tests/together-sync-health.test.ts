import assert from "node:assert/strict";
import test from "node:test";
import { needsAttention, reportedOffset, syncHealth } from "../src/lib/together/sync-health.ts";

test("small gaps report as in sync, larger ones in half seconds", () => {
  assert.equal(reportedOffset(0.2), 0);
  assert.equal(reportedOffset(-0.99), 0);
  assert.equal(reportedOffset(-1.2), -1);
  assert.equal(reportedOffset(4.8), 5);
  assert.equal(reportedOffset(-2.3), -2.5);
  assert.equal(reportedOffset(Number.NaN), 0);
});

test("health is worded for people and only big gaps ask for attention", () => {
  assert.deepEqual(syncHealth(undefined, undefined), { kind: "in-sync" });
  assert.deepEqual(syncHealth("ready", 0.5), { kind: "in-sync" });
  assert.deepEqual(syncHealth("buffering", -10), { kind: "loading" });
  assert.deepEqual(syncHealth("ready", -2.5), { kind: "behind", seconds: 3 });
  assert.deepEqual(syncHealth("ready", 1.5), { kind: "ahead", seconds: 2 });
  assert.equal(needsAttention(syncHealth("ready", -1.5)), false);
  assert.equal(needsAttention(syncHealth("ready", -3)), true);
  assert.equal(needsAttention(syncHealth("buffering", undefined)), true);
});
