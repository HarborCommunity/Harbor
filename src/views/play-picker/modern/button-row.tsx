import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { isRtl } from "@/lib/keyboard-navigation/geometry";

export type ButtonRowOption = {
  /** An empty value is the choice of everything. */
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
};

type Box = { key: string; x: number; y: number; width: number; height: number };

const at = (x: number, y: number, scaleX = 1, scaleY = 1) =>
  `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;

/** As the thumbs in Settings move: on one line stretched over both choices on the way. */
function glide(thumb: HTMLElement, from: Box, to: Box) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const start = { transform: at(from.x, from.y, from.width / to.width, from.height / to.height) };
  const end = { transform: at(to.x, to.y) };
  if (from.y !== to.y) {
    thumb.animate?.([start, end], { duration: 320, easing: "ease-in-out" });
    return;
  }
  const edge = Math.min(from.x, to.x);
  const far = Math.max(from.x + from.width, to.x + to.width);
  const both = { transform: at(edge, to.y, (far - edge) / to.width), offset: 0.5 };
  thumb.animate?.([start, both, end], { duration: 420, easing: "ease-in-out" });
}

export function ButtonRow({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name?: string;
  label: string;
  value: string | null;
  options: ButtonRowOption[];
  onChange: (v: string | null) => void;
}) {
  const labelId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef<Box | null>(null);
  const chosen = value ?? "";

  const placeThumb = () => {
    const thumb = thumbRef.current;
    const button = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!thumb || !button) return;
    const to: Box = {
      key: chosen,
      x: button.offsetLeft,
      y: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight,
    };
    const from = placedRef.current;
    placedRef.current = to;
    thumb.style.width = `${to.width}px`;
    thumb.style.height = `${to.height}px`;
    thumb.style.transform = at(to.x, to.y);
    thumb.style.opacity = "1";
    if (from && from.key !== to.key && to.width > 0) glide(thumb, from, to);
  };

  // Every draw can change the widths, because the counts stand inside the buttons.
  useLayoutEffect(placeThumb);

  const placeRef = useRef(placeThumb);
  placeRef.current = placeThumb;
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => placeRef.current());
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // Moving and choosing are two actions: a controller moves the focus without sending a key.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    const forward = (event.key === "ArrowRight") !== isRtl(event.currentTarget);
    const next = buttons[from + (forward ? 1 : -1)];
    if (from < 0 || !next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div data-group={name} className="min-w-0">
      <h2
        id={labelId}
        className="mb-[5px] text-[13px] font-semibold leading-[18px] text-ink-muted/85"
      >
        {label}
      </h2>
      <div
        ref={rowRef}
        role="group"
        aria-labelledby={labelId}
        onKeyDown={moveFocus}
        className="relative flex w-fit max-w-full flex-wrap gap-0.5 rounded-md bg-ink/5 p-[3px]"
      >
        <span
          ref={thumbRef}
          aria-hidden="true"
          data-thumb=""
          className={`pointer-events-none absolute left-0 top-0 origin-top-left rounded-sm opacity-0 transition-colors duration-200 ${
            value === null ? "bg-raised" : "bg-ink"
          }`}
        />
        {options.map((option) => {
          const pressed = option.value === chosen;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              disabled={option.disabled}
              onClick={() => onChange(option.value || null)}
              className={`relative z-10 flex h-8 max-w-full items-baseline gap-[5px] rounded-sm px-[9px] text-[13.5px] font-semibold leading-8 [@media(max-height:940px)]:h-[30px] [@media(max-height:940px)]:leading-[30px] tracking-[0.01em] transition-colors duration-200 disabled:opacity-35 ${
                pressed
                  ? value === null
                    ? "text-ink"
                    : "text-canvas"
                  : "text-ink-muted/85 enabled:hover:text-ink"
              }`}
            >
              <bdi className="min-w-0 truncate">{option.label}</bdi>
              {option.count !== undefined && (
                <span className="text-[12px] font-medium tabular-nums opacity-70">
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
