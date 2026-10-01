"use client";

/**
 * The room, without leaving the game. The same `ff_chat_feed` the clubhouse
 * reads and the same `ff_send_message` it posts through — this is a window
 * onto the league chat, not a second chat. The full room, with replies,
 * mentions and polls, is one link away.
 *
 * Presentation only: the page hands it the lines and, when there is a session
 * to post with, a way to post.
 */

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatItem } from "@/lib/types";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** A moment attached to the next message: Talk shit. */
export type TalkContext = { eventId: string; text: string };

export function ChatPanel({ items, onSend, error, context, onClearContext }: {
  items: ChatItem[] | null;
  /** With an event id, the message goes out about that moment. */
  onSend?: (body: string, eventId?: string) => Promise<void>;
  error?: string | null;
  context?: TalkContext | null;
  onClearContext?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Talk shit lands the cursor under the moment, ready to type.
  useEffect(() => {
    if (context) input.current?.focus({ preventScroll: true });
  }, [context]);
  // Newest at the bottom, the way a chat reads. The feed arrives newest first.
  const lines = [...(items ?? [])].filter((x) => x.source === "message").reverse();

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const v = body.trim();
    if (!v || busy || !onSend) return;
    setBusy(true);
    try {
      await onSend(v, context?.eventId);
      setBody("");
      onClearContext?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sun-chat">
      <div className="sun-sec__head" style={{ margin: 0 }}>
        <h2>League chat</h2>
        <Link href="/chat" style={{ fontSize: "var(--t-micro)", color: "var(--sun-gold)" }}>Open the room</Link>
      </div>
      <div className="sun-chat__log" ref={log} aria-live="polite">
        {items === null && <div className="sun-skel" style={{ height: 60 }} />}
        {items !== null && lines.length === 0 && <div className="sun-quiet">Nobody has said anything yet. Somebody should.</div>}
        {lines.map((m) => (
          <div key={m.id} className="sun-msg" data-mine={m.mine}>
            <span className="sun-msg__by">
              <span>{m.mine ? "You" : m.author ?? "League manager"}</span>
              <time dateTime={m.at}>{clock(m.at)}</time>
            </span>
            <span className="sun-msg__body">{m.body}</span>
            {m.reactions.length > 0 && (
              <span className="sun-msg__rx">
                {m.reactions.map((r) => <span key={r.emoji}>{r.emoji} {r.count}</span>)}
              </span>
            )}
          </div>
        ))}
      </div>
      {onSend && context && (
        <div className="sun-chat__ctx" aria-label="Talking about">
          <span>{context.text}</span>
          {onClearContext && (
            <button type="button" aria-label="Don't attach this moment" onClick={onClearContext}>✕</button>
          )}
        </div>
      )}
      {onSend && (
        <form className="sun-chat__send" onSubmit={send}>
          <input ref={input} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={context ? "Talk your talk" : "Say something to the league"}
            aria-label={context ? "Say something about this moment" : "Message the league"}
            maxLength={context ? Math.max(1, 999 - context.text.length) : 1000} />
          <button className="sun-btn" data-v="gold" type="submit" disabled={busy || !body.trim()} aria-label="Send">
            <Send size={14} />
          </button>
        </form>
      )}
      {error && <span style={{ fontSize: "var(--t-micro)", color: "#ff8a80" }}>{error}</span>}
    </div>
  );
}
