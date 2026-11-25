import type { RefObject } from "react";

/**
 * A pointer that nobody moved does not count: browsers report one whenever something else comes to
 * lie under it, and a list that opens under a resting mouse would be held from its first add-on on.
 * The way out is read from the moves too, since not every leave is reported: WebKitGTK drops some,
 * and what is taken away under the pointer has none.
 */
export function watchPointer(
  area: HTMLElement,
  onHold: (on: boolean) => void,
  {
    onPoint,
    except,
  }: {
    onPoint?: (at: Element) => void;
    except?: RefObject<Element | null>;
  } = {},
): () => void {
  let on = false;
  let last: { x: number; y: number } | null = null;

  const set = (next: boolean) => {
    if (next === on) return;
    on = next;
    onHold(next);
  };
  const moved = ({ clientX: x, clientY: y, movementX, movementY }: PointerEvent): boolean => {
    const changed = last !== null && (last.x !== x || last.y !== y);
    last = { x, y };
    return changed || !!movementX || !!movementY;
  };
  const at = ({ target }: Event) => {
    if (!(target instanceof Element) || !area.contains(target)) return set(false);
    if (except?.current?.contains(target)) return set(false);
    onPoint?.(target);
    set(true);
  };

  const move = (event: PointerEvent) => {
    if (moved(event)) at(event);
  };
  const leave = () => set(false);
  const leaveWindow = (event: MouseEvent) => {
    if (!event.relatedTarget) set(false);
  };

  window.addEventListener("pointermove", move, { capture: true, passive: true });
  window.addEventListener("pointerdown", at, { capture: true, passive: true });
  window.addEventListener("wheel", at, { capture: true, passive: true });
  window.addEventListener("mouseout", leaveWindow, { capture: true, passive: true });
  area.addEventListener("pointerleave", leave);
  return () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerdown", at, true);
    window.removeEventListener("wheel", at, true);
    window.removeEventListener("mouseout", leaveWindow, true);
    area.removeEventListener("pointerleave", leave);
  };
}
