"use client";

/**
 * Reactions on a pick, sized for the ticker.
 *
 * The House's `Reactions` is a row that wraps under a feed item; the ticker is
 * a strip of pills you swipe sideways, and a wrapping row inside one would
 * make every pill two lines tall and the strip unreadable. Same table, same
 * palette, same toggle — a different shape, because the shape is the only
 * thing that differs.
 *
 * Presentation only. The page owns the RPC, exactly as the House does.
 */

import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { EMOJI, type Reaction } from "@/lib/types";

export function PickReactions({ reactions, busy, onPress }: {
  reactions: Reaction[];
  busy: boolean;
  onPress: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="tickr">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className="tickr__chip"
          data-on={r.mine}
          disabled={busy}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
          onClick={() => onPress(r.emoji)}
        >
          <span aria-hidden>{r.emoji}</span>
          <b className="num">{r.count}</b>
        </button>
      ))}

      {open ? (
        // The palette replaces the opener rather than pushing it along, so the
        // pill does not jump sideways under the thumb that just tapped it.
        <span className="tickr__palette">
          {EMOJI.map((e) => (
            <button
              key={e}
              className="tickr__pick"
              disabled={busy}
              aria-label={`React with ${e}`}
              onClick={() => { setOpen(false); onPress(e); }}
            >
              {e}
            </button>
          ))}
        </span>
      ) : (
        <button
          className="tickr__add"
          disabled={busy}
          aria-label="React to this pick"
          onClick={() => setOpen(true)}
        >
          <SmilePlus size={13} />
        </button>
      )}
    </span>
  );
}
