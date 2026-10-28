"use client";

import { ArrowLeftRight, Lock, Plane } from "lucide-react";
import { InjuryBadge, Kickoff, Spark, kickoffLine, usageLine } from "@/components/nfl";
import { PlayerBadge } from "@/components/PlayerBadge";
import { fmtPts } from "@/components/ui";
import type { HubPlayer, WireInjury } from "@/lib/nfl/types";
import { ordinal } from "@/lib/power";

/**
 * One roster line.
 *
 * The old row was a single button: clicking anywhere started a lineup move.
 * That worked when a row held a name and a number, but not when the row is also
 * worth *reading* — you cannot open a player to see whether he is a start
 * without accidentally benching him. So the two intents are two targets: the
 * badge opens his page, the Swap button picks him up.
 *
 * Picking him up opens a `SwapOptions` list directly under his row: every
 * player (or empty slot) he could legally trade places with, so the choice is
 * made right where the question was asked instead of by hunting for
 * highlighted rows up and down the page. Pressing Swap again puts him down.
 *
 * On somebody else's desk there is no second intent: the button is not drawn
 * at all, rather than drawn disabled, because a greyed button on every row of
 * a roster you cannot touch reads as a bug rather than a rule.
 */
export function PlayerRow({
  slot, player, week, injury, projection, selected, busy, canMove = true, onPickUp,
}: {
  slot: string;
  player: HubPlayer | null;
  week: number;
  injury: WireInjury | null;
  projection: number | null;
  /** True while this row's swap options are open beneath it. */
  selected: boolean;
  busy: boolean;
  /** False on a roster the viewer does not own — the swap button is not drawn. */
  canMove?: boolean;
  /** Opens this row's swap options, or closes them if they are already open. */
  onPickUp: () => void;
}) {
  const locked = player?.locked ?? false;
  const form = player?.form ?? null;
  const use = player ? usageLine(player) : null;

  return (
    <div
      className="plr"
      data-selected={selected}
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
              {player.pos_rank ? (
                <span
                  style={{ color: "var(--faint)" }}
                  title={`${ordinal(player.pos_rank.rank)} of ${player.pos_rank.of} at ${player.position} in fantasy points this season`}
                >
                  {player.position}{player.pos_rank.rank} of {player.pos_rank.of}
                </span>
              ) : null}
              {/* The kickoff column is only drawn once the row is wide
                  enough for it; on a phone the game time rides here. */}
              <span className="plr__when">{kickoffLine(player.game)}</span>
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

      {/* Usage prose only. The projection used to live here, and went with it
          whenever the container was too narrow for this column — which is most
          of the desktop range, because the rail takes width from the lineup the
          moment the desk goes two-column. A number that small belongs next to
          the points it is predicting, in a column that never drops. */}
      <span className="plr__use">{use}</span>

      <span className="plr__pts">
        {player ? fmtPts(player.points) : "—"}
        {projection != null && (
          <span className="plr__proj">{projection.toFixed(1)} proj</span>
        )}
      </span>

      {canMove ? (
        <button
          type="button"
          className="plr__act"
          onClick={onPickUp}
          disabled={!player || locked || busy}
          data-on={selected}
          aria-expanded={selected}
          title={locked ? "Locked — his game has started" : selected ? "Close swap options" : "Swap with another player"}
          aria-label={player ? `Swap ${player.full_name}` : "Empty slot"}
        >
          <ArrowLeftRight size={12} />
          <span className="plr__act-label">Swap</span>
        </button>
      ) : (
        <span aria-hidden />
      )}
    </div>
  );
}

/** One place the picked-up player could go, and who (if anyone) is there now. */
export type SwapOption = {
  key: string;
  /** The slot the option sits in today — where the picked-up player would land. */
  slot: string;
  /** Whoever is in that slot now. Null for an empty slot or "send to bench". */
  player: HubPlayer | null;
};

/**
 * The list that drops open under a row when its Swap button is pressed.
 *
 * Each line is one button — one tap makes the swap — and says who comes in,
 * where from, and what he is projected for, which is the number the choice is
 * usually about. Locked players are listed but cannot be picked, so the
 * manager can see why the obvious answer is missing rather than wonder.
 */
export function SwapOptions({
  player, options, busy, onPick, onCancel,
}: {
  player: HubPlayer;
  options: SwapOption[];
  busy: boolean;
  onPick: (option: SwapOption) => void;
  onCancel: () => void;
}) {
  return (
    <div className="swap" role="region" aria-label={`Swap options for ${player.full_name}`}>
      <div className="swap__head">
        <span>Swap <strong>{player.full_name}</strong> with…</span>
        <button type="button" className="btn" data-v="ghost" data-size="sm" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {options.length === 0 ? (
        <div className="swap__none">Nobody on this roster can take his place.</div>
      ) : (
        <ul className="swap__list">
          {options.map((o) => {
            const locked = o.player?.locked ?? false;
            return (
              <li key={o.key}>
                <button
                  type="button"
                  className="swap__opt"
                  onClick={() => onPick(o)}
                  disabled={busy || locked}
                  title={locked ? "Locked — his game has started" : undefined}
                >
                  <span className="pos" data-p={o.slot}>{o.slot}</span>
                  <span className="swap__who">
                    {o.player ? (
                      <>
                        <b>{o.player.full_name}</b>
                        <span>
                          {o.player.position} · {o.player.nfl_team ?? "FA"}
                          {o.player.on_bye && " · bye"}
                          {locked && " · locked"}
                        </span>
                      </>
                    ) : o.slot === "BN" ? (
                      <b>Move to bench</b>
                    ) : (
                      <b style={{ fontStyle: "italic" }}>Empty slot</b>
                    )}
                  </span>
                  <span className="swap__proj">
                    {o.player?.projection != null ? `${o.player.projection.toFixed(1)} proj` : ""}
                  </span>
                  {locked && <Lock size={11} color="var(--faint)" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
