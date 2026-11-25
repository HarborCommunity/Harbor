import {
  Component,
  createRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { tvFocus } from "@/lib/keyboard-navigation";
import { navOwnsFocus } from "@/lib/keyboard-navigation/geometry";
import { firstOf } from "./hand-on-focus";

type Props = ComponentPropsWithoutRef<"div"> & {
  area: string;
  waysFrom: (lost: HTMLElement) => string[];
};

/**
 * Keeps the focus of a key or a controller off the page when the control that has it goes away or
 * greys out, whether or not it was pressed. Only a draw shows that; what had the focus right before
 * it, React tells a class and no hook.
 */
export class KeptFocus extends Component<Props, object, HTMLElement | null> {
  private readonly box = createRef<HTMLDivElement>();
  /** What a key or a controller has used, though the page still counts as the mouse's. */
  private used: Element | null = null;

  getSnapshotBeforeUpdate(): HTMLElement | null {
    const control = document.activeElement;
    return control instanceof HTMLElement && this.box.current?.contains(control) ? control : null;
  }

  componentDidUpdate(_previous: Props, _state: object, control: HTMLElement | null) {
    if (!control || (control.isConnected && !control.matches(":disabled"))) return;
    // What greys out has the focus until the browser looks at it again.
    const lost = [document.body, control].some((el) => el === document.activeElement);
    const mouse =
      control !== this.used &&
      document.documentElement.getAttribute("data-input-modality") === "pointer";
    if (!lost || mouse) return;
    const area = this.box.current!.closest(this.props.area);
    const next = firstOf(area, this.props.waysFrom(control));
    if (!next) return;
    this.used = next;
    if (navOwnsFocus(control)) tvFocus(next);
    else next.focus({ preventScroll: true });
  }

  private readonly key = ({ altKey, ctrlKey, metaKey }: KeyboardEvent) => {
    if (!altKey && !ctrlKey && !metaKey) this.used = document.activeElement;
  };

  private readonly click = ({ detail }: MouseEvent) => {
    this.used = detail === 0 ? document.activeElement : null;
  };

  render() {
    const { area: _area, waysFrom: _waysFrom, ...box } = this.props;
    return <div {...box} ref={this.box} onKeyDown={this.key} onClick={this.click} />;
  }
}
