import { useCallback, useEffect, useRef, useState } from "react";
import type { IncomingReaction } from "@/lib/together/provider";

/** How long one reaction stays on screen; matches the CSS animation. */
export const REACTION_LIFETIME_MS = 2800;
/** Beyond this many at once, the oldest make room, so a burst never covers the picture. */
export const MAX_FLOATING_REACTIONS = 12;

export type FloatingReaction = { id: number; emoji: string; name: string; lane: number };

/** Reactions from the room (and this viewer's own) floating up the edge of the player. */
export function useFloatingReactions(params: {
  enabled: boolean;
  onReaction: (cb: (e: IncomingReaction) => void) => () => void;
}): { reactions: FloatingReaction[]; add: (emoji: string, name: string) => void } {
  const { enabled, onReaction } = params;
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Set<number>());

  const add = useCallback((emoji: string, name: string) => {
    const id = ++nextIdRef.current;
    setReactions((cur) =>
      [...cur, { id, emoji, name, lane: id % 4 }].slice(-MAX_FLOATING_REACTIONS),
    );
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      setReactions((cur) => cur.filter((r) => r.id !== id));
    }, REACTION_LIFETIME_MS);
    timersRef.current.add(timer);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    return onReaction((e) => add(e.emoji, e.name));
  }, [enabled, onReaction, add]);

  useEffect(() => {
    if (enabled) return;
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
    setReactions([]);
  }, [enabled]);
  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  return { reactions, add };
}
