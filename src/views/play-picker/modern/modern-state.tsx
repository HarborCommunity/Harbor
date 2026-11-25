import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import {
  readModernSort,
  type ModernDimKey,
  type ModernFilters,
  type ModernSort,
} from "./modern-rules";

/** None of it is saved. */
type Visit = {
  filters: ModernFilters;
  moreOpen: boolean;
  allRows: boolean;
  /** In a room the host's order comes first until a heading is used. */
  sorted: boolean;
  /** Goes up with everything the user asks of the list, which then applies at once. */
  asked: number;
};

export type ModernState = Visit & {
  setFilter: (key: ModernDimKey, value: string | null) => void;
  clearFilters: () => void;
  openMore: (open: boolean) => void;
  showAllRows: () => void;
  ask: () => void;
  /** Null is the page's own order. */
  sort: ModernSort | null;
  setSort: (next: ModernSort | null) => void;
};

const NEW_VISIT: Visit = {
  filters: {},
  moreOpen: false,
  allRows: false,
  sorted: false,
  asked: 0,
};

/** Kept by the page, which draws other things than the look while it connects to a source. */
export function useModernPickerState(): ModernState {
  const { settings, update } = useSettings();
  const [visit, setVisit] = useState(NEW_VISIT);
  const sort = useMemo(
    () => readModernSort(settings.pickerModernSort),
    [settings.pickerModernSort],
  );
  const actions = useMemo(() => {
    const set = (part: Partial<Visit>) => setVisit((now) => ({ ...now, ...part }));
    const ask = (part: (now: Visit) => Partial<Visit>) =>
      setVisit((now) => ({ ...now, ...part(now), asked: now.asked + 1 }));
    return {
      setFilter: (key: ModernDimKey, value: string | null) =>
        ask(({ filters }) => {
          const next = { ...filters };
          if (value === null) delete next[key];
          else next[key] = value;
          return { filters: next };
        }),
      clearFilters: () => ask(() => ({ filters: {} })),
      openMore: (moreOpen: boolean) => set({ moreOpen }),
      showAllRows: () => set({ allRows: true }),
      ask: () => ask(() => ({})),
      setSort: (next: ModernSort | null) => {
        ask(() => ({ sorted: true }));
        update({ pickerModernSort: next });
      },
    };
  }, [update]);
  return useMemo(() => ({ ...visit, sort, ...actions }), [visit, sort, actions]);
}

const ModernStateContext = createContext<ModernState | null>(null);

export function ModernStateProvider({
  state,
  children,
}: {
  state: ModernState;
  children: ReactNode;
}) {
  return <ModernStateContext.Provider value={state}>{children}</ModernStateContext.Provider>;
}

export function useModernState(): ModernState {
  const state = useContext(ModernStateContext);
  if (!state) throw new Error("useModernState outside ModernStateProvider");
  return state;
}
