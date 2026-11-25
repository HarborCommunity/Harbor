import { Check, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/together-modal/avatar";
import type { Participant } from "@/lib/together/protocol";
import type { ToastPosition } from "@/lib/toast-position";

type ListenerAvatar = Pick<Participant, "name" | "avatar" | "color">;
type Toast = {
  id: number;
  text: string;
  tone: "success" | "error";
  listener?: ListenerAvatar;
  position: "center" | "right";
  overlayPosition?: ToastPosition;
};

const POSITION_CLASSES: Record<ToastPosition, string> = {
  center: "inset-0 flex items-center justify-center px-6",
  top: "inset-x-0 top-16 flex justify-center px-6",
  "top-left": "left-6 top-16",
  "top-right": "right-6 top-16",
};

const listeners = new Set<(t: Toast) => void>();
let seq = 0;

function showToast(toast: Omit<Toast, "id">): void {
  const next = { ...toast, id: ++seq };
  for (const fn of listeners) fn(next);
}

export function emitListToast(
  text: string,
  tone: Toast["tone"] = "success",
  overlayPosition?: ToastPosition,
): void {
  showToast({ text, tone, position: "center", overlayPosition });
}

export function emitListenAlongToast(
  text: string,
  tone: Toast["tone"] = "success",
  listener?: ListenerAvatar,
): void {
  showToast({ text, tone, listener, position: "right" });
}

export function ListToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onToast = (t: Toast) => {
      setToast(t);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), 2400);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;
  const placement = toast.overlayPosition ? POSITION_CLASSES[toast.overlayPosition] : undefined;
  const defaultPlacement =
    toast.position === "right" ? "right-4 max-w-[calc(100%-2rem)]" : "left-1/2 -translate-x-1/2";

  return createPortal(
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      style={
        placement
          ? undefined
          : {
              bottom:
                "calc(1.5rem + var(--harbor-music-dock, 0px) + var(--harbor-viewport-bottom, 0px))",
            }
      }
      className={`pointer-events-none fixed z-[260] ${placement ?? `bottom-6 animate-popover-in ${defaultPlacement}`}`}
    >
      <div
        className={`pointer-events-auto flex items-center gap-2.5 rounded-full border border-edge-soft bg-elevated/95 py-1.5 ps-1.5 pe-4 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)] backdrop-blur-md ${placement ? "max-w-[calc(100vw-3rem)] animate-popover-in" : ""}`}
      >
        {toast.listener ? (
          <span aria-hidden="true" className="shrink-0">
            <Avatar
              name={toast.listener.name}
              src={toast.listener.avatar}
              color={toast.listener.color}
              size={28}
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${toast.tone === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"}`}
          >
            {toast.tone === "error" ? (
              <CircleAlert size={15} strokeWidth={2} />
            ) : (
              <Check size={13} strokeWidth={2.6} />
            )}
          </span>
        )}
        <span
          className={`text-[12.5px] font-medium text-ink ${placement ? "min-w-0 [overflow-wrap:anywhere]" : ""}`}
        >
          {toast.text}
        </span>
      </div>
    </div>,
    document.body,
  );
}
