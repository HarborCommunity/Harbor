import { memo, useMemo } from "react";
import { AvatarDock } from "@/components/player/avatar-dock";
import { ChatOverlay } from "@/components/player/chat-overlay";
import { ReactionLayer } from "@/components/player/reaction-layer";
import type { PanelCorner } from "@/lib/player-chrome";
import type { RoomSnapshot } from "@/lib/together/client";
import type { ChatMessage } from "@/lib/together/provider";
import type {
  ParticipantLocation,
  ReactionEmoji,
  SourceDescriptor,
  SyncState,
} from "@/lib/together/protocol";
import type { FloatingReaction } from "./hooks/use-floating-reactions";
import { DurationMismatchChip } from "./duration-mismatch-chip";
import { ForeignNoticeBox } from "./foreign-notice-box";
import { RoomActivityNotice, type RoomActivityNoticeInfo } from "./room-activity-notice";
import { RoomSyncPill, type RoomSyncPillNotice } from "./room-sync-pill";
import { WaitingForRoom } from "./waiting-for-room";

export const RoomLayer = memo(function RoomLayer({
  inRoom,
  pipMode,
  drawMode,
  participants,
  clientId,
  hostClientId,
  syncState,
  participantStatus,
  participantOffset,
  avatarsVisible,
  presenceMap,
  participantLocations,
  now,
  avatarsCorner,
  avatarsHidden,
  chat,
  sendChat,
  onReact,
  reactions,
  chromeVisible,
  chatCorner,
  chatHidden,
  showWaiting,
  isHost,
  staleIds,
  guestEscapeReady,
  onStart,
  onPlayWithoutSync,
  onLeave,
  guestHostSource,
  guestDurationSec,
  casting,
  currentUrl,
  switcherOpen,
  onFindCloser,
  foreignNotice,
  onDismissForeign,
  syncNotice,
  onKeepWatching,
  activityNotice,
  belowStreamCheck = false,
  autoStartAt,
  onCancelAutoStart,
}: {
  inRoom: boolean;
  pipMode: boolean;
  drawMode: boolean;
  participants: RoomSnapshot["participants"];
  clientId: string;
  hostClientId: string | null;
  syncState: SyncState | null;
  participantStatus: RoomSnapshot["participantStatus"];
  participantOffset: RoomSnapshot["participantOffset"];
  avatarsVisible: boolean;
  presenceMap: Map<string, number>;
  participantLocations: Map<string, ParticipantLocation>;
  now: number;
  avatarsCorner: PanelCorner;
  avatarsHidden: boolean;
  chat: ChatMessage[];
  sendChat: (text: string) => void;
  onReact?: (emoji: ReactionEmoji) => void;
  reactions: FloatingReaction[];
  chromeVisible: boolean;
  chatCorner: PanelCorner;
  chatHidden: boolean;
  showWaiting: boolean;
  isHost: boolean;
  staleIds: Set<string>;
  guestEscapeReady: boolean;
  onStart: () => void;
  onPlayWithoutSync: () => void;
  onLeave: () => void;
  guestHostSource: SourceDescriptor | null;
  guestDurationSec: number;
  casting: boolean;
  currentUrl: string;
  switcherOpen: boolean;
  onFindCloser: () => void;
  foreignNotice: { title: string | null; from: string } | null;
  onDismissForeign: () => void;
  syncNotice: RoomSyncPillNotice | null;
  onKeepWatching?: () => void;
  activityNotice: RoomActivityNoticeInfo | null;
  /** The "Does this stream look right?" prompt holds the top centre; sit under it. */
  belowStreamCheck?: boolean;
  autoStartAt: number | null;
  onCancelAutoStart: () => void;
}) {
  const everyoneReady = useMemo(
    () => participants.length > 0 && participants.every((p) => p.ready),
    [participants],
  );
  const notReady = useMemo(() => participants.filter((p) => !p.ready), [participants]);
  return (
    <>
      {inRoom && !pipMode && (
        <AvatarDock
          participants={participants}
          selfId={clientId}
          hostId={hostClientId}
          syncState={syncState}
          participantStatus={participantStatus}
          participantOffset={participantOffset}
          visible={avatarsVisible}
          presenceMap={presenceMap}
          participantLocations={participantLocations}
          now={now}
          corner={avatarsCorner}
          hidden={avatarsHidden}
        />
      )}

      {inRoom && !pipMode && (
        <ChatOverlay
          messages={chat}
          onSend={sendChat}
          onReact={onReact}
          selfId={clientId}
          participants={participants}
          forceVisible={chromeVisible}
          corner={chatCorner}
          hidden={chatHidden}
        />
      )}

      {inRoom && !pipMode && <ReactionLayer reactions={reactions} />}

      {showWaiting && (
        <WaitingForRoom
          isHost={isHost}
          notReady={notReady}
          participants={participants}
          clientId={clientId}
          everyoneReady={everyoneReady}
          staleIds={staleIds}
          guestEscapeReady={guestEscapeReady}
          onStart={onStart}
          onPlayWithoutSync={onPlayWithoutSync}
          onLeave={onLeave}
          autoStartAt={autoStartAt}
          onCancelAutoStart={onCancelAutoStart}
        />
      )}

      {inRoom && !showWaiting && !pipMode && (syncNotice || activityNotice) && (
        <div
          className={`pointer-events-none absolute left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-2 transition-[top] duration-300 ${
            belowStreamCheck ? "top-28" : "top-20"
          }`}
        >
          {syncNotice && <RoomSyncPill notice={syncNotice} onKeepWatching={onKeepWatching} />}
          {activityNotice && <RoomActivityNotice notice={activityNotice} />}
        </div>
      )}

      {!pipMode && !drawMode && (
        <DurationMismatchChip
          hostSource={guestHostSource}
          guestDurationSec={guestDurationSec}
          casting={casting}
          currentUrl={currentUrl}
          switcherOpen={switcherOpen}
          onFindCloser={onFindCloser}
        />
      )}

      {foreignNotice && (
        <ForeignNoticeBox title={foreignNotice.title} onDismiss={onDismissForeign} />
      )}
    </>
  );
});
