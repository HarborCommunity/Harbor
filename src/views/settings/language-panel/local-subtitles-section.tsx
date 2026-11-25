import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useT } from "@/lib/i18n";
import { osClass } from "@/lib/platform";
import { TOAST_POSITIONS, type ToastPosition } from "@/lib/toast-position";
import { SettingRow } from "../kit";
import { Section, Segmented, settingsAnchor } from "../shared";
import { SButton } from "../ui";

const POSITION_LABELS = {
  center: "Center",
  top: "Top",
  "top-left": "Top left",
  "top-right": "Top right",
} as const;

export function LocalSubtitlesSection({
  folder,
  onChange,
  toastPosition,
  onToastPositionChange,
}: {
  folder: string;
  onChange: (folder: string) => void;
  toastPosition: ToastPosition;
  onToastPositionChange: (position: ToastPosition) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [pickerFailed, setPickerFailed] = useState(false);
  const platform = osClass();
  const available = platform !== "web" && platform !== "android";

  const pickFolder = async () => {
    setPicking(true);
    setPickerFailed(false);
    try {
      const picked = await open({
        directory: true,
        recursive: true,
        defaultPath: folder || undefined,
        title: t("Subtitle folder"),
      });
      if (typeof picked === "string") onChange(picked);
    } catch {
      setPickerFailed(true);
    } finally {
      setPicking(false);
    }
  };

  return (
    <Section
      title={t("Local subtitles")}
      id={settingsAnchor("Local subtitles")}
      subtitle={
        available
          ? t("Choose a folder to automatically load matching subtitles for movies and episodes.")
          : t("Folder picker is only available in the desktop app")
      }
    >
      {available && (
        <SettingRow
          label={t("Subtitle folder")}
          desc={
            folder ? <bdi className="break-all font-mono">{folder}</bdi> : t("No folder selected")
          }
        >
          <SButton disabled={picking} onClick={() => void pickFolder()}>
            {folder ? t("Change folder") : t("Choose folder")}
          </SButton>
          {folder && (
            <SButton
              disabled={picking}
              onClick={() => {
                setPickerFailed(false);
                onChange("");
              }}
            >
              {t("Clear")}
            </SButton>
          )}
        </SettingRow>
      )}
      {pickerFailed && (
        <p role="alert" className="px-4 pb-3 text-[15px] text-danger">
          {t("Could not open the folder picker. Try again.")}
        </p>
      )}
      {available && (
        <SettingRow wide label={t("Pop-up position")}>
          <Segmented
            value={toastPosition}
            options={TOAST_POSITIONS.map((value) => ({ value, label: t(POSITION_LABELS[value]) }))}
            onChange={onToastPositionChange}
          />
        </SettingRow>
      )}
    </Section>
  );
}
