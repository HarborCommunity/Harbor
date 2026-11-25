import type { MouseEvent } from "react";
import { advanceFocus } from "@/lib/keyboard-navigation";

export function firstOf(area: Element | null, ways: string[]): HTMLElement | null {
  for (const way of ways) {
    const there = area?.querySelector<HTMLElement>(way);
    if (there) return there;
  }
  return null;
}

/**
 * For a button that its own press takes away. A click of the mouse, which unlike one of a key or a
 * controller is counted, needs no new place for the focus.
 */
export function handOnFocus(event: MouseEvent, area: string, ...ways: string[]) {
  if (event.detail !== 0) return;
  const next = firstOf(event.currentTarget.closest(area), ways);
  if (next) advanceFocus(next);
}
