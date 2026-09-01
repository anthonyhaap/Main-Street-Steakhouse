"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { headshot, teamColor, teamLogo } from "@/lib/nfl/assets";
import { team as clubOf } from "@/lib/nfl/teams";
import { Kickoff, NewsShot, NflImage, Spark, fmtWhen } from "@/components/nfl";
import type { PlayerCard, SeasonLine, Totals } from "@/lib/nfl/types";

/* ---------------------------------------------------------------- helpers -- */

const feet = (inches: number | null) =>
  inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null;

const SEV_TONE: Record<string, string> = {
  out: "danger", doubtful: "danger", questionable: "warn",
  probable: "ok", unknown: "neutral",
};

/** Which counting stats to print, in the order that position reads them. */
const STAT_ROWS: Record<string, [keyof Totals, string][]> = {
  QB: [["pass_cmp", "Comp"], ["pass_att", "Att"], ["pass_yd", "Pass yds"], ["pass_td", "Pass TD"],
       ["pass_int", "INT"], ["rush_att", "Carries"], ["rush_yd", "Rush yds"], ["rush_td", "Rush TD"]],
  RB: [["rush_att", "Carries"], ["rush_yd", "Rush yds"], ["rush_td", "Rush TD"],
       ["rec_tgt", "Targets"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"],
       ["fum_lost", "Fumbles lost"]],
  WR: [["rec_tgt", "Targets"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"],
       ["rush_att", "Carries"], ["rush_yd", "Rush yds"]],
  TE: [["rec_tgt", "Targets"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"]],
  K:  [["fgm", "FG made"], ["fga", "FG att"]],
  DST:[["sack", "Sacks"]],
};

/* ------------------------------------------------------------------- page -- */

export function PlayerPage({ card }: { card: PlayerCard }) {
  const p = card.player;
  const club = clubOf(p.nfl_team);
  const color = teamColor(p.nfl_team);
  const isDst = p.position === "DST";

  const season = card.this_season ?? card.last_season;
  const showingLast = !card.this_season && !!card.last_season;
  const nextProj = card.projections[0] ?? null;

  return (
    <main
      className="page"
      style={{
        // The club's colour, once, as two custom properties the hero reads.
        ["--club" as string]: color ?? "var(--wine)",
        ["--club-wash" as string]: color ? `${color}1f` : "var(--gold-haze)",
      }}
    >
      <div>
        <Link href="/team" className="btn" data-v="ghost" data-size="sm">
          <ArrowLeft size={13} /> My team
        </Link>
      </div>

      {/* ---------------------------------------------------------- hero -- */}
      <section className="pl-hero">
        <div className="pl-hero__top">
          <span className="pl-shot">
            <NflImage
              src={headshot(p.espn_id)}
              alt={p.full_name}
              size={132}
              fit={isDst ? "contain" : "cover"}
              pad={isDst ? 18 : 0}
              background="transparent"
            />
          </span>

          <div className="pl-id">
            <h1>{p.full_name}</h1>
            <div className="pl-id__line">
              <span className="pos" data-p={p.position}>{p.position}</span>
              <span className="pl-id__club">
                <NflImage src={teamLogo(p.nfl_team)} alt={club?.name ?? ""} size={20} radius="0" fit="contain" />
                {club?.name ?? "Free agent"}
              </span>
              {p.jersey != null && <span className="badge" data-tone="neutral">#{p.jersey}</span>}
              {card.injury && (
                <span className="badge" data-tone={SEV_TONE[card.injury.severity] ?? "neutral"}>
                  {card.injury.status}{card.injury.detail ? ` · ${card.injury.detail}` : ""}
                </span>
              )}
              {card.roster_spot && (
                <span className="badge" data-tone="wine">
                  {card.roster_spot.team_name} · {card.roster_spot.slot === "BN" ? "Bench" : card.roster_spot.slot}
                </span>
              )}
            </div>

            <div style={{
              display: "flex", alignItems: "center", gap: "var(--s4)",
              marginTop: "var(--s4)", flexWrap: "wrap",
            }}>
              <Kickoff game={card.game} week={card.week} />
              {nextProj && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span className="score" style={{ fontSize: "1.6rem", color: "var(--gold)" }}>
                    {nextProj.points.toFixed(1)}
                  </span>
                  <span className="eyebrow">projected, week {nextProj.week}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {card.injury?.comment && (
          <div className="note" data-kind="error" style={{ borderBottom: 0 }}>
            {card.injury.comment}
            {card.injury.return_date ? ` Targeting a return ${card.injury.return_date}.` : ""}
          </div>
        )}

        <div className="pl-bio">
          <Bio label="Age" value={p.age != null ? String(p.age) : null} />
          <Bio label="Height" value={feet(p.height_in)} />
          <Bio label="Weight" value={p.weight_lb ? `${p.weight_lb} lb` : null} />
          <Bio label="Experience" value={
            p.years_exp == null ? null : p.years_exp === 0 ? "Rookie" : `${p.years_exp} yrs`} />
          <Bio label="College" value={p.college} />
          <Bio label="Bye" value={p.bye_week ? `Week ${p.bye_week}` : null} />
          <Bio label="Depth" value={
            p.depth_chart_order ? `${p.depth_chart_pos ?? p.position}${p.depth_chart_order}` : null} />
          <Bio label="ADP" value={card.market?.adp ? Number(card.market.adp).toFixed(1) : null} />
        </div>
      </section>

      <div className="pl-grid">
        <div className="th-col">
          {/* ------------------------------------------------ projections -- */}
          <section className="card" data-accent="gold">
            <div className="card__head">
              <h2>Projected</h2>
              <span className="eyebrow">
                {card.rest_of_season > 0
                  ? <><span className="num">{card.rest_of_season.toFixed(1)}</span> rest of season</>
                  : "No projection on file"}
              </span>
            </div>
            {card.projections.length === 0 ? (
              <div className="empty" style={{ padding: "var(--s6) var(--s5)" }}>
                Nothing projected for him yet.<br />Projections load each day once the week is set.
              </div>
            ) : (
              <>
                <div className="proj">
                  {card.projections.slice(0, 8).map((pr) => (
                    <span className="proj__wk" key={pr.week} data-next={pr.week === card.week}>
                      <b>{pr.points.toFixed(1)}</b>
                      <span>Week {pr.week}</span>
                    </span>
                  ))}
                </div>
                <div style={{ padding: "0 var(--s5) var(--s4)" }}>
                  <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>
                    Sleeper&apos;s projection, scored under this league&apos;s rules
                    {nextProj?.updated_at ? ` · updated ${fmtWhen(nextProj.updated_at)}` : ""}
                  </span>
                </div>
              </>
            )}
          </section>

          {/* ---------------------------------------------------- season -- */}
          {season ? (
            <SeasonCard
              line={season}
              label={showingLast ? `${season.season} season` : `${season.season} season`}
              note={showingLast
                ? `He has no ${card.league.season} lines yet — this is last season, scored under our rules.`
                : null}
              position={p.position}
            />
          ) : (
            <section className="card">
              <div className="card__head"><h2>Season</h2></div>
              <div className="empty">No stat lines on file for him.</div>
            </section>
          )}

          {/* Both, when both exist — this year's form next to last year's. */}
          {card.this_season && card.last_season && (
            <SeasonCard line={card.last_season} label={`${card.last_season.season} season`}
              note={null} position={p.position} />
          )}
        </div>

        <div className="th-col">
          {/* ----------------------------------------------- depth chart -- */}
          <section className="card">
            <div className="card__head">
              <h2>Depth chart</h2>
              <span className="eyebrow">{club?.nick ?? "Club"} · {p.position}</span>
            </div>
            {card.depth_chart.length === 0 ? (
              <div className="empty">Nobody else listed here.</div>
            ) : (
              <div className="depth">
                {card.depth_chart.map((d) => (
                  <Link key={d.player_id} href={`/player/${d.player_id}`}
                    className="depth__row" data-me={d.is_this_player}>
                    <span className="depth__ord">{d.order ?? "–"}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="depth__name">{d.name}</span>
                      {d.injury_status && (
                        <span className="eyebrow" style={{ display: "block", color: "var(--lose)", marginTop: 2 }}>
                          {d.injury_status}
                        </span>
                      )}
                    </span>
                    <span className="num" style={{ fontSize: "var(--t-small)", color: "var(--muted)" }}>
                      {d.avg_points != null ? `${Number(d.avg_points).toFixed(1)}` : "—"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--rule-soft)" }}>
              <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>
                Club&apos;s own order · points are per game
              </span>
            </div>
          </section>

          {/* ------------------------------------------------------ news -- */}
          <section className="card">
            <div className="card__head">
              <h2>On the wire</h2>
              <span className="eyebrow">ESPN</span>
            </div>
            {card.news.length === 0 ? (
              <div className="empty" style={{ padding: "var(--s6) var(--s5)" }}>
                Nothing about him in the last fortnight.
              </div>
            ) : (
              <div>
                {card.news.map((n) => (
                  <a key={n.id} className="news" href={n.url ?? undefined}
                    target="_blank" rel="noopener noreferrer">
                    <NewsShot src={n.image_url} alt={n.image_alt ?? n.headline} />
                    <span className="news__body">
                      <b>{n.headline}</b>
                      {n.description && <p>{n.description}</p>}
                      <span className="news__meta">
                        {n.published_at && <span>{fmtWhen(n.published_at)}</span>}
                        {n.byline && <span>{n.byline}</span>}
                        <ExternalLink size={10} />
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ parts -- */

function Bio({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <b>{value ?? "—"}</b>
      <span>{label}</span>
    </div>
  );
}

function SeasonCard({
  line, label, note, position,
}: {
  line: SeasonLine; label: string; note: string | null; position: string;
}) {
  const rows = (STAT_ROWS[position] ?? []).filter(([k]) => line.totals[k] != null);
  const peak = Math.max(1, ...line.game_log.map((g) => g.points));

  return (
    <section className="card">
      <div className="card__head">
        <h2>{label}</h2>
        <span className="eyebrow">
          <span className="num">{line.avg_points.toFixed(1)}</span> per game ·{" "}
          <span className="num">{line.games}</span> games
        </span>
      </div>

      {note && <div className="note" data-kind="info">{note}</div>}

      <div className="th-strip" style={{ borderTop: 0 }}>
        <div className="th-stat"><b>{line.points.toFixed(1)}</b><span>Total points</span></div>
        <div className="th-stat"><b>{line.best.toFixed(1)}</b><span>Best week</span></div>
        <div className="th-stat"><b>{line.worst.toFixed(1)}</b><span>Worst week</span></div>
        <div className="th-stat"><b>±{line.swing.toFixed(1)}</b><span>Swing</span></div>
        <div className="th-stat"><b data-tone="ok">{line.booms}</b><span>15+ weeks</span></div>
        <div className="th-stat"><b data-tone="warn">{line.busts}</b><span>Under 5</span></div>
      </div>

      {line.game_log.length > 1 && (
        <div className="gamelog">
          {line.game_log.map((g) => (
            <span className="gamelog__col" key={g.week} data-best={g.points === line.best}>
              <b>{g.points.toFixed(0)}</b>
              <i className="gamelog__bar" style={{ height: `${Math.max(2, (g.points / peak) * 100)}%` }} />
              <span>W{g.week}</span>
            </span>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="scroll" style={{ overflowX: "auto", borderTop: "1px solid var(--rule)" }}>
          <table className="statline">
            <thead>
              <tr>
                <th scope="col">Stat</th>
                <th scope="col">Season</th>
                <th scope="col">Per game</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, label2]) => {
                const total = Number(line.totals[key] ?? 0);
                return (
                  <tr key={key}>
                    <td style={{ color: "var(--muted)" }}>{label2}</td>
                    <td>{total % 1 === 0 ? total : total.toFixed(1)}</td>
                    <td style={{ color: "var(--dim)" }}>{(total / Math.max(1, line.games)).toFixed(1)}</td>
                  </tr>
                );
              })}
              {line.usage.snap_pct != null && (
                <tr>
                  <td style={{ color: "var(--muted)" }}>Snap share</td>
                  <td>—</td>
                  <td style={{ color: "var(--dim)" }}>{Math.round(line.usage.snap_pct)}%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {line.game_log.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)",
                      padding: "var(--s3) var(--s5)", borderTop: "1px solid var(--rule-soft)" }}>
          <span className="eyebrow">Trend</span>
          <Spark points={line.game_log} width={140} height={22} />
          {line.last3_avg != null && (
            <span className="eyebrow" style={{ marginLeft: "auto" }}>
              Last 3: <span className="num">{line.last3_avg.toFixed(1)}</span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
