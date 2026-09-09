"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, Pencil, Wand2 } from "lucide-react";
import { buildInsights, myNews } from "@/lib/nfl/insights";
import { injuriesByPlayer } from "@/lib/nfl/wire";
import { buildLineup, slotOk } from "@/lib/nfl/lineup";
import type { MatchupCurve } from "@/lib/nfl/matchup";
import type { GameWeather } from "@/lib/nfl/venues";
import type { HubPlayer, TeamHub, Wire } from "@/lib/nfl/types";
import { Seal, useCountUp } from "@/components/ui";
import { PlayerRow } from "@/components/team/Lineup";
import { Coach } from "@/components/team/Coach";
import { InsightBoard, NewsWire, TeamStats } from "@/components/team/Rail";
import { Notifications } from "@/components/team/Notifications";

export { slotOk };

export type MoveTarget = { slot: string; player: HubPlayer | null };

/**
 * The manager's desk: everything /team draws, given a hub payload and a wire.
 *
 * It owns no data of its own — the live page hands it Supabase state and the
 * fixture harness at /preview/team hands it a canned week — which is the point:
 * the layout can be looked at, and looked at on a wide screen, without a
 * session, a draft or a live Sunday.
 *
 * Opening a player is a link, not state: /player/[id] is a location you can
 * share and come back from. Moving a player is not — that goes back out to
 * whoever owns the roster.
 *
 * The crests come in as URLs rather than being looked up here, for the same
 * reason: the fixture has no session to look them up in.
 *
 * `readOnly` is the same desk drawn for a visitor — any manager in the league
 * can open any other manager's team. Everything that *reads* stays: the
 * lineup, the form, the wire against that roster, even the coach's opinion of
 * it. Everything that *writes* goes: no move buttons, no edit, no "set this
 * lineup", and no notification settings, which are per person rather than per
 * team. The database already lets any member read any team's hub, so this is
 * a matter of what the page offers, not what it is allowed.
 */
