"use client";

import { FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { FeedReply } from "@/lib/types";

/**
 * The thread under one feed item.
 *
 * Closed by default and collapsed into a count, same reasoning as a reaction
 * row that starts as one quiet button: a full thread under every line in a
 * busy House is noise, and an argument that is happening opens on its own.
 * The replies themselves are fetched only once a manager actually opens the
 * thread — `replies` is null until then, distinct from an opened-and-empty
 * thread, which is `[]`.
 *
 * Presentation only; the page owns the RPCs.
 */
export function Replies({
  count, replies, open, loading, busy, draft, onToggle, onDraftChange, onSubmit,
}: {
  count: number;
  replies: FeedReply[] | null;
  open: boolean;
  loading: boolean;
  busy: boolean;
  draft: string;
  onToggle: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        className="chat__on"
        style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", padding: 0 }}
        aria-expanded={open}
        onClick={onToggle}
      >
        <MessageSquare size={11} />
        {count === 0 ? "Reply" : `${count} ${count === 1 ? "reply" : "replies"}`}
      </button>

      {open && (
        <div className="replies">
          {loading && <div className="eyebrow" style={{ color: "var(--faint)" }}>Loading…</div>}
          {!loading && replies?.length === 0 && (
            <div className="eyebrow" style={{ color: "var(--faint)" }}>Nobody yet.</div>
          )}
          {replies?.map((r) => (
            <div key={r.id} className="replies__row">
              <span className="replies__who">{r.mine ? "You" : r.author ?? "League manager"}</span>
              {" "}{r.body}
            </div>
          ))}
          <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <input
              className="field"
              style={{ flex: 1, minWidth: 0 }}
              maxLength={500}
              value={draft}
              placeholder="Write a reply…"
              aria-label="Write a reply"
              onChange={(e) => onDraftChange(e.target.value)}
            />
            <button
              className="btn"
              data-v="primary"
              data-size="icon"
              disabled={busy || !draft.trim()}
              aria-label="Send reply"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
