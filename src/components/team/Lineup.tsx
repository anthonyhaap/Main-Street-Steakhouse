"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Lock, Plane, X } from "lucide-react";
import { InjuryBadge, Kickoff, Spark, kickoffLine, usageLine } from "@/components/nfl";
import { PlayerBadge } from "@/components/PlayerBadge";
import { fmtPts } from "@/components/ui";
import { inProgress } from "@/components/team/MobileDesk";
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
                  className="plr__rank"
                  style={{ color: "var(--faint)" }}
                  title={`${ordinal(player.pos_rank.rank)} of ${player.pos_rank.of} at ${player.position} in fantasy points this season`}
                >
                  {player.position}{player.pos_rank.rank} of {player.pos_rank.of}
                </span>
              ) : null}
              {/* The kickoff column is only drawn once the row is wide
                  enough for it; on a phone the game time rides here. */}
              <span className="plr__when" data-live={inProgress(player) || undefined}>
                {kickoffLine(player.game)}
              </span>
              {locked && <Lock size={11} color="var(--faint)" aria-label="Locked" />}
              {player.on_bye && <Plane size={11} color="var(--warn)" aria-label="On bye" />}
              {injury && <span className="plr__inj-full"><InjuryBadge injury={injury} /></span>}
              {injury && (
                <span className="plr__inj" data-sev={injury.severity} title={`${injury.status}${injury.detail ? ` · ${injury.detail}` : ""}`}>
                  {injuryTag(injury.status)}
                </span>
              )}
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
          // A locked row still opens: the sheet says why nothing can move,
          // which a greyed button never could.
          disabled={!player || busy}
          data-on={selected}
          data-locked={locked || undefined}
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

/** ESPN's word, shortened to what fits beside a name: "Q", "O", "IR". */
export function injuryTag(status: string): string {
  const s = status.trim().toLowerCase();
  if (s.startsWith("injured reserve") || s === "ir") return "IR";
  if (s.startsWith("physically unable") || s === "pup") return "PUP";
  if (s.startsWith("susp")) return "SUS";
  if (s.startsWith("day")) return "DTD";
  return status.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Whether the phone layout is on. Read through `useSyncExternalStore` so the
 * server snapshot (false) and the first client render agree, and the swap
 * opens in the right place from the first tap after hydration.
 */
const NARROW = "(max-width: 759px)";
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/**
 * The list that drops open under a row when its Swap button is pressed.
 *
 * Each line is one button — one tap makes the swap — and says who comes in,
 * where from, and what he is projected for, which is the number the choice is
 * usually about. Locked players are listed but cannot be picked, so the
 * manager can see why the obvious answer is missing rather than wonder.
 *
 * A player who is himself locked opens too, and says so: his game has
 * started, and that is the whole answer — better said than implied by a
 * button that does nothing.
 */
export function SwapOptions({
  player, options, busy, onPick, onCancel, bare = false,
}: {
  player: HubPlayer;
  options: SwapOption[];
  busy: boolean;
  onPick: (option: SwapOption) => void;
  onCancel: () => void;
  /** Drawn inside the swap sheet, which has its own head. */
  bare?: boolean;
}) {
  const open = options.filter((o) => !o.player?.locked).length;
  return (
    <div className="swap" data-bare={bare || undefined} role="region" aria-label={`Swap options for ${player.full_name}`}>
      {!bare && (
        <div className="swap__head">
          <span>Swap <strong>{player.full_name}</strong> with…</span>
          <button type="button" className="btn" data-v="ghost" data-size="sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      {player.locked ? (
        <div className="swap__none" data-kind="locked">
          <Lock size={13} aria-hidden />
          <span>
            {player.full_name}&apos;s game has started, so he stays
            {player.slot === "BN" ? " on the bench" : ` at ${player.slot}`} until the week is over.
            Each player locks at his own kickoff — anyone whose game hasn&apos;t started can still move.
          </span>
        </div>
      ) : options.length === 0 ? (
        <div className="swap__none">Nobody on this roster can take his place.</div>
      ) : (
        <>
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
                            {o.player.position} · {o.player.nfl_team ?? "FA"} · {kickoffLine(o.player.game)}
                            {locked && " · locked, game started"}
                          </span>
                        </>
                      ) : o.slot === "BN" ? (
                        <b>Move to bench</b>
                      ) : (
                        <b style={{ fontStyle: "italic" }}>Empty slot</b>
                      )}
                    </span>
                    <span className="swap__proj">
                      {o.player ? (
                        <>
                          <b className="num">{fmtPts(o.player.points)}</b>
                          {o.player.projection != null && <span>{o.player.projection.toFixed(1)} proj</span>}
                        </>
                      ) : ""}
                    </span>
                    {locked && <Lock size={11} color="var(--faint)" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="swap__rule">
            {open === 0
              ? "Everyone who could take his place is locked — their games have started."
              : `Only players eligible for ${player.slot === "BN" ? "an open lineup slot" : player.slot} are listed.`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The same options as a bottom sheet, for a phone.
 *
 * Opening a list under the row worked on a wide screen, where the row and its
 * options are both in view. On a phone the list pushed the rest of the lineup
 * off the bottom and the manager scrolled to find his own choice. The sheet
 * rises over the tab bar instead, with the player being moved at its head, and
 * one tap on a name makes the move and closes it.
 */
export function SwapSheet({
  player, options, busy, onPick, onCancel,
}: {
  player: HubPlayer;
  options: SwapOption[];
  busy: boolean;
  onPick: (option: SwapOption) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    // The page behind a sheet should not scroll under the thumb.
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = was;
    };
  }, [onCancel]);

  return createPortal(
    <div className="modal" data-sheet="true" role="dialog" aria-modal aria-label={`Swap ${player.full_name}`} onClick={onCancel}>
      <section className="modal__panel swap-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="swap-sheet__grip" aria-hidden />
        <div className="swap-sheet__head">
          <span className="pos" data-p={player.slot}>{player.slot}</span>
          <span className="swap__who">
            <b>{player.full_name}</b>
            <span>{player.position} · {player.nfl_team ?? "FA"} · {kickoffLine(player.game)}</span>
          </span>
          <span className="swap__proj">
            <b className="num">{fmtPts(player.points)}</b>
            {player.projection != null && <span>{player.projection.toFixed(1)} proj</span>}
          </span>
          <button type="button" className="btn" data-v="ghost" data-size="icon" aria-label="Close" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <span className="eyebrow swap-sheet__label">{player.locked ? "Locked" : "Swap with"}</span>
        <SwapOptions player={player} options={options} busy={busy} onPick={onPick} onCancel={onCancel} bare />
      </section>
    </div>,
    document.body,
  );
}
