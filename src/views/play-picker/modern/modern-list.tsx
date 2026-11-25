import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Addon } from "@/lib/addons";
import type { useDebridClients } from "@/lib/debrid/registry";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import {
  INTENT_PREWARM_ABANDON_MS,
  abandonPrewarmedStream,
  prewarmP2pStream,
} from "@/lib/streams/p2p-prewarm";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayEpisode } from "@/lib/view";
import { addonInstanceKey, streamIdentity } from "../picker-utils";
import { handOnFocus } from "./hand-on-focus";
import { useModernContext } from "./modern-context";
import { ModernHeadings, ModernOrder, type ModernOrderName } from "./modern-order";
import { ModernPick } from "./modern-pick";
import { ModernRow, useWholeNames } from "./modern-row";
import { ModernRows } from "./modern-rows";
import {
  applyModernFilters,
  holdRows,
  knownSeeders,
  pickModern,
  sortModern,
  type ModernSort,
} from "./modern-rules";
import { useModernState } from "./modern-state";

const FIRST_ROWS = 100;

export type ModernListProps = {
  modeSwitch?: ReactNode;
  episode?: PlayEpisode;
  absoluteEpisode?: number | null;
  streams: ScoredStream[];
  /** The same sources in the order the page ranks them, whatever order it shows them in. */
  ranked: ScoredStream[];
  noneCached: boolean;
  onCachedOnly: (v: boolean) => void;
  /** The page's own best source, which need not be in the list. */
  preferred: ScoredStream | null;
  previousMatch: ScoredStream | null;
  lastPlayedStream: ScoredStream | null;
  failedStreams: Set<ScoredStream>;
  debrids: ReturnType<typeof useDebridClients>;
  addons: Addon[] | null;
  getAddonLogo: (id: string) => string | null;
  pipelineDone: boolean;
  orderName: ModernOrderName;
  matchFor?: (s: ScoredStream) => "same" | "close" | null;
  isAnime: boolean;
  onPlay: (s: ScoredStream) => void;
  onCache: (s: ScoredStream) => void;
  resolvingStream: ScoredStream | null;
  queuedHash: string | null;
  inSession: boolean;
};

/** One add-on can be installed twice, and one torrent can be offered behind several links. */
function rowId(s: ScoredStream): string {
  const link = s.url ?? s.externalUrl ?? s.ytId ?? "";
  return `${addonInstanceKey(s)}|${streamIdentity(s)}|${link}`;
}

/** The page can hand a source over as a newer object, or with another file number. */
function rowOf(list: ScoredStream[], source: ScoredStream | null): ScoredStream | null {
  if (!source) return null;
  const id = rowId(source);
  return (
    list.find((s) => rowId(s) === id) ??
    list.find(
      (s) =>
        !!s.infoHash &&
        s.infoHash === source.infoHash &&
        s.url === source.url &&
        s.title === source.title &&
        addonInstanceKey(s) === addonInstanceKey(source),
    ) ??
    null
  );
}

function rowsOf(list: ScoredStream[], sources: ReadonlySet<ScoredStream>): Set<ScoredStream> {
  const ids = new Set([...sources].map(rowId));
  const rows = new Set(list.filter((s) => ids.has(rowId(s))));
  for (const source of sources) {
    const row = rowOf(list, source);
    if (row) rows.add(row);
  }
  return rows;
}

