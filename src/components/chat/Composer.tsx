"use client";

import { useEffect, type FormEvent } from "react";
import { AtSign, BarChart3, Plus, Send, X } from "lucide-react";
import type { ChatItem } from "@/lib/types";

/**
 * The line you type into, pinned to the foot of the room.
 *
 * It used to sit at the top of the page over a feed that ran newest-first,
 * which is how a notice board reads and not how a conversation does: every
 * other chat on a phone puts the newest line at the bottom, right above the
 * thumb that answers it. So the room now reads down, and this sits at its foot
 * — sticky over the tab bar while you scroll back, and on its own at the
 * bottom of the glass while the keyboard is up (the tab bar steps aside for
 * the keyboard; see `useKeyboardOpen` in the shell).
 *
 * Presentation only, so /preview/chat can hold the same composer still.
 */
export function Composer({
  body, onBody, busy, replyTo, onCancelReply, mentionPicker, onMentionPicker,
  teammates, mentioned, onToggleMention, onSubmit, onAsk,
}: {
  body: string;
  onBody: (v: string) => void;
  busy: boolean;
  replyTo: ChatItem | null;
  onCancelReply: () => void;
  mentionPicker: boolean;
  onMentionPicker: (open: boolean) => void;
  teammates: { id: string; user_id: string; name: string }[];
  mentioned: { user_id: string; name: string }[];
  onToggleMention: (user_id: string, name: string) => void;
  onSubmit: (e: FormEvent) => void;
  /** Opens the poll sheet. */
  onAsk: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="chat-compose" aria-label="Write to the league">
      {replyTo && (
        <div className="chat-compose__reply">
          <span>Replying to <b>{replyTo.author ?? "League manager"}</b>: {replyTo.body.slice(0, 80)}</span>
          <button type="button" className="btn" data-v="ghost" data-size="icon" aria-label="Cancel reply" onClick={onCancelReply}>
            <X size={14} />
          </button>
        </div>
      )}

      {mentionPicker && (
        <div className="chat-compose__mentions" role="group" aria-label="Mention a manager">
          {teammates.length === 0 ? (
            <span className="eyebrow" style={{ color: "var(--faint)" }}>No other managers yet.</span>
          ) : teammates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="segmented__opt"
              data-on={mentioned.some((m) => m.user_id === t.user_id)}
              onClick={() => onToggleMention(t.user_id, t.name)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {mentioned.length > 0 && (
        <div className="eyebrow chat-compose__tagged">
          Mentioning: {mentioned.map((m) => `@${m.name}`).join(" ")}
        </div>
      )}

      <div className="chat-compose__row">
        <button type="button" className="btn" data-v="ghost" data-size="icon"
          aria-label="Ask the room a question" title="Ask the room a question" onClick={onAsk}>
          <BarChart3 size={17} />
        </button>
        <button
          type="button"
          className="btn"
          data-v={mentionPicker ? "primary" : "ghost"}
          data-size="icon"
          aria-label="Mention a manager"
          aria-pressed={mentionPicker}
          title="Mention a manager"
          onClick={() => onMentionPicker(!mentionPicker)}
        >
          <AtSign size={17} />
        </button>
        <input
          className="field"
          maxLength={1000}
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder={replyTo ? "Write your reply…" : "Say something to the league…"}
          aria-label="Say something to the league"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          className="btn"
          data-v="primary"
          data-size="icon"
          disabled={busy || !body.trim()}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}

/**
 * Asking the room, as a sheet over it. A question with up to six answers is
 * taller than the space left above a keyboard, and it used to open inline at
 * the top of the page, pushing the room down a screen to make the room for it.
 */
export function AskSheet({
  question, onQuestion, options, onOptions, busy, onSubmit, onClose,
}: {
  question: string;
  onQuestion: (v: string) => void;
  options: string[];
  onOptions: (v: string[]) => void;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal aria-label="Ask the room" onClick={onClose}>
      <form onSubmit={onSubmit} className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="card__head">
          <h2>Ask the room</h2>
          <button type="button" className="btn" data-v="ghost" data-size="icon" aria-label="Cancel" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="card__body" style={{ display: "grid", gap: 8 }}>
          <input className="field" maxLength={140} value={question} autoFocus
            placeholder="Who wins the Chase trade?" aria-label="Your question"
            onChange={(e) => onQuestion(e.target.value)} />
          {options.map((o, i) => (
            <input key={i} className="field" maxLength={80} value={o}
              placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
              onChange={(e) => onOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            {options.length < 6 && (
              <button type="button" className="btn" onClick={() => onOptions([...options, ""])}>
                <Plus size={14} /> Another answer
              </button>
            )}
            <button className="btn" data-v="primary" style={{ marginLeft: "auto" }}
              disabled={busy || !question.trim() || options.filter((o) => o.trim()).length < 2}>
              {busy ? "…" : "Ask"}
            </button>
          </div>
          <span className="eyebrow" style={{ color: "var(--faint)" }}>
            Nobody sees the split until they have answered, and no answer is
            ever shown with a name on it.
          </span>
        </div>
      </form>
    </div>
  );
}
