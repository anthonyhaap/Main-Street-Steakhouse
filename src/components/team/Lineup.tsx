"use client";

import { ArrowLeftRight, Lock, Plane } from "lucide-react";
import { Face, InjuryBadge, Kickoff, Spark, usageLine } from "@/components/nfl";
import { fmtPts } from "@/components/ui";
import type { HubPlayer, WireInjury } from "@/lib/nfl/types";

/**
 * One roster line.
 *
 * The old row was a single button: clicking anywhere started a lineup move.
 * That worked when a row held a name and a number, but it can't hold a row that
 * is also worth *reading* — you cannot click a player to see why he's a start
 * without accidentally benching him. So the two intents are now two targets:
 * the player block opens him, the arrows button picks him up.
 *
 * Once a move is in flight that stops being true — every legal row becomes one
 * drop target, laid over the whole line, because at that moment there is only
 * one thing a click can sensibly mean.
 */
export function PlayerRow({
  slot, player, week, injury, moving, target, selected, busy, onOpen, onPickUp, onDrop,
}: {
  slot: string;
  player: HubPlayer | null;
  week: number;
  injury: WireInjury | null;
  moving: boolean;
  target: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onPickUp: () => void;
  onDrop: () => void;
}) {
  const locked = player?.locked ?? false;
  const form = player?.form ?? null;
  const use = player ? usageLine(player) : null;
  const hurt = injury && injury.severity !== "probable";

  return (
    <div
      className="plr"
      data-selected={selected}
      data-target={moving && target}
      data-locked={locked}
      data-empty={!player}
    >
      <span className="pos" data-p={slot}>{slot}</span>

      {player ? (
        <button type="button" className="plr__main" onClick={onOpen}
          aria-label={`Open ${player.full_name}`}>
          <Face player={player} size={38} />
          <span style={{ minWidth: 0 }}>
            <span className="plr__name">
              {player.full_name}
              {locked && <Lock size={11} color="var(--faint)" />}
              {player.on_bye && <Plane size={11} color="var(--warn)" aria-label="On bye" />}
            </span>
            <span className="plr__sub">
              <span>{player.position} · {player.nfl_team ?? "FA"}</span>
              {player.depth.rank && player.depth.of ? (
                <span style={{ color: "var(--faint)" }}>
                  {player.position}{player.depth.rank} of {player.depth.of}
                </span>
              ) : null}
              {hurt && <InjuryBadge injury={injury} />}
            </span>
          </span>
        </button>
      ) : (
        <span style={{ color: "var(--lose)", fontStyle: "italic", fontSize: "var(--t-small)" }}>
          Empty — scores zero
        </span>
      )}

      <span className="plr__match">
        {player ? <Kickoff game={player.game} week={week} /> : null}
      </span>

      <span className="plr__form">
        {form ? (
          <>
            <b>{form.avg_points.toFixed(1)}</b>
            <span>avg · {form.games} gm</span>
            {form.game_log.length > 1 && <Spark points={form.game_log} width={88} height={16} />}
          </>
        ) : (
          <span style={{ color: "var(--faint)", fontSize: 10 }}>No history</span>
        )}
      </span>

      <span className="plr__use">{use}</span>

      <span className="plr__pts">{player ? fmtPts(player.points) : "—"}</span>

      <button
        type="button"
        className="plr__act"
        onClick={onPickUp}
        disabled={!player || locked || busy || moving}
        title={locked ? "Locked — his game has started" : "Move to another slot"}
        aria-label={player ? `Move ${player.full_name}` : "Empty slot"}
      >
        <ArrowLeftRight size={13} />
      </button>

      {moving && target && (
        <button type="button" className="plr__drop" onClick={onDrop} disabled={busy}>
          Move here
        </button>
      )}
    </div>
  );
}