export function ModernList({
  modeSwitch,
  episode,
  absoluteEpisode,
  streams,
  ranked,
  noneCached,
  onCachedOnly,
  preferred,
  previousMatch,
  lastPlayedStream,
  failedStreams,
  debrids,
  addons,
  getAddonLogo,
  pipelineDone,
  orderName,
  matchFor,
  isAnime,
  onPlay,
  onCache,
  resolvingStream,
  queuedHash,
  inSession,
}: ModernListProps) {
  const t = useT();
  const { settings } = useSettings();
  const state = useModernState();
  const { filters, clearFilters, setSort } = state;
  const ctx = useModernContext(streams, !!episode, isAnime, noneCached);
  const sort = orderName === "together" && !state.sorted ? null : state.sort;

  // While the rows are held no row moves, comes in or goes away, not even when newer facts of a
  // source would sort or filter it elsewhere: what is held is the list as it is drawn. What the
  // user asks for applies at once and is held from there.
  const rowsHold = useHold();
  const pickHold = useHold();
  const asked = `${state.asked}|${settings.streamMode}`;
  const newest = useMemo(
    () => sortModern(applyModernFilters(streams, filters, ctx), sort),
    [streams, filters, ctx, sort],
  );
  const rows = useHeldRows(newest, rowsHold.on, asked, streams);
  const changed = rowsHold.on && holdRows(rows, newest, true, rowId).changed;
  const shown = useShownOrder(orderName, sort, changed);

  // The pick stands above the rows, so it is held with them.
  const candidates = useMemo(() => {
    const home = rowOf(newest, preferred);
    const list = home && preferred ? newest.map((s) => (s === home ? preferred : s)) : newest;
    const pick = pickModern({
      list,
      preferred: home ? preferred : null,
      ranked,
      failed: rowsOf(list, failedStreams),
    });
    return pick ? [pick, ...list] : [];
  }, [newest, preferred, ranked, failedStreams]);
  const [pick = null] = useHeldRows(candidates, pickHold.on || rowsHold.on, asked);

  const isPick = (source: ScoredStream | null) =>
    !!source && !!pick && rowId(source) === rowId(pick);

  const pickRow = useMemo(() => rowOf(rows, pick), [rows, pick]);
  const lastRow = useMemo(() => rowOf(rows, lastPlayedStream), [rows, lastPlayedStream]);
  const failedRows = useMemo(() => rowsOf(rows, failedStreams), [rows, failedStreams]);
  const mostSeeders = useMemo(
    () => rows.reduce((most, s) => Math.max(most, knownSeeders(s) ?? 0), 0),
    [rows],
  );

  const drawn = useMemo(() => {
    const seen = new Map<string, number>();
    return (state.allRows ? rows : rows.slice(0, FIRST_ROWS)).map((stream) => {
      const id = rowId(stream);
      const nth = seen.get(id) ?? 0;
      seen.set(id, nth + 1);
      return { stream, key: `${id}|${nth}` };
    });
  }, [rows, state.allRows]);
  const order = useMemo(() => drawn.map(({ key }) => key).join("\n"), [drawn]);

  const play = useStable(onPlay);
  const wholeNames = useWholeNames();

  return (
    <div className="flex flex-col gap-[30px]">
      {(pick || modeSwitch) && (
        <ModernPick
          stream={pick}
          modeSwitch={modeSwitch}
          list={pick && pickRow !== pick ? rows.map((s) => (s === pickRow ? pick : s)) : rows}
          filtered={Object.keys(filters).length > 0}
          episode={
            episode
              ? {
                  season: episode.season ?? null,
                  episode: episode.episode,
                  absolute: absoluteEpisode ?? null,
                  anySeason: isAnime,
                }
              : null
          }
          playedLast={pickRow !== null && pickRow === lastRow}
          failed={pickRow !== null && failedRows.has(pickRow)}
          isPreviouslyPlayed={isPick(previousMatch)}
          debrids={debrids}
          resolving={isPick(resolvingStream)}
          queued={pick?.infoHash != null && queuedHash === pick.infoHash}
          inSession={inSession}
          onPlay={onPlay}
          onCache={onCache}
          onHold={pickHold.set}
        />
      )}
      <div data-list="" className="@container/list flex min-w-0 flex-col">
        <ModernOrder
          name={shown.name}
          sort={shown.sort}
          pageOrder={orderName}
          onBack={() => setSort(null)}
          changed={changed}
          onUpdate={state.ask}
          addons={addons}
          streams={streams}
          pipelineDone={pipelineDone}
        />
        <ModernHeadings sort={shown.sort} onSort={setSort} />
        <ModernRows order={order} holding={rowsHold.on} onHold={rowsHold.set}>
          {drawn.map(({ stream, key }) => (
            <ModernRow
              key={key}
              stream={stream}
              wholeNames={wholeNames}
              addonName={ctx.addonOf(stream).name || t("Source")}
              addonLogo={getAddonLogo(stream.addonId)}
              debrids={debrids}
              dubSub={ctx.dubSub(stream)}
              isEpisode={!!episode}
              isPick={stream === pickRow}
              playedLast={stream === lastRow}
              match={matchFor?.(stream) ?? null}
              failed={failedRows.has(stream)}
              queued={stream.infoHash != null && queuedHash === stream.infoHash}
              mostSeeders={mostSeeders}
              onPlay={play}
              onIntent={warmUp}
              onIntentCancel={abandonPrewarmedStream}
            />
          ))}
        </ModernRows>
        {drawn.length < rows.length && (
          <button
            type="button"
            onClick={(event) => {
              handOnFocus(event, "[data-list]", "[data-rows] > :last-child [data-play]");
              state.showAllRows();
            }}
            className="mt-4 self-center rounded-full border border-edge px-5 py-2 text-[13.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
          >
            {t("Show all {n}", { n: rows.length })}
          </button>
        )}
        {rows.length === 0 && streams.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-14 text-ink-muted">
            <p>
              {streams.length === 1
                ? t("All {n} source is hidden by the active filter.", { n: streams.length })
                : t("All {n} sources are hidden by the active filter.", { n: streams.length })}
            </p>
            <button
              type="button"
              onClick={(event) => {
                handOnFocus(event, "[data-list]", "[data-headings] button");
                clearFilters();
                if (noneCached) onCachedOnly(false);
              }}
              className="text-ink underline decoration-edge underline-offset-[3px] transition-colors hover:decoration-ink"
            >
              {t("Clear filters")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function warmUp(stream: ScoredStream) {
  void prewarmP2pStream(stream, { abandonAfterMs: INTENT_PREWARM_ABANDON_MS, intent: true });
}

function useHold() {
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const set = useCallback((what: "pointer" | "focus", on: boolean) => {
    (what === "pointer" ? setPointer : setFocus)(on);
  }, []);
  return { on: pointer || focus, set };
}

/** Another `asked` is a change the user asked for, which applies at once. */
function useHeldRows(
  incoming: ScoredStream[],
  holding: boolean,
  asked: string,
  facts: ScoredStream[] = incoming,
): ScoredStream[] {
  const last = useRef({ rows: incoming, asked });
  const rows = useMemo(
    () =>
      holding && last.current.asked === asked
        ? holdRows(last.current.rows, facts, true, rowId).rows
        : incoming,
    [incoming, holding, asked, facts],
  );
  useLayoutEffect(() => {
    last.current = { rows, asked };
  });
  return rows;
}

/** The rows of a held list that waits still stand in the order before. */
function useShownOrder(name: ModernOrderName, sort: ModernSort | null, waiting: boolean) {
  const last = useRef({ name, sort });
  const shown = waiting ? last.current : { name, sort };
  useLayoutEffect(() => {
    last.current = shown;
  });
  return shown;
}

/** A handler that changed with the page would draw every row again. */
function useStable<A>(run: (value: A) => void): (value: A) => void {
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  return useCallback((value: A) => latest.current(value), []);
}