export function TeamDesk({
  hub, wire, moving, busy, crest = null, oppCrest = null, weather = null, matchups = null,
  readOnly = false, picker = null,
  onPickUp, onCancelMove, onDrop, onWeek, onEdit, onSetLineup,
}: {
  hub: TeamHub;
  wire: Wire | null;
  moving: HubPlayer | null;
  busy: boolean;
  /** True when this is another manager's team: draw it, but offer no writes. */
  readOnly?: boolean;
  /**
   * A control for choosing whose desk to look at, drawn in the hero next to
   * the team's record. The live page supplies a select over the league; the
   * fixture has no league and leaves it out.
   */
  picker?: ReactNode;
  /** This team's crest, from `crestUrl()`. Null falls back to the monogram. */
  crest?: string | null;
  oppCrest?: string | null;
  /** The forecast over each stadium this roster plays in, from `useWeather`. */
  weather?: Map<string, GameWeather> | null;
  /** Each man's week against his own projection curve, from `useMatchups`. */
  matchups?: MatchupCurve | null;
  onPickUp: (p: HubPlayer) => void;
  onCancelMove: () => void;
  onDrop: (target: MoveTarget) => void;
  onWeek: (week: number) => void;
  /** Absent on the fixture, where there is no team to edit, and on a desk
   *  that is not the reader's own. */
  onEdit?: () => void;
  /**
   * Apply a whole lineup at once — `{ player_id: slot }`, exactly what
   * `ff_set_lineup` takes. Absent on the fixture, where the coach can be read
   * but there is nothing to write to.
   */
  onSetLineup?: (assignments: Record<string, string>) => void | Promise<void>;
}) {
  const roster = hub.roster;
  const injuries = useMemo(() => injuriesByPlayer(wire), [wire]);
  const [coaching, setCoaching] = useState(false);

  const insights = useMemo(
    () => buildInsights(roster, wire?.injuries ?? [], hub.week),
    [roster, wire, hub.week],
  );

  const tagged = useMemo(() => myNews(roster, wire?.articles ?? []), [roster, wire]);

  // Priced on every render of the desk rather than on the click, so the button
  // can say what it is worth before anybody opens it. It is arithmetic over
  // fifteen players — cheaper than the sparklines beneath it.
  const plan = useMemo(
    () => buildLineup({
      roster,
      slots: hub.league.roster_slots,
      week: hub.week,
      injuries,
      hasWire: wire !== null,
      weather,
      matchups,
      insights,
    }),
    [roster, hub.league.roster_slots, hub.week, injuries, wire, weather, matchups, insights],
  );

  const starters = useMemo(() => {
    const slots = hub.league.roster_slots.filter((s) => s !== "BN");
    const pool = roster.filter((p) => p.slot !== "BN");
    const used = new Set<string>();
    return slots.map((slot, i) => {
      const hit = pool.find((p) => p.slot === slot && !used.has(p.player_id));
      if (hit) used.add(hit.player_id);
      return { key: `${slot}-${i}`, slot, player: hit ?? null };
    });
  }, [hub.league.roster_slots, roster]);

  const bench = roster.filter((p) => p.slot === "BN");
  const empties = starters.filter((s) => !s.player).length;

  const mine = Number(hub.matchup?.my_points ?? hub.splits.starter_points ?? 0);
  const theirs = Number(hub.matchup?.opp_points ?? 0);
  const shownMine = useCountUp(mine);
  const shownTheirs = useCountUp(theirs);

  const rec = hub.record;
  const projected = Number(hub.splits.projected_starters ?? 0);

  return (
    <>
      <main className="page">
        {/* --------------------------------------------------------- hero -- */}
        <section className="th-hero">
          <div className="th-hero__top">
            <div className="th-side">
              <Seal name={hub.team.name} src={crest} mine size={46} />
              <div style={{ minWidth: 0 }}>
                <h1>{hub.team.name}</h1>
                <div className="th-side__meta">
                  {rec && (
                    <span className="badge" data-tone="wine">
                      {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
                    </span>
                  )}
                  {rec && <span className="eyebrow">{ordinal(rec.rank)} of {rec.teams}</span>}
                  {readOnly && (
                    <span className="badge" data-tone="neutral" title="Another manager's team — read only">
                      <Eye size={11} /> Viewing
                    </span>
                  )}
                  {onEdit && !readOnly && (
                    <button className="btn" data-v="ghost" data-size="sm" onClick={onEdit}>
                      <Pencil size={13} /> Edit team
                    </button>
                  )}
                  {picker}
                </div>
              </div>
            </div>

            <div className="th-vs">
              <span className="th-vs__pts num" data-lead={mine >= theirs}>{shownMine.toFixed(1)}</span>
              <span className="th-vs__sep">
                Week {hub.week}{hub.matchup ? (hub.matchup.home ? " · Home" : " · Away") : ""}
              </span>
              <span className="th-vs__pts num" data-lead={theirs > mine}>
                {hub.matchup ? shownTheirs.toFixed(1) : "—"}
              </span>
            </div>

            <div className="th-side" data-align="end">
              <div style={{ minWidth: 0 }}>
                {/* The opponent is a door, not a label: their desk is one tap
                    away, the same way this one was from the standings. */}
                <h1>
                  {hub.matchup
                    ? <Link className="tlink" href={`/team?id=${hub.matchup.opponent.id}`}>{hub.matchup.opponent.name}</Link>
                    : "No opponent"}
                </h1>
                <div className="th-side__meta">
                  {hub.matchup?.opponent.record && (
                    <span className="badge" data-tone="neutral">
                      {hub.matchup.opponent.record.wins}–{hub.matchup.opponent.record.losses}
                      {hub.matchup.opponent.record.ties ? `–${hub.matchup.opponent.record.ties}` : ""}
                    </span>
                  )}
                  <span className="eyebrow">This week&apos;s opponent</span>
                </div>
              </div>
              <Seal name={hub.matchup?.opponent.name ?? "—"} src={oppCrest} size={46} />
            </div>
          </div>

          <div className="th-strip">
            <div className="th-stat">
              <b>{Number(hub.splits.starter_points).toFixed(1)}</b>
              <span>Starters this week</span>
            </div>
            <div className="th-stat">
              <b data-tone="gold">{projected > 0 ? projected.toFixed(1) : "—"}</b>
              <span>Projected</span>
            </div>
            <div className="th-stat">
              <b data-tone={empties ? "warn" : "ok"}>{starters.length - empties}/{starters.length}</b>
              <span>Slots filled</span>
            </div>
            <div className="th-stat">
              <b>{Number(rec?.points_for ?? 0).toFixed(0)}</b>
              <span>Points for</span>
            </div>
            <div className="th-stat">
              <b>{Number(rec?.points_against ?? 0).toFixed(0)}</b>
              <span>Points against</span>
            </div>
            <div className="th-stat">
              <b data-tone={insights.some((i) => i.kind === "alert") ? "warn" : "gold"}>{insights.length}</b>
              <span>Wire notes on your roster</span>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- week picker -- */}
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <button key={w} className="segmented__opt num" data-on={w === hub.week}
                onClick={() => onWeek(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* --------------------------------------------------------- grid -- */}
        <div className="th-grid">
          <div className="th-col">
            <section className="card lineup" data-accent="gold">
              <div className="card__head">
                <h2>Starting lineup</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="eyebrow">
                    <span className="num">{Number(hub.splits.starter_points).toFixed(1)}</span> points
                  </span>
                  {/* The gain is on the button rather than behind it: a manager
                      who is already right should be able to see that without
                      opening anything. */}
                  <button className="btn" data-v={plan.gain > 0.05 ? "gold" : undefined} data-size="sm"
                    onClick={() => setCoaching(true)} disabled={busy}>
                    <Wand2 size={13} />
                    Best lineup
                    {plan.gain > 0.05 && <span className="num">+{plan.gain.toFixed(1)}</span>}
                  </button>
                </div>
              </div>

              {empties > 0 && (
                <div className="note" data-kind="error">
                  {empties} starting {empties === 1 ? "slot is" : "slots are"} empty — those score zero.
                </div>
              )}
              {moving && (
                <div className="note" data-kind="info" style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  gap: 10, flexWrap: "wrap",
                }}>
                  <span>Moving <strong>{moving.full_name}</strong> — pick a highlighted row.</span>
                  <button className="btn" data-v="ghost" data-size="sm" onClick={onCancelMove}>Cancel</button>
                </div>
              )}

              <div>
                {starters.map((s) => (
                  <PlayerRow
                    key={s.key}
                    slot={s.slot}
                    player={s.player}
                    week={hub.week}
                    injury={injuries.get(s.player?.player_id ?? "") ?? null}
                    projection={s.player?.projection ?? null}
                    moving={!!moving}
                    target={!!moving && slotOk(s.slot, moving.position)}
                    selected={!!moving && moving.player_id === s.player?.player_id}
                    busy={busy}
                    canMove={!readOnly}
                    onPickUp={() => s.player && onPickUp(s.player)}
                    onDrop={() => onDrop({ slot: s.slot, player: s.player })}
                  />
                ))}
              </div>
            </section>

            <section className="card lineup">
              <div className="card__head">
                <h2>Bench</h2>
                <span className="eyebrow">
                  <span className="num">{Number(hub.splits.bench_points).toFixed(1)}</span> points ·{" "}
                  <span className="num">{bench.length}</span> players
                </span>
              </div>
              <div>
                {bench.length === 0 && <div className="empty">Bench is empty.</div>}
                {bench.map((p) => (
                  <PlayerRow
                    key={p.player_id}
                    slot="BN"
                    player={p}
                    week={hub.week}
                    injury={injuries.get(p.player_id) ?? null}
                    projection={p.projection}
                    moving={!!moving}
                    target={!!moving && moving.slot !== "BN"}
                    selected={moving?.player_id === p.player_id}
                    busy={busy}
                    canMove={!readOnly}
                    onPickUp={() => onPickUp(p)}
                    onDrop={() => onDrop({ slot: "BN", player: null })}
                  />
                ))}
              </div>
            </section>
          </div>

          <div className="th-col">
            <InsightBoard insights={insights} wire={wire} whose={readOnly ? hub.team.name : null} />
            <TeamStats hub={hub} />
            <NewsWire mine={tagged} all={wire?.articles ?? []} wire={wire} own={!readOnly} />
            {/* Per-manager and per-device, so it belongs on his own screen
                rather than in the commissioner's league settings — and not on
                anybody else's desk. */}
            {!readOnly && <Notifications />}
          </div>
        </div>
      </main>

      {coaching && (
        <Coach
          plan={plan}
          week={hub.week}
          busy={busy}
          weather={weather}
          own={!readOnly}
          onClose={() => setCoaching(false)}
          onApply={onSetLineup && !readOnly ? (async () => {
            const assignments: Record<string, string> = {};
            for (const m of plan.moves) assignments[m.player.player_id] = m.to;
            await onSetLineup(assignments);
            setCoaching(false);
          }) : undefined}
        />
      )}
    </>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
