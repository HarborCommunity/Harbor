import { History, MessageCircle, Send, SmilePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { nameColor } from "@/lib/together/colors";
import { groupOverlayMessages, overlayMessages } from "@/lib/together/chat-overlay-messages";
import type { PanelCorner } from "@/lib/player-chrome";
import type { ChatMessage } from "@/lib/together/provider";
import { REACTION_EMOJI, type Participant, type ReactionEmoji } from "@/lib/together/protocol";
import { useSelfIdentity } from "@/lib/together/use-self-identity";
import { useT } from "@/lib/i18n";
import { registerChatHistoryDismiss } from "@/lib/together/chat-history-dismiss";
import { useSettings } from "@/lib/settings";

const COMPOSE_TIMEOUT_MS = 4500;
const STICK_TO_BOTTOM_PX = 24;
/** The reaction row closes this long after the last tap. */
const REACT_IDLE_MS = 5000;

const CORNER_POSITION: Record<PanelCorner, string> = {
  "top-left": "top-20 left-6 items-start",
  "top-right": "top-20 right-6 items-end",
  "bottom-left": "bottom-44 left-6 items-start",
  "bottom-right": "bottom-44 right-6 items-end",
};

export function ChatOverlay({
  messages,
  onSend,
  selfId,
  participants,
  forceVisible,
  corner = "bottom-left",
  hidden = false,
  onReact,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /** Present only when the relay passes reactions on. */
  onReact?: (emoji: ReactionEmoji) => void;
  selfId: string;
  participants: Participant[];
  forceVisible: boolean;
  corner?: PanelCorner;
  hidden?: boolean;
}) {
  const t = useT();
  const selfIdentity = useSelfIdentity();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const { settings } = useSettings();
  const keepHistoryOpen = settings.togetherChatHistoryOpen;
  const [historyOpen, setHistoryOpen] = useState(keepHistoryOpen);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const [reacting, setReacting] = useState(false);
  const [reactTouchedAt, setReactTouchedAt] = useState(0);
  const firstReactionRef = useRef<HTMLButtonElement>(null);
  const composeTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key ?? "").toLowerCase() === "t" &&
        !composing &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        setComposing(true);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
      if (e.key === "Escape" && composing) {
        setComposing(false);
        setDraft("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing]);

  useEffect(() => {
    setHistoryOpen(keepHistoryOpen);
  }, [keepHistoryOpen]);

  // A hidden overlay draws nothing, so it must not take an Escape/Back step.
  useEffect(() => {
    if (!historyOpen || keepHistoryOpen || hidden) return;
    return registerChatHistoryDismiss(() => setHistoryOpen(false));
  }, [historyOpen, keepHistoryOpen, hidden]);

  useEffect(() => {
    if (!reacting || hidden) return;
    return registerChatHistoryDismiss(() => setReacting(false));
  }, [reacting, hidden]);
  useEffect(() => {
    if (!reacting) return;
    const id = window.setTimeout(() => setReacting(false), REACT_IDLE_MS);
    return () => window.clearTimeout(id);
  }, [reacting, reactTouchedAt]);
  useEffect(() => {
    if (!onReact) setReacting(false);
  }, [onReact]);

  useEffect(() => {
    const el = listRef.current;
    if (!historyOpen || !el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
  }, [historyOpen]);

  // New messages follow the bottom only when the reader was already there.
  // Keyed on the newest message: the stored chat is capped, so its length stops
  // changing once the cap is reached.
  const newest = messages.at(-1);
  const newestKey = newest ? `${newest.from}-${newest.at}` : "";
  useEffect(() => {
    const el = listRef.current;
    if (!historyOpen || !el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [historyOpen, newestKey]);

  useEffect(() => {
    if (!composing) return;
    if (composeTimer.current) window.clearTimeout(composeTimer.current);
    composeTimer.current = window.setTimeout(() => {
      if (!draft.trim()) {
        setComposing(false);
        setDraft("");
      }
    }, COMPOSE_TIMEOUT_MS);
    return () => {
      if (composeTimer.current) window.clearTimeout(composeTimer.current);
    };
  }, [composing, draft]);

  const visible = useMemo(
    () => overlayMessages(messages, tickNow, historyOpen),
    [messages, tickNow, historyOpen],
  );
  const grouped = useMemo(() => groupOverlayMessages(visible), [visible]);
  const showStream = visible.length > 0 || forceVisible || composing || reacting;
  const align = corner.endsWith("right") ? "items-end" : "items-start";

  const submit = () => {
    const txt = draft.trim();
    if (!txt) return;
    onSend(txt);
    setDraft("");
    setComposing(false);
  };

  if (hidden) return null;
  return (
    <div
      className={`pointer-events-none fixed ${CORNER_POSITION[corner]} z-30 flex max-w-[420px] flex-col transition-opacity duration-500 ${
        showStream ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
        }}
        className={`flex max-w-full flex-col ${align} ${
          historyOpen
            ? "pointer-events-auto max-h-[45vh] overflow-y-scroll overscroll-contain pe-1"
            : ""
        }`}
      >
        {grouped.map(({ message, isContinuation }) => {
          const isSelf = message.from === selfId;
          const ident = isSelf ? selfIdentity : participants.find((p) => p.id === message.from);
          return (
            <Bubble
              key={`${message.from}-${message.at}`}
              message={message}
              isSelf={isSelf}
              isContinuation={isContinuation}
              avatar={ident?.avatar ?? null}
              color={ident?.color ?? null}
            />
          );
        })}
      </div>
      {composing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="pointer-events-auto mt-3 flex items-center gap-2 rounded-full border border-white/15 bg-black/65 px-3.5 py-2 backdrop-blur-xl shadow-[0_18px_45px_-20px_rgba(0,0,0,0.7)]"
        >
          <MessageCircle size={14} strokeWidth={2.2} className="text-white/55" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Say something…")}
            className="flex-1 bg-transparent text-[13.5px] text-white placeholder:text-white/35 outline-none"
            maxLength={300}
          />
          <button
            type="submit"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/85 transition-colors hover:bg-white/20"
            aria-label={t("Send")}
          >
            <Send size={12} strokeWidth={2.4} />
          </button>
        </form>
      ) : (
        <div className="pointer-events-auto mt-3 flex items-center gap-1.5">
          <button
            onClick={() => {
              setComposing(true);
              setTimeout(() => inputRef.current?.focus(), 30);
            }}
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/12 bg-black/45 px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-white/65 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
          >
            <MessageCircle size={11} strokeWidth={2.4} />
            {t("Press T")}
          </button>
          {onReact && (
            <button
              onClick={() => {
                setReacting((open) => !open);
                setReactTouchedAt(Date.now());
                setTimeout(() => firstReactionRef.current?.focus({ preventScroll: true }), 30);
              }}
              aria-expanded={reacting}
              aria-label={t("React")}
              title={t("React")}
              className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/12 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white ${
                reacting ? "bg-white/20 text-white" : "bg-black/45 text-white/65"
              }`}
            >
              <SmilePlus size={13} strokeWidth={2.2} />
            </button>
          )}
          {onReact && reacting && (
            <div
              role="group"
              aria-label={t("Reactions")}
              className="flex items-center gap-0.5 rounded-full border border-white/12 bg-black/55 px-1 py-0.5 backdrop-blur-md animate-popover-in"
            >
              {REACTION_EMOJI.map((emoji, i) => (
                <button
                  key={emoji}
                  ref={i === 0 ? firstReactionRef : undefined}
                  onClick={() => {
                    onReact(emoji);
                    setReactTouchedAt(Date.now());
                  }}
                  aria-label={emoji}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[17px] transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => setHistoryOpen((open) => !open)}
              aria-pressed={historyOpen}
              aria-label={t("Chat history")}
              title={t("Chat history")}
              className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/12 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white ${
                historyOpen ? "bg-white/20 text-white" : "bg-black/45 text-white/65"
              }`}
            >
              <History size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Bubble({
  message,
  isSelf,
  isContinuation,
  avatar,
  color,
}: {
  message: ChatMessage;
  isSelf: boolean;
  isContinuation: boolean;
  avatar: string | null;
  color: string | null;
}) {
  const tint = color ?? nameColor(message.name);
  if (isContinuation) {
    return (
      <div
        className={`pointer-events-auto flex max-w-full ${isSelf ? "self-end" : ""}`}
        style={{ marginTop: 2, paddingInlineStart: isSelf ? 0 : 32 }}
      >
        <span className="break-words rounded-2xl border border-white/10 bg-black/55 px-3 py-1.5 text-[13.5px] leading-snug text-white backdrop-blur-xl">
          {message.text}
        </span>
      </div>
    );
  }
  return (
    <div
      className={`pointer-events-auto mt-1.5 flex max-w-full items-start gap-2 rounded-2xl border border-white/10 bg-black/55 px-3 py-1.5 backdrop-blur-xl ${
        isSelf ? "self-end" : ""
      }`}
    >
      {avatar ? (
        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/15">
          <img src={avatar} alt="" draggable={false} className="h-full w-full object-cover" />
        </span>
      ) : (
        <span
          className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-black"
          style={{ background: tint }}
        >
          {(message.name?.[0] ?? "?").toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/55">
          {message.name}
        </span>
        <span className="break-words text-[13.5px] leading-snug text-white">{message.text}</span>
      </div>
    </div>
  );
}
