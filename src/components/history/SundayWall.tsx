"use client";

/**
 * Steakhouse Sunday on the wall: the moments the league will bring up in
 * five years, the Sunday records, and each manager's Sunday line.
 *
 * All of it from `ff_sunday_history`, which reads the events the game center
 * already persisted — nothing here is kept twice. A moment from this season
 * opens its Sunday; an older one is a line on the wall.
 */

import { Flame, Sparkles, Trophy } from "lucide-react";
import type { SundayHistory } from "@/lib/sunday";

const when = (season: number, week: number) => `${season} · week ${week}`;

export function SundayWall({ sunday, season }: { sunday: SundayHistory; season: number }) {
  const { moments, records, managers } = sunday;
  const hasRecords = !!(records.comeback || records.lead_changes || records.closest || records.play);
  if (moments.length === 0 && !hasRecords) return null;
  const sorted = [...managers]
    .filter((m) => m.moments + m.comebacks + m.lead_changes + m.touchdowns + m.reactions > 0)
    .sort((a, b) => b.moments - a.moments || b.reactions - a.reactions || a.who.localeCompare(b.who));

  return (
    <section className="sunday-wall" aria-label="Sunday at the Steakhouse">
      <h2 className="eyebrow sunday-wall__head">
        <span>🥩 Sunday at the Steakhouse</span>
        <span>{sunday.weeks} Sunday{sunday.weeks === 1 ? "" : "s"} on record</span>
      </h2>
      <div className="grid-auto">
        {moments.length > 0 && (
          <section className="card">
            <div className="card__head"><h2>Memorable moments</h2><Sparkles size={16} color="var(--gold)" /></div>
            <div className="ledger">
              {moments.map((m, i) => {
                const body = (
                  <span>
                    <b>{m.headline}</b>
                    <i>{when(m.season, m.week)}{m.description ? ` · ${m.description}` : ""}</i>
                  </span>
                );
                return (
                  <div className="ledger__row" key={m.id}>
                    <span className="num">{i + 1}</span>
                    {m.season === season ? <a href={`/sunday?week=${m.week}`} className="ledger__link">{body}</a> : body}
                    <span className="num" data-tone="gold" title="Reactions">{m.reactions > 0 ? `${m.reactions} 🔥` : "🚨"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {hasRecords && (
          <section className="card">
            <div className="card__head"><h2>Sunday records</h2><Trophy size={16} color="var(--gold)" /></div>
            <div className="ledger">
              {records.comeback && (
                <div className="ledger__row">
                  <span className="num">🚨</span>
                  <span><b>Biggest comeback: {records.comeback.who} over {records.comeback.opp}</b><i>{when(records.comeback.season, records.comeback.week)}</i></span>
                  <span className="num" data-tone="gold">{Number(records.comeback.down).toFixed(1)} down</span>
                </div>
              )}
              {records.lead_changes && (
                <div className="ledger__row">
                  <span className="num">🔁</span>
                  <span><b>Most lead changes: {records.lead_changes.away} v {records.lead_changes.home}</b><i>{when(records.lead_changes.season, records.lead_changes.week)}</i></span>
                  <span className="num" data-tone="gold">{records.lead_changes.n}</span>
                </div>
              )}
              {records.closest && (
                <div className="ledger__row">
                  <span className="num">😬</span>
                  <span><b>Closest finish: {records.closest.who} over {records.closest.opp}</b><i>{when(records.closest.season, records.closest.week)}</i></span>
                  <span className="num" data-tone="gold">{Number(records.closest.margin).toFixed(2)}</span>
                </div>
              )}
              {records.play && (
                <div className="ledger__row">
                  <span className="num">💥</span>
                  <span><b>Biggest single play: {records.play.headline}</b><i>{when(records.play.season, records.play.week)}{records.play.who ? ` · for ${records.play.who}` : ""}</i></span>
                  <span className="num" data-tone="gold">+{Number(records.play.points).toFixed(1)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {sorted.length > 0 && (
          <section className="card">
            <div className="card__head"><h2>Sunday lines</h2><Flame size={16} color="var(--gold)" /></div>
            <div className="table-scroll scroll">
              <table className="sunday-lines">
                <thead>
                  <tr><th>Manager</th><th title="Steakhouse moments">🚨</th><th title="Comebacks">Back</th><th title="Lead changes taken">Leads</th><th title="Touchdowns">TD</th><th title="Reactions drawn">🔥</th></tr>
                </thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr key={m.team_id}>
                      <th scope="row">{m.who}</th>
                      <td>{m.moments}</td><td>{m.comebacks}</td><td>{m.lead_changes}</td><td>{m.touchdowns}</td><td>{m.reactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
