"use client";

import { Flame, Landmark, Swords, Trophy, Zap } from "lucide-react";
import { Seal, SkeletonRows } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import { cellOf, heat, titleOf, type History } from "@/lib/history";

/**
 * The room with "Est. 2016" on the door.
 *
 * A plaque of champions, a head-to-head grid painted as a heat map (the one
 * that stops people: "wait, I'm 2–11 against Mike?"), the rivalries the
 * numbers found on their own, the longest runs and the worst beatings, and
 * a card for every manager with a title the record earned. This is the page
 * that gets screenshotted into the group chat, so it is built to be.
 */
export function HistoryWall({ history, myManager = null, importable = false }: {
  history: History | null;
  /** The viewer's manager name, to pick their card and row out. */
  myManager?: string | null;
  /** Show the commissioner where the old seasons go. */
  importable?: boolean;
}) {
  if (!history) {
    return (
      <main className="page wall" data-width="mid">
        <section className="plaque ink"><div className="plaque__head"><span className="eyebrow">Main Street Steakhouse · Est. 2016</span><h1>The Wall</h1></div></section>
        <div className="card"><SkeletonRows n={8} /></div>
      </main>
    );
  }

  const h = history;
  const managers = h.managers;
  const names = managers.map((m) => m.manager);
  const est = h.league.est;
  const seasons = h.seasons.filter((s) => s.champion || s.in_progress);

  return (
    <main className="page wall" data-width="mid">
      {/* ================================================== the plaque == */}
      <section className="plaque ink">
        <div className="plaque__head">
          <span className="eyebrow">Main Street Steakhouse · Est. {est}</span>
          <h1>Champions</h1>
          <span className="eyebrow" style={{ color: "#b6a992" }}>
            {h.games.toLocaleString()} games on record · {h.seasons.length} season{h.seasons.length === 1 ? "" : "s"}
          </span>
        </div>
        <i className="hairline plaque__rule" />
        {seasons.length === 0 ? (
          <p style={{ margin: 0, textAlign: "center", font: "400 1.05rem/1.6 var(--serif)", color: "#d9cdb5", maxWidth: "46ch", marginInline: "auto" }}>
            Nothing on the wall yet. The first plaque goes up the night the {h.league.season} final is played
            {importable ? " — or the moment the old seasons are imported from the commissioner’s desk." : "."}
          </p>
        ) : (
          <div className="plaque__years">
            {seasons.map((s) => (
              <div className="plaque__year" key={s.season} data-now={s.in_progress}>
                <em>{s.season}</em>
                <b>{s.champion ?? (s.best_record ? `${s.best_record.manager} leads` : "In play")}</b>
                <span>
                  {s.champion
                    ? `over ${s.runner_up}${s.final_score ? ` · ${Number(s.final_score.w).toFixed(1)}–${Number(s.final_score.l).toFixed(1)}` : ""}`
                    : s.best_record ? `${s.best_record.wins}–${s.best_record.losses} so far` : "season in progress"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ================================================ the rivalries == */}
      {h.rivalries.length > 0 && (
        <section className="card">
          <div className="card__head">
            <div>
              <h2>Rivalries</h2>
              <div className="eyebrow" style={{ marginTop: 5 }}>Found by the numbers, not declared</div>
            </div>
            <Swords size={17} color="var(--gold)" />
          </div>
          <div>
            {h.rivalries.map((r) => {
              const total = r.a_wins + r.b_wins || 1;
              return (
                <div className="rival" key={`${r.a}|${r.b}`}>
                  <div className="rival__names"><span>{r.a}</span><i>vs</i><span>{r.b}</span></div>
                  <div className="rival__bar" title={`${r.a} ${r.a_wins} · ${r.b} ${r.b_wins}`}>
                    <i style={{ width: `${(r.a_wins / total) * 100}%` }} />
                    <i style={{ width: `${(r.b_wins / total) * 100}%` }} />
                  </div>
                  <div className="rival__meta">
                    <span className="num">{r.a_wins}–{r.b_wins} in {r.games} meetings</span>
                    <span>{r.playoff > 0 ? `${r.playoff} in the playoffs · ` : ""}avg. margin {Number(r.avg_margin).toFixed(1)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===================================================== the grid == */}
      {names.length > 1 && (
        <section className="card">
          <div className="card__head">
            <div>
              <h2>Head to head, all time</h2>
              <div className="eyebrow" style={{ marginTop: 5 }}>Read across: the row&apos;s record against the column</div>
            </div>
            <Landmark size={17} color="var(--gold)" />
          </div>
          <div className="h2h scroll" style={{ padding: "var(--s3) var(--s4)" }}>
            <table>
              <thead>
                <tr>
                  <th />
                  {names.map((n) => <th key={n} scope="col"><span>{n}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {names.map((row) => (
                  <tr key={row}>
                    <th scope="row" style={{ color: row === myManager ? "var(--wine)" : undefined }}>{row}</th>
                    {names.map((col) => {
                      if (row === col) return <td key={col}><span className="h2h__cell" data-self="true" /></td>;
                      const c = cellOf(h.grid, row, col);
                      const w = c?.wins ?? 0, l = c?.losses ?? 0;
                      const empty = !c || w + l + (c.ties ?? 0) === 0;
                      return (
                        <td key={col}>
                          <span
                            className="h2h__cell"
                            data-empty={empty}
                            title={`${row} vs ${col}: ${w}–${l}${c?.ties ? `–${c.ties}` : ""}`}
                            style={{ background: empty ? undefined : heat(w, l) }}
                          >
                            {empty ? "·" : `${w}–${l}`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h2h__legend eyebrow">
            <span><i className="h2h__swatch" style={{ background: heat(0, 6) }} />He owns you</span>
            <span><i className="h2h__swatch" style={{ background: heat(3, 3) }} />Even</span>
            <span><i className="h2h__swatch" style={{ background: heat(6, 0) }} />You own him</span>
          </div>
        </section>
      )}

      {/* ================================================= the managers == */}
      {managers.length > 0 && (
        <section>
          <div className="room__head">
            <span className="eyebrow">The managers</span>
            <span className="eyebrow">Titles · finals · all-time</span>
          </div>
          <div className="mgrs">
            {managers.map((m) => (
              <article className="mgrcard" key={m.manager} data-mine={m.manager === myManager}>
                <div className="mgrcard__head">
                  <Seal name={m.current_team ?? m.manager} src={crestUrl(m.logo_path)} mine={m.manager === myManager} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <b>{m.manager}</b>
                    <span>{m.current_team ?? "Not at the table this year"} · {m.seasons} season{m.seasons === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <p className="mgrcard__title">{titleOf(m, managers)}</p>
                <div className="mgrcard__rec">
                  <b className="num">{m.wins}–{m.losses}{m.ties ? `–${m.ties}` : ""}</b>
                  <span>{Number(m.avg).toFixed(1)} a week</span>
                </div>
                <div className="mgrcard__rings" aria-label={`${m.titles} titles`}>
                  {m.title_years.map((y) => <i className="mgrcard__ring" key={y} title={`Champion ${y}`} />)}
                </div>
                <div className="mgrcard__foot">
                  <span>{m.finals} final{m.finals === 1 ? "" : "s"} · {m.playoff_games} playoff game{m.playoff_games === 1 ? "" : "s"}</span>
                  {m.best_week && <span className="num">Best: {Number(m.best_week.points).toFixed(1)} ({m.best_week.season})</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ================================================== the ledgers == */}
      {(h.streaks.length + h.blowouts.length + h.highs.length) > 0 && (
        <div className="grid-auto">
          <section className="card">
            <div className="card__head"><h2>Longest runs</h2><Zap size={16} color="var(--gold)" /></div>
            <div className="ledger">
              {h.streaks.length === 0 && <div className="empty">No streaks yet.</div>}
              {h.streaks.map((s, i) => (
                <div className="ledger__row" key={i}>
                  <span className="num">{i + 1}</span>
                  <span><b>{s.manager}</b><i>{s.from.season === s.to.season ? `${s.from.season}, weeks ${s.from.week}–${s.to.week}` : `${s.from.season} wk ${s.from.week} → ${s.to.season} wk ${s.to.week}`}</i></span>
                  <span className="num" data-tone="gold">{s.n} W</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card__head"><h2>Biggest beatings</h2><Flame size={16} color="var(--gold)" /></div>
            <div className="ledger">
              {h.blowouts.map((b, i) => (
                <div className="ledger__row" key={i}>
                  <span className="num">{i + 1}</span>
                  <span><b>{b.winner} over {b.loser}</b><i>{b.season} · week {b.week}{b.round !== "regular" ? ` · ${b.round}` : ""} · {Number(b.w).toFixed(1)}–{Number(b.l).toFixed(1)}</i></span>
                  <span className="num">+{Number(b.margin).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card__head"><h2>Highest scores</h2><Trophy size={16} color="var(--gold)" /></div>
            <div className="ledger">
              {h.highs.map((x, i) => (
                <div className="ledger__row" key={i}>
                  <span className="num">{i + 1}</span>
                  <span><b>{x.manager}</b><i>{x.season} · week {x.week} · vs {x.opponent}</i></span>
                  <span className="num" data-tone="gold">{Number(x.points).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <p className="eyebrow" style={{ textAlign: "center", padding: "var(--s4) 0 var(--s2)" }}>
        Main Street Steakhouse · Est. {est} · Members Only
      </p>
    </main>
  );
}
