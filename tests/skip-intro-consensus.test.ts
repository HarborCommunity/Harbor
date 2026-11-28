// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { dropSelfContradicting } from "../src/lib/skip-intro/consensus";
import type { SkipKind, SkipSegment, SkipSource } from "../src/lib/skip-intro/types";

const seg = (source: SkipSource, startSec: number, endSec: number, kind: SkipKind = "intro") =>
  ({ kind, startSec, endSec, source }) satisfies SkipSegment;

test("an intro inside the same source's recap drops both", () => {
  // Family Guy S9E2: TheIntroDB has intro 0-30 inside recap 0-52; the real intro is 0:25-0:55.
  const list = [
    seg("introdb", 0, 52, "recap"),
    seg("introdb", 0, 30),
    seg("introdb", 1200, 1260, "outro"),
  ];
  assert.deepEqual(
    dropSelfContradicting(list).map((s) => s.kind),
    ["outro"],
  );
});

test("a recap that ends where the intro starts is not a contradiction", () => {
  const recap = seg("skipdb", 0, 52.2, "recap");
  assert.equal(dropSelfContradicting([recap, seg("skipdb", 52.3, 82.3)]).length, 2);
  assert.equal(
    dropSelfContradicting([recap, seg("skipdb", 51, 82)]).length,
    2,
    "1.2s of overlap is tolerated",
  );
});
