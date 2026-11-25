import { useEffect, useMemo, useRef } from "react";
import { useT } from "@/lib/i18n";
import type { ScoredStream } from "@/lib/streams/types";
import { ButtonRow } from "./button-row";
import { KeptFocus } from "./kept-focus";
import { useModernContext } from "./modern-context";
import { modernGroups, startsAtOnce, type ModernDimKey, type ModernGroup } from "./modern-rules";
import { useModernState } from "./modern-state";

type Translate = ReturnType<typeof useT>;

function groupLabel(t: Translate, key: ModernDimKey): string {
  switch (key) {
    case "release":
      return t("Release");
    case "dub":
      return t("Audio");
    case "resolution":
      return t("Resolution");
    case "hdr":
      return t("HDR");
    case "source":
      return t("Source");
    case "addon":
      return t("Addon");
    case "codec":
      return t("Video codec");
    case "audio":
      return t("Audio codec");
    case "availability":
      return t("Availability");
  }
}

/** Names of formats stay as they are in every language. */
function choiceLabel(t: Translate, value: string): string {
  switch (value) {
    case "single":
      return t("Single episode");
    case "batch":
      return t("Batch");
    case "sub":
      return t("Subbed");
    case "dub":
      return t("Dubbed");
    case "dual":
      return t("Dual");
    case "Remux":
      return t("Remux");
    case "BluRay":
      return "Blu-ray";
    case "Cached":
      return t("Cached");
    case "Debrid":
      return t("Debrid");
    default:
      return value;
  }
}

const CACHED_ONLY = '[data-filters] [role="switch"]:enabled';
const MORE_FILTERS = "[data-filters] [aria-expanded]:enabled";
const FIRST_HEADING = "[data-headings] button";

const QUIET_BUTTON =
  "text-[14px] text-ink-muted underline decoration-edge underline-offset-[3px] transition-colors enabled:hover:text-ink";

export function ModernFilters({
  streams,
  isEpisode,
  isAnime,
  cachedOnly,
  noneCached,
  onCachedOnly,
}: {
  streams: ScoredStream[];
  isEpisode: boolean;
  isAnime: boolean;
  cachedOnly: boolean;
  noneCached: boolean;
  onCachedOnly: (v: boolean) => void;
}) {
  const t = useT();
  const { filters, setFilter, clearFilters, ask, moreOpen: opened, openMore } = useModernState();
  const ctx = useModernContext(streams, isEpisode, isAnime, noneCached);
  const groups = useMemo(() => modernGroups(streams, filters, ctx), [streams, filters, ctx]);
  // An add-on's id is its address, private keys and all, so it never stands in for the name.
  const seen = useRef(new Map<string, string>());
  const addonName = useMemo(() => {
    for (const s of streams) {
      const { id, name } = ctx.addonOf(s);
      seen.current.set(id, name);
    }
    return (id: string) => seen.current.get(id) || t("Source");
  }, [streams, ctx, t]);
  const moreInUse = groups.more.some((group) => filters[group.key] !== undefined);
  const moreOpen = opened || moreInUse;
  // A filter in use behind it opens it, and letting that filter go does not close it again.
  useEffect(() => {
    if (moreInUse && !opened) openMore(true);
  }, [moreInUse, opened, openMore]);
  const waysFrom = (lost: HTMLElement) => {
    const ways = [CACHED_ONLY, MORE_FILTERS, FIRST_HEADING];
    const group = lost.closest("[data-group]")?.getAttribute("data-group");
    const behindMore = !moreOpen && groups.more.some(({ key }) => key === group);
    return behindMore ? [MORE_FILTERS, ...ways] : ways;
  };
  const narrowed = Object.keys(filters).length > 0 || cachedOnly;
  // No debrid's key is needed in Harbor: an add-on that gathers others can hold it.
  const cachedUseful = streams.some(startsAtOnce);

  const showCachedOnly = (on: boolean) => {
    ask();
    onCachedOnly(on);
  };

  const row = (group: ModernGroup) => (
    <ButtonRow
      key={group.key}
      name={group.key}
      label={groupLabel(t, group.key)}
      value={filters[group.key] ?? null}
      onChange={(value) => setFilter(group.key, value)}
      options={[
        {
          value: "",
          label: group.key === "release" || group.key === "addon" ? t("All") : t("Any"),
        },
        ...group.options.map((option) => ({
          value: option.value,
          label: group.key === "addon" ? addonName(option.value) : choiceLabel(t, option.value),
          count: option.count,
          disabled: option.count === 0 && filters[group.key] !== option.value,
        })),
      ]}
    />
  );

  return (
    <KeptFocus
      data-filters=""
      area="[data-look]"
      waysFrom={waysFrom}
      className="col-span-full flex min-w-0 flex-wrap items-end gap-x-[30px] gap-y-[14px] border-t border-edge-soft pt-[18px] @max-[1084px]/modern:[@media(max-height:760px)]:gap-y-2 @max-[1084px]/modern:[@media(max-height:760px)]:pt-3 @min-[1084px]/modern:flex-col @min-[1084px]/modern:flex-nowrap @min-[1084px]/modern:items-stretch @min-[1084px]/modern:gap-y-[13px] @min-[1084px]/modern:[@media(max-height:940px)]:gap-y-[9px] @min-[1084px]/modern:[@media(max-height:940px)]:pt-[14px]"
    >
      {/* One list, so that a group that changes sides keeps its buttons and the focus. */}
      {[...groups.main, ...(moreOpen ? groups.more : [])].map(row)}
      <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1.5 pt-[3px]">
        <button
          type="button"
          role="switch"
          aria-checked={cachedOnly}
          disabled={!cachedUseful && !cachedOnly}
          onClick={() => showCachedOnly(!cachedOnly)}
          className="me-auto flex items-center gap-3 text-[15px] font-medium text-ink-muted transition-colors enabled:hover:text-ink disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className={`relative block h-8 w-[52px] shrink-0 rounded-full transition-colors duration-150 ${
              cachedOnly ? "bg-ink" : "bg-edge"
            }`}
          >
            <span
              className={`absolute start-[3px] top-[3px] h-[26px] w-[26px] rounded-full bg-canvas transition-transform duration-200 motion-reduce:transition-none ${
                cachedOnly ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
          {t("Cached only")}
        </button>
        {narrowed && (
          <button
            type="button"
            onClick={() => {
              clearFilters();
              if (cachedOnly) showCachedOnly(false);
            }}
            className={QUIET_BUTTON}
          >
            {t("Clear")}
          </button>
        )}
        {groups.more.length > 0 && (
          <button
            type="button"
            aria-expanded={moreOpen}
            disabled={moreInUse}
            onClick={() => openMore(!moreOpen)}
            className={`${QUIET_BUTTON} disabled:opacity-40`}
          >
            {moreOpen ? t("Fewer filters") : t("More filters")}
          </button>
        )}
      </div>
    </KeptFocus>
  );
}
