"use client";

import { ArrowLeftRight, Lock, Plane } from "lucide-react";
import { InjuryBadge, Kickoff, Spark, usageLine } from "@/components/nfl";
import { PlayerBadge } from "@/components/PlayerBadge";
import { fmtPts } from "@/components/ui";
import type { HubPlayer, WireInjury } from "@/lib/nfl/types";

/**
 * One roster line.
 *
 * The old row was a single button: clicking anywhere started a lineup move.
 * That worked when a row held a name and a number, but not when the row is also
 * worth *reading* — you cannot open a player to see whether he is a start
 * without accidentally benching him. So the two intents are two targets: the
 * badge opens his page, the arrows button picks him up.
 *
 * Once a move is in flight that stops being true — every legal row becomes one
 * drop target laid over the whole line, because at that moment there is only
 * one thing a click can sensibly mean.
 */
export function PlayerRow({
  slot, player, week, injury, projection, moving, target, selected, busy, onPickUp, onDrop,
}: {
  slot: string;
  player: HubPlayer | null;
  week: number;
  injury: WireInjury | null;
  projection: number | null;
  moving: boolean;
  target: boolean;
  selected: boolean;
  busy: boolean;
  onPickUp: () => void;
  onDrop: () => void;
}) {
  const locked = player?.locked ?? false;
  const form = player?.form ?? null;
  const use = player ? usageLine(player) : null;

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
        <PlayerBadge
          id={player.player_id}
          name={player.full_name}
          position={player.position}
          team={player.nfl_team}
          espnId={player.espn_id}
          size={38}
          sub={
            <>
              <span>{player.position} · {player.nfl_team ?? "FA"}</span>
              {player.depth.rank && player.depth.of ? (
                <span style={{ color: "var(--faint)" }}>
                  {player.position}{player.depth.rank} of {player.depth.of}
                </span>
              ) : null}
              {locked && <Lock size={11} color="var(--faint)" aria-label="Locked" />}
              {player.on_bye && <Plane size={11} color="var(--warn)" aria-label="On bye" />}
              {injury && <InjuryBadge injury={injury} />}
            </>
          }
        />
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

      <span className="plr__use">
        {projection != null && (
          <span style={{ display: "block", color: "var(--gold)", fontWeight: 600 }}>
            {projection.toFixed(1)} projected
          </span>
        )}
        {use}
      </span>

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
