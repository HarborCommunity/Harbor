import type { FloatingReaction } from "@/views/player/hooks/use-floating-reactions";

/**
 * Reactions rise along the right edge, above the controls and clear of the
 * subtitles. They are decoration for sighted viewers; the chat carries words.
 */
export function ReactionLayer({
  reactions,
  side = "right",
}: {
  reactions: FloatingReaction[];
  side?: "left" | "right";
}) {
  if (reactions.length === 0) return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed bottom-44 z-30 h-0 w-32 ${side === "left" ? "left-8" : "right-8"}`}
    >
      {reactions.map((r) => (
        <span
          key={r.id}
          className="harbor-reaction-rise absolute bottom-0 flex flex-col items-center gap-0.5"
          style={side === "left" ? { left: r.lane * 26 } : { right: r.lane * 26 }}
        >
          <span className="text-[30px] leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)]">
            {r.emoji}
          </span>
          <span className="max-w-[88px] truncate rounded-full bg-black/55 px-1.5 py-px text-[10px] font-semibold text-white/85">
            {r.name}
          </span>
        </span>
      ))}
    </div>
  );
}
