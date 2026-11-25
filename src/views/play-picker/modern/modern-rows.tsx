import { Component, createRef, type FocusEvent, type ReactNode } from "react";
import { watchPointer } from "./pointer-hold";
import { endGlides, glideFrom, rowPlaces, type RowPlaces } from "./row-motion";

type Props = {
  /** The keys of the rows that are drawn, as one text. */
  order: string;
  holding: boolean;
  onHold: (what: "pointer" | "focus", on: boolean) => void;
  children: ReactNode;
};

type Before = {
  top: number | null;
  places: RowPlaces | null;
};

/**
 * A row that is held keeps its place on the screen whatever changes above the list, and rows that
 * get another place glide there. Both need to know how the page looks right before it changes,
 * which React tells a class and no hook.
 */
export class ModernRows extends Component<Props, object, Before> {
  private readonly area = createRef<HTMLUListElement>();
  private pointedAt: Element | null = null;
  private stopWatching: (() => void) | undefined;

  componentDidMount() {
    const area = this.area.current;
    if (area) this.stopWatching = watchPointer(area, this.hold, { onPoint: this.point });
  }

  componentWillUnmount() {
    this.stopWatching?.();
  }

  getSnapshotBeforeUpdate(previous: Props): Before {
    const area = this.area.current;
    if (!area) return { top: null, places: null };
    if (previous.order !== this.props.order) return { top: null, places: rowPlaces(area) };
    return { top: this.props.holding ? this.heldTop(area) : null, places: null };
  }

  componentDidUpdate(previous: Props, _state: object, before: Before) {
    const area = this.area.current;
    if (!area) return;
    if (!this.props.holding && previous.holding) {
      area.style.marginTop = "";
      area.style.marginBottom = "";
    }
    if (before.places) glideFrom(before.places, area);
    else if (this.props.holding && !previous.holding) endGlides(area);
    if (before.top !== null) this.keepHeldAt(before.top, area);
  }

  private heldTop(area: Element): number {
    const row = this.pointedAt?.isConnected
      ? this.pointedAt
      : area.querySelector(":focus")?.closest("[data-row]");
    return (row ?? area).getBoundingClientRect().top;
  }

  /** The scroll takes a change up; what the page cannot scroll becomes room around the rows. */
  private keepHeldAt(top: number, area: HTMLElement) {
    let down = this.heldTop(area) - top;
    if (Math.abs(down) < 0.5) return;
    const room = Number.parseFloat(area.style.marginTop || "0");
    const given = Math.max(0, Math.min(room, down));
    down -= given;
    const page = area.closest("main");
    if (page && down !== 0) {
      const scroll = (by: number) => {
        const from = page.scrollTop;
        page.scrollTop = from + by;
        return page.scrollTop - from;
      };
      down -= scroll(down);
      if (down >= 0.5) {
        area.style.marginBottom = `${page.clientHeight}px`;
        down -= scroll(down);
      }
    }
    const left = room - given + Math.max(0, -down);
    area.style.marginTop = left > 0 ? `${left}px` : "";
  }

  private readonly point = (at: Element) => {
    this.pointedAt = at.closest("[data-row]");
  };

  private readonly hold = (on: boolean) => {
    if (!on) this.pointedAt = null;
    this.props.onHold("pointer", on);
  };

  private readonly focus = () => this.props.onHold("focus", true);

  private readonly blur = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget)) this.props.onHold("focus", false);
  };

  render() {
    return (
      <ul
        ref={this.area}
        data-rows=""
        onFocus={this.focus}
        onBlur={this.blur}
        className="flex flex-col"
      >
        {this.props.children}
      </ul>
    );
  }
}
