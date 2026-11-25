import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Addon } from "@/lib/addons";
import { useT } from "@/lib/i18n";
import type { ScoredStream } from "@/lib/streams/types";
import { PendingChip, Spinner, usePendingAddon } from "../pending-addon";
import { handOnFocus } from "./hand-on-focus";
import { nextModernSort, type ModernSort, type ModernSortKey } from "./modern-rules";
import { AUDIO_CELL, FROM_CELL, ROW_GRID } from "./row-grid";
import { useTitleBarHeight } from "./use-title-bar-height";

export type ModernOrderName = "harbor" | "addon" | "together";

type Translate = ReturnType<typeof useT>;

function orderSentence(t: Translate, name: ModernOrderName, sort: ModernSort | null): string {
  if (!sort) {
    switch (name) {
      case "harbor":
        return t("In Harbor ranking order.");
      case "addon":
        return t("In addon order.");
      case "together":
        return t("In Watch Together order, the host's source first.");
    }
  }
  const up = sort.dir === "asc";
  switch (sort.key) {
    case "name":
      return up ? t("Sorted by release, A to Z.") : t("Sorted by release, Z to A.");
    case "resolution":
      return up
        ? t("Sorted by resolution, lowest first.")
        : t("Sorted by resolution, highest first.");
    case "seeders":
      return up ? t("Sorted by seeders, fewest first.") : t("Sorted by seeders, most first.");
    case "size":
      return up ? t("Sorted by size, smallest first.") : t("Sorted by size, largest first.");
  }
}

function wayBack(t: Translate, name: ModernOrderName): string {
  switch (name) {
    case "harbor":
      return t("Back to Harbor ranking");
    case "addon":
      return t("Back to addon order");
    case "together":
      return t("Back to Watch Together order");
  }
}

const LINK =
  "shrink-0 text-ink underline decoration-edge underline-offset-[3px] transition-colors hover:decoration-ink";

/** Its height is fixed, so that nothing it says can move the rows. */
export function ModernOrder({
  name,
  sort,
  pageOrder,
  onBack,
  changed,
  onUpdate,
  addons,
  streams,
  pipelineDone,
}: {
  name: ModernOrderName;
  sort: ModernSort | null;
  /** Where the way back leads by now, which `name` does not say yet while a held list waits. */
  pageOrder: ModernOrderName;
  onBack: () => void;
  changed: boolean;
  onUpdate: () => void;
  addons: Addon[] | null;
  streams: ScoredStream[];
  pipelineDone: boolean;
}) {
  const t = useT();
  return (
    <div className="flex h-8 items-center gap-x-5 whitespace-nowrap ps-3.5 text-[14px] text-ink-muted/85">
      <p data-order="" className="min-w-0 truncate">
        <bdi>
          <span aria-live="polite">{orderSentence(t, name, sort)}</span>
          {!sort && !changed && ` ${t("Click a heading to sort by it.")}`}
        </bdi>
      </p>
      {sort && (
        <button
          type="button"
          onClick={(event) => {
            handOnFocus(event, "[data-list]", '[data-headings] [aria-pressed="true"]');
            onBack();
          }}
          className={LINK}
        >
          {wayBack(t, pageOrder)}
        </button>
      )}
      {!pipelineDone && <Waiting addons={addons} streams={streams} />}
      <p data-changed="" aria-live="polite" className="ms-auto shrink-0">
        {changed && (
          <span className="pe-3.5">
            <bdi>{t("The list has changed.")}</bdi>{" "}
            <button
              type="button"
              onClick={(event) => {
                handOnFocus(event, "[data-list]", "[data-headings] button");
                onUpdate();
              }}
              className={LINK}
            >
              {t("Update")}
            </button>
          </span>
        )}
      </p>
    </div>
  );
}

function Waiting({ addons, streams }: { addons: Addon[] | null; streams: ScoredStream[] }) {
  const t = useT();
  const addon = usePendingAddon(addons, streams);
  return (
    <div
      data-waiting=""
      className="flex shrink-0 items-center gap-2 rounded-full border border-edge-soft bg-elevated/60 py-1 pe-3 ps-2.5"
    >
      <Spinner />
      {addon ? (
        <PendingChip addon={addon} />
      ) : (
        <span className="text-[12px] text-ink-muted">{t("Loading more sources")}</span>
      )}
    </div>
  );
}

function HeadingButton({
  sortKey,
  sort,
  onSort,
  label,
}: {
  sortKey: ModernSortKey;
  sort: ModernSort | null;
  onSort: (next: ModernSort | null) => void;
  label: string;
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : nextModernSort(null, sortKey)?.dir;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSort(nextModernSort(sort, sortKey))}
      className={`group/heading inline-flex min-w-0 items-center gap-1.5 justify-self-start transition-colors hover:text-ink ${
        active ? "font-semibold text-ink" : "font-medium"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <Arrow
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className={`shrink-0 transition-opacity ${
          active ? "text-accent" : "opacity-0 group-hover/heading:opacity-55"
        }`}
      />
    </button>
  );
}

function useScrolledPast(covered: number) {
  const edge = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = edge.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setPast(
          !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0),
        ),
      { root: element.closest("main"), rootMargin: `${-covered}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [covered]);
  return { edge, past };
}

/** Also over the coloured edge of a row, which stands outside of the list. */
const STUCK =
  "bg-canvas before:absolute before:top-0 before:-bottom-px before:-start-0.5 before:w-0.5 before:bg-canvas";

export function ModernHeadings({
  sort,
  onSort,
}: {
  sort: ModernSort | null;
  onSort: (next: ModernSort | null) => void;
}) {
  const t = useT();
  const { edge, past } = useScrolledPast(useTitleBarHeight());
  return (
    <>
      <div ref={edge} aria-hidden="true" className="-mb-px h-px" />
      <div
        data-headings=""
        className={`sticky top-(--modern-top) z-20 border-b border-edge px-3.5 py-3 text-[13px] font-medium text-ink-muted/85 ${ROW_GRID} ${
          past ? STUCK : ""
        }`}
      >
        <HeadingButton sortKey="name" sort={sort} onSort={onSort} label={t("Release")} />
        <HeadingButton sortKey="resolution" sort={sort} onSort={onSort} label={t("Resolution")} />
        <HeadingButton sortKey="seeders" sort={sort} onSort={onSort} label={t("Seeders")} />
        <HeadingButton sortKey="size" sort={sort} onSort={onSort} label={t("Size")} />
        <span className={`truncate ${AUDIO_CELL}`}>{t("Audio")}</span>
        <span className={`truncate ${FROM_CELL}`}>{t("From")}</span>
        <span />
      </div>
    </>
  );
}
