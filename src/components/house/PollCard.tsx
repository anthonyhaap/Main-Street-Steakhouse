"use client";

import { BarChart3, Check } from "lucide-react";
import type { Poll } from "@/lib/types";

/**
 * A poll, in the feed.
 *
 * The design job is the withheld split. Before you answer, the options are
 * buttons and there are no bars — showing a running score first is what turns a
 * poll into a measure of conformity. After you answer they become bars with
 * counts, and your own is marked. The turnout is on screen the whole time,
 * because "nine have voted" is pressure to join in without being pressure to
 * agree.
 *
 * Presentation only; the page owns the RPC.
 */
export function PollCard({
  poll, busy, onVote,
}: {
  poll: Poll;
  busy: boolean;
  onVote: (optionId: string) => void;
}) {
  const total = poll.votes || 0;
  const closes = poll.closes_at
    ? new Date(poll.closes_at).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
      {poll.options.map((o) => {
        const share = poll.revealed && total > 0 ? Math.round(((o.count ?? 0) / total) * 100) : 0;
        return (
          <button
            key={o.option_id}
            className="poll__opt"
            data-mine={o.mine}
            data-revealed={poll.revealed}
            disabled={busy || poll.closed}
            aria-label={
              poll.revealed
                ? `${o.label}, ${o.count ?? 0} of ${total}${o.mine ? ", your answer" : ""}`
                : `Vote for ${o.label}`
            }
            onClick={() => onVote(o.option_id)}
          >
            {/* The bar is behind the label rather than beside it, so a long
                answer never gets squeezed by its own result. */}
            {poll.revealed && <span className="poll__bar" style={{ width: `${share}%` }} aria-hidden />}
            <span className="poll__label">
              {o.mine && <Check size={12} aria-hidden />}
              {o.label}
            </span>
            {poll.revealed && <span className="num poll__count">{o.count ?? 0}</span>}
          </button>
        );
      })}

      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--faint)" }}>
        <BarChart3 size={12} />
        <span>
          <span className="num">{total}</span> {total === 1 ? "vote" : "votes"}
          {!poll.revealed && " · answer to see the split"}
          {poll.closed ? " · closed" : closes ? ` · closes ${closes}` : ""}
        </span>
      </div>
    </div>
  );
}
