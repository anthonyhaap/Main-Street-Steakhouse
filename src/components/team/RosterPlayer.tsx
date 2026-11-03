"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, UserMinus } from "lucide-react";
import { PlayerSheet } from "@/components/player/PlayerSheet";
import type { HubPlayer, PlayerCard } from "@/lib/nfl/types";

/**
 * A rostered player, opened from his row: the card, and what you can do
 * with him from here.
 *
 * On your own desk that is trade him or drop him. On somebody else's it is
 * make an offer for him. The trade buttons go to the trade desk with the
 * offer already started, rather than building a second offer sheet here: the
 * desk is where the deadline, the block and the roster limits live.
 *
 * A drop asks twice. He goes on waivers the moment it lands and any manager
 * can claim him, so one stray tap should not be able to do that.
 */
export function RosterPlayer({
  player, own, teamId, current = true, card, busy, onRelease, onClose,
}: {
  player: HubPlayer;
  /**
   * True when the desk is showing the league's current week. Drops and trades
   * always happen in the current week, but `player.locked` describes the week
   * on screen — a past week reads every man as locked, a future one reads
   * nobody as locked. So the lock is only believed for the current week; on
   * any other the buttons stay live and the database decides, as it always
   * does in the end.
   */
  current?: boolean;
  /** True on the reader's own desk. */
  own: boolean;
  /** The team whose desk this is — whom an offer for him goes to. */
  teamId: string;
  /** A fixture card, so the preview renders without a session. */
  card?: PlayerCard;
  busy: boolean;
  /** Drops him. Resolves true when it landed. Absent where nothing can be written. */
  onRelease?: (p: HubPlayer) => Promise<boolean>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const locked = current && player.locked;

  const note = own && locked ? (
    <div className="note">
      {player.full_name}&apos;s game has started, so he can&apos;t be dropped or traded until it&apos;s over.
    </div>
  ) : confirming ? (
    <div className="note" data-kind="error" role="alert">
      Drop {player.full_name}? He goes on waivers right away, and any team can claim him.
    </div>
  ) : null;

  const actions = own ? (
    confirming ? (
      <>
        <button className="btn" data-v="ghost" data-size="sm" disabled={busy}
          onClick={() => setConfirming(false)}>
          Keep him
        </button>
        <button className="btn" data-v="danger" data-size="sm" disabled={busy}
          onClick={() => void onRelease?.(player).then((ok) => ok && onClose())}>
          {busy ? "…" : `Drop ${player.full_name}`}
        </button>
      </>
    ) : (
      <>
        {locked ? (
          <button className="btn" data-size="sm" disabled>
            <ArrowLeftRight size={13} /> Trade
          </button>
        ) : (
          <Link className="btn" data-size="sm" href={`/transactions?tab=trades&give=${player.player_id}`}>
            <ArrowLeftRight size={13} /> Trade
          </Link>
        )}
        {onRelease && (
          <button className="btn" data-v="danger" data-size="sm" disabled={busy || locked}
            onClick={() => setConfirming(true)}>
            <UserMinus size={13} /> Drop
          </button>
        )}
      </>
    )
  ) : (
    <Link className="btn" data-v="gold" data-size="sm"
      href={`/transactions?tab=trades&with=${teamId}&get=${player.player_id}`}>
      <ArrowLeftRight size={13} /> Trade for him
    </Link>
  );

  return (
    <PlayerSheet
      playerId={player.player_id}
      card={card}
      onClose={() => { if (!busy) onClose(); }}
      preview={note}
      actions={actions}
    />
  );
}
