import type { PanelCorner } from "@/lib/player-chrome";

/** Mirrors the relay's limit (worker.js REACTION_BURST / REACTION_WINDOW_MS). */
export const REACTION_BURST = 5;
export const REACTION_WINDOW_MS = 2_000;

/**
 * Allows what the relay will pass on, so a fast tapper never sees reactions
 * on their own screen that nobody else received.
 */
export function createReactionLimiter(
  burst = REACTION_BURST,
  windowMs = REACTION_WINDOW_MS,
  now: () => number = () => Date.now(),
): () => boolean {
  let sentAt: number[] = [];
  return () => {
    const t = now();
    sentAt = sentAt.filter((at) => t - at < windowMs);
    if (sentAt.length >= burst) return false;
    sentAt.push(t);
    return true;
  };
}

/** Reactions rise on the side away from the chat, so they never cross its bubbles. */
export function reactionSide(chatCorner: PanelCorner): "left" | "right" {
  return chatCorner.endsWith("right") ? "left" : "right";
}
