"use client";

import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { EMOJI, type Reaction } from "@/lib/types";

/**
 * The reaction row under one feed item.
 *
 * Two states rather than one, deliberately. A line nobody has reacted to shows
 * a single quiet button, because six buttons under every row in the feed is
 * noise the moment the league gets busy. Once anybody has pressed something,
 * the tally itself becomes the control — you press what is already there, or
 * open the palette for something else.
 *
 * Presentation only; the page owns the RPC.
 */
export function Reactions({
  reactions, busy, onPress,
}: {
  reactions: Reaction[];
  busy: boolean;
  onPress: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const has = reactions.length > 0;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, alignItems: "center" }}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className="reaction"
          data-on={r.mine}
          disabled={busy}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
          onClick={() => onPress(r.emoji)}
        >
          <span aria-hidden>{r.emoji}</span>
          <span className="num">{r.count}</span>
        </button>
      ))}

      {open ? (
        EMOJI.filter((e) => !reactions.some((r) => r.emoji === e)).map((e) => (
          <button
            key={e}
            className="reaction"
            disabled={busy}
            aria-label={`React with ${e}`}
            onClick={() => { onPress(e); setOpen(false); }}
          >
            <span aria-hidden>{e}</span>
          </button>
        ))
      ) : (
        <button
          className="reaction"
          data-quiet={!has}
          disabled={busy}
          aria-label="Add a reaction"
          onClick={() => setOpen(true)}
        >
          <SmilePlus size={13} />
        </button>
      )}
    </div>
  );
}
