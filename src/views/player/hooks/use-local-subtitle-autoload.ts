import { useEffect, useRef, type RefObject } from "react";
import { capturePlaybackActor, isPlaybackActorCurrent } from "@/lib/playback-history";
import { osClass } from "@/lib/platform";
import { readPlayerPrefs } from "@/lib/player-prefs";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import {
  pickAutomaticSubtitle,
  subsOffFor,
  trackPreferences,
} from "@/lib/player/track-preferences";
import type { Settings } from "@/lib/settings";
import { langScore } from "@/lib/subtitles/language";
import {
  localSubtitleMedia,
  localSubtitleTakesPrecedence,
  matchesLocalPath,
} from "@/lib/subtitles/local-subtitle-autoload";
import { findMatchingSubtitles } from "@/lib/subtitles/local-subtitle-matching";
import { scanLocalSubtitles } from "@/lib/subtitles/local-subtitle-scanner";
import {
  readRememberedSub,
  rememberedSubAppliesToStream,
  subtitleMediaKey,
} from "@/lib/subtitles/subtitle-memory";
import type { PlayerSrc } from "@/lib/view";

export function useLocalSubtitleAutoload(params: {
  actorKey: string;
  bridgeKey: string | number;
  bridgeReady: boolean;
  bridgeRef: RefObject<PlayerBridge | null>;
  hasRememberedSubtitle: boolean;
  settings: Settings;
  snap: PlayerSnapshot;
  src: PlayerSrc;
}) {
  const {
    actorKey,
    bridgeKey,
    bridgeReady,
    bridgeRef,
    hasRememberedSubtitle,
    settings,
    snap,
    src,
  } = params;
  const localSubRef = useRef<{ path: string; language?: string; pending: boolean } | null>(null);
  const settingsRef = useRef(settings);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  settingsRef.current = settings;
  useEffect(() => {
    localSubRef.current = null;
  }, [src.url, src.meta.id, src.episode?.season, src.episode?.episode, bridgeKey]);
  useEffect(() => {
    const folder = settings.localSubtitleFolder;
    const bridge = bridgeRef.current;
    if (!folder || !bridgeReady || !snap.firstFrameReady || !bridge) return;
    const platform = osClass();
    if (platform === "web" || platform === "android") return;
    const media = localSubtitleMedia(src);
    if (!media) return;

    const controller = new AbortController();
    const playbackActor = capturePlaybackActor();
    const isActive = () =>
      !controller.signal.aborted &&
      isPlaybackActorCurrent(playbackActor) &&
      bridgeRef.current === bridge;
    const canSelect = () =>
      !src.subtitlePreselect &&
      !hasRememberedSubtitle &&
      bridge.canAutoSelectSubtitle?.() !== false &&
      !subsOffFor(readPlayerPrefs(src.meta.id), settingsRef.current) &&
      !rememberedSubAppliesToStream(
        readRememberedSub(subtitleMediaKey(src.meta.id, src.episode?.season, src.episode?.episode)),
        src.streamRef,
      );
    void (async () => {
      const files = await scanLocalSubtitles(folder, controller.signal);
      if (!isActive()) return;
      const currentSettings = settingsRef.current;
      const prefs = readPlayerPrefs(src.meta.id);
      const { subLangs, allow } = trackPreferences(src, currentSettings, prefs);
      const audio = snapRef.current.audioTracks.find((track) => track.selected);
      const forcedOnly =
        currentSettings.forcedSubsWhenNativeAudio &&
        audio != null &&
        langScore(audio.lang ?? "", subLangs) >= 0;
      const matches = findMatchingSubtitles(files, media, subLangs, folder, {
        includeOtherLanguages: true,
      }).map((match) => ({
        ...match,
        title: (match.path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, ""),
        autoSelect:
          (match.forced === true) === forcedOnly &&
          (!match.language || langScore(match.language, subLangs) >= 0),
      }));
      matches.sort((a, b) => Number(b.autoSelect) - Number(a.autoSelect));
      const candidates = allow(matches);
      for (const match of candidates) {
        if (!isActive()) return;
        const tracks = snapRef.current.subtitleTracks;
        const selected = tracks.find((track) => track.selected) ?? null;
        const preferred = pickAutomaticSubtitle(
          tracks,
          audio ?? null,
          subLangs,
          currentSettings,
          allow,
        );
        const select =
          match.autoSelect &&
          canSelect() &&
          localSubtitleTakesPrecedence(
            match.language,
            preferred ?? selected,
            subLangs,
            currentSettings.preferEmbeddedSubs,
          );
        const existing = tracks.find((track) => matchesLocalPath(track, match.path));
        if (existing?.imported) {
          if (select) {
            localSubRef.current = { ...match, pending: false };
            if (!existing.selected) bridge.setSubtitleTrack(existing.id, "automatic");
          }
          return;
        }
        const candidate = { ...match, pending: true };
        if (select) localSubRef.current = candidate;
        let loaded = false;
        try {
          loaded = await bridge.addSubtitle(
            match.path,
            match.language,
            match.title,
            select,
            { forced: match.forced, imported: true },
            "automatic",
          );
        } catch {
          // A broken file should leave the next matching subtitle available.
        }
        if (localSubRef.current === candidate) {
          localSubRef.current = loaded && isActive() ? { ...candidate, pending: false } : null;
        }
        if (loaded) return;
      }
      if (candidates.length > 0 && isActive()) {
        console.warn("[subs/local] could not load a matching subtitle");
      }
    })().catch(() => {
      if (isActive()) console.warn("[subs/local] could not scan the subtitle folder");
    });
    return () => controller.abort();
  }, [
    actorKey,
    bridgeKey,
    bridgeReady,
    bridgeRef,
    hasRememberedSubtitle,
    settings.localSubtitleFolder,
    settings.preferredLanguages,
    settings.preferredSubLangs,
    settings.subtitlesOffByDefault,
    snap.firstFrameReady,
    src,
  ]);
  return localSubRef;
}
