"use client";

import { useMemo, useState } from "react";
import { Pencil, Wand2 } from "lucide-react";
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
 */
export function TeamDesk({
  hub, wire, moving, busy, crest = null, oppCrest = null, weather = null, matchups = null,
  onPickUp, onCancelMove, onDrop, onWeek, onEdit, onSetLineup,
}: {
  hub: TeamHub;
  wire: Wire | null;
  moving: HubPlayer | null;
  busy: boolean;
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
  /** Absent on the fixture, where there is no team to edit. */
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
                  {onEdit && (
                    <button className="btn" data-v="ghost" data-size="sm" onClick={onEdit}>
                      <Pencil size={13} /> Edit team
                    </button>
                  )}
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
                <h1>{hub.matchup?.opponent.name ?? "No opponent"}</h1>
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
                    onPickUp={() => onPickUp(p)}
                    onDrop={() => onDrop({ slot: "BN", player: null })}
                  />
                ))}
              </div>
            </section>
          </div>

          <div className="th-col">
            <InsightBoard insights={insights} wire={wire} />
            <TeamStats hub={hub} />
            <NewsWire mine={tagged} all={wire?.articles ?? []} wire={wire} />
          </div>
        </div>
      </main>

      {coaching && (
        <Coach
          plan={plan}
          week={hub.week}
          busy={busy}
          weather={weather}
          onClose={() => setCoaching(false)}
          onApply={onSetLineup && (async () => {
            const assignments: Record<string, string> = {};
            for (const m of plan.moves) assignments[m.player.player_id] = m.to;
            await onSetLineup(assignments);
            setCoaching(false);
          })}
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
