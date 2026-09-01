"use client";

import { useMemo } from "react";
import { buildInsights, myNews } from "@/lib/nfl/insights";
import { injuriesByPlayer } from "@/lib/nfl/wire";
import type { HubPlayer, TeamHub, Wire } from "@/lib/nfl/types";
import { Seal, useCountUp } from "@/components/ui";
import { PlayerRow } from "@/components/team/Lineup";
import { InsightBoard, NewsWire, TeamStats } from "@/components/team/Rail";

const FLEX_OK = new Set(["RB", "WR", "TE"]);

export const slotOk = (slot: string, pos: string) =>
  slot === "BN" ? true : slot === "FLEX" ? FLEX_OK.has(pos) : slot === pos;

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
 */
export function TeamDesk({
  hub, wire, moving, busy, onPickUp, onCancelMove, onDrop, onWeek,
}: {
  hub: TeamHub;
  wire: Wire | null;
  moving: HubPlayer | null;
  busy: boolean;
  onPickUp: (p: HubPlayer) => void;
  onCancelMove: () => void;
  onDrop: (target: MoveTarget) => void;
  onWeek: (week: number) => void;
}) {
  const roster = hub.roster;
  const injuries = useMemo(() => injuriesByPlayer(wire), [wire]);

  const insights = useMemo(
    () => buildInsights(roster, wire?.injuries ?? [], hub.week),
    [roster, wire, hub.week],
  );

  const tagged = useMemo(() => myNews(roster, wire?.articles ?? []), [roster, wire]);

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
              <Seal name={hub.team.name} mine size={46} />
              <div style={{ minWidth: 0 }}>
                <h1>{hub.team.name}</h1>
                <div className="th-side__meta">
                  {rec && (
                    <span className="badge" data-tone="wine">
                      {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
                    </span>
                  )}
                  {rec && <span className="eyebrow">{ordinal(rec.rank)} of {rec.teams}</span>}
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
              <Seal name={hub.matchup?.opponent.name ?? "—"} size={46} />
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
                <span className="eyebrow">
                  <span className="num">{Number(hub.splits.starter_points).toFixed(1)}</span> points
                </span>
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

    </>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
