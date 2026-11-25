import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useT } from "@/lib/i18n";
import { osClass } from "@/lib/platform";
import { SettingRow } from "../kit";
import { Section, settingsAnchor } from "../shared";
import { SButton } from "../ui";

export function LocalSubtitlesSection({
  folder,
  onChange,
}: {
  folder: string;
  onChange: (folder: string) => void;
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
    </Section>
  );
}
