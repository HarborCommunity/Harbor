import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useTogether } from "@/lib/together/provider";
import type { SavedRoom } from "@/lib/together/rejoin";
import { useView } from "@/lib/view";

/** The offer disappears on its own after this long; rejoining is always the user's choice. */
const OFFER_VISIBLE_MS = 20_000;
/** A guest's rejoin brings its own invite; wait this long for it before opening the title. */
const INVITE_GRACE_MS = 1500;

/**
 * After a crash or restart, offers to rejoin the watch party this app was in
 * and reopens what the room was watching.
 */
export function TogetherRejoinToast() {
  const { rejoinOffer, acceptRejoin, dismissRejoin, snapshot, incomingInvite } = useTogether();
  const { openPicker } = useView();
  const t = useT();
  const reopenRef = useRef<SavedRoom["media"]>(null);
  const [joining, setJoining] = useState(false);

  const join = () => {
    reopenRef.current = rejoinOffer?.media ?? null;
    setJoining(true);
    acceptRejoin();
  };
  // Timing out only hides the offer; the ✕ button forgets the room.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!rejoinOffer) return;
    const id = window.setTimeout(() => setHidden(true), OFFER_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [rejoinOffer]);

  // Hosts get no invite for their own room, so reopen the title for them.
  useEffect(() => {
    if (!joining) return;
    // A guest's invite takes over from here, and a failed join reopens nothing later.
    if (incomingInvite || snapshot.state === "error") {
      setJoining(false);
      reopenRef.current = null;
      return;
    }
    if (snapshot.state !== "joined") return;
    const timer = window.setTimeout(() => {
      setJoining(false);
      const media = reopenRef.current;
      reopenRef.current = null;
      if (!media) return;
      openPicker(
        { id: media.id, type: media.type, name: media.name, poster: media.poster },
        media.episode,
        { autoPlay: true },
      );
    }, INVITE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [joining, snapshot.state, incomingInvite, openPicker]);

  if (!rejoinOffer || hidden) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-[260] flex justify-center px-6">
      <div className="harbor-together-pill pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-full border border-edge bg-surface/98 py-2 ps-5 pe-2 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)] animate-popover-in">
        <div className="flex min-w-0 flex-col gap-0.5 pe-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-accent">
            {t("Rejoin watch party")}
          </span>
          <span className="max-w-[300px] truncate text-[13.5px] font-semibold text-ink">
            {rejoinOffer.media?.name ?? rejoinOffer.room}
          </span>
        </div>
        <button
          onClick={join}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-canvas transition-transform hover:scale-[1.04]"
        >
          {t("Rejoin")} <ArrowRight size={13} strokeWidth={2.4} className="dir-icon" />
        </button>
        <button
          onClick={dismissRejoin}
          aria-label={t("Dismiss")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
