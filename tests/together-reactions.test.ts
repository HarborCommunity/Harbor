import assert from "node:assert/strict";
import test from "node:test";
import { createReactionLimiter, reactionSide } from "../src/lib/together/reactions.ts";

test("the sender is held to the relay's five per two seconds", () => {
  let now = 1000;
  const allow = createReactionLimiter(undefined, undefined, () => now);
  const sent = Array.from({ length: 8 }, () => allow()).filter(Boolean).length;
  assert.equal(sent, 5, "taps past the burst are not shown or sent");
  now += 1999;
  assert.equal(allow(), false);
  now += 1;
  assert.equal(allow(), true, "the window frees up after two seconds");
});

test("reactions rise on the side away from the chat", () => {
  assert.equal(reactionSide("bottom-left"), "right");
  assert.equal(reactionSide("top-left"), "right");
  assert.equal(reactionSide("bottom-right"), "left");
  assert.equal(reactionSide("top-right"), "left");
});
