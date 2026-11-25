import { useSettings } from "@/lib/settings";
import { useWindowFullscreen } from "@/lib/use-window-fullscreen";

export function useHybridTitleBar(): boolean {
  const { settings } = useSettings();
  const fullscreen = useWindowFullscreen();
  return (
    "__TAURI_INTERNALS__" in window &&
    settings.hybridTitleBar &&
    !settings.useNativeTitleBar &&
    !fullscreen
  );
}
