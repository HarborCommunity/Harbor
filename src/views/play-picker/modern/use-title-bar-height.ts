import { useHybridTitleBar } from "@/chrome/use-hybrid-title-bar";

/** h-9 in hybrid-title-bar.tsx. */
export function useTitleBarHeight(): number {
  return useHybridTitleBar() ? 36 : 0;
}
