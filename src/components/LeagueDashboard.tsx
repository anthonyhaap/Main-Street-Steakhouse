"use client";

import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2,
  CircleDollarSign, ClipboardList, Crown, Flame, ListOrdered, Mail, MessageCircle,
  Radio, Server, Shield, Swords, Timer, Users,
} from "lucide-react";
import type { BoardPick, Matchup, Pulse, Standing, Team } from "@/lib/types";
import { fmtClock, pickLabel, snakeSlot, teamAtPick } from "@/lib/draft";
import { crestUrl } from "@/lib/crest";
import { Seal, fmtPts } from "@/components/ui";
import { Plaque } from "@/components/Plaque";
import { CheckRow, Kpi, Meter, Ring, fmtDay, relTime } from "@/components/dash";

export type Hub = {
  pulse: Pulse;
  teams: Team[];
  recent: BoardPick[];
  standings: Standing[];
  matchups: Matchup[];
};

/**
 * The commissioner's command center. Deliberately a pure function of its
 * props — every clock value is passed in — so it can be rendered from
 * fixtures and screenshotted without a session or a database.
 */
export function LeagueDashboard({
  data, myTeamId, now, msLeft,
}: {
  data: Hub;
  myTeamId?: string | null;
  now: number;
  /** Server time, passed in so the whole page shares one tick. */
  msLeft: number | null;
}) {
  const team = myTeamId ? { id: myTeamId } : null;
  const { pulse } = data;
  const draft = pulse.draft;
  const teamCount = pulse.league.team_count || data.teams.length || 12;
  const live = draft?.status === "active";
  const complete = draft?.status === "complete";
  const onClock = draft ? teamAtPick(draft.current_pick, data.teams, teamCount) : undefined;
  const nameOf = (id: string) => data.teams.find((t) => t.id === id)?.name ?? "\u2014";
  const managerOf = (id: string) => data.teams.find((t) => t.id === id)?.manager_name ?? null;
  const crestOf = (id: string) => crestUrl(data.teams.find((t) => t.id === id)?.logo_path);

  const table = [...data.standings].sort(
    (a, b) => b.wins - a.wins || Number(b.points_for) - Number(a.points_for),
  );

  const joined = pulse.managers.filter((m) => m.joined).length;
  const invited = pulse.managers.filter((m) => m.invited).length;
  const openChecks = pulse.checks.filter((c) => !c.ok);
  const pickPct = draft && draft.picks_total > 0 ? (draft.picks_made / draft.picks_total) * 100 : 0;
  const badJobs = pulse.data.jobs.filter((j) => !j.healthy).length;

  const upNext = draft
    ? [1, 2, 3]
        .map((n) => draft.current_pick + n)
        .filter((p) => p <= draft.picks_total)
        .map((p) => ({ pick: p, team: data.teams.find((t) => t.draft_slot === snakeSlot(p, teamCount)) }))
    : [];

  return (
    <>
      <main className="page">

        {/* ==================================================== hero band == */}
        <section className="hero">
          <div>
            <div className="hero__eyebrow">
              <span className="badge" data-tone="wine">
                <Crown /> {pulse.league.name}
              </span>
              <span className="badge" data-tone="neutral">{pulse.league.season} Season</span>
              <span className="badge" data-tone="neutral">Week {pulse.season.week}</span>
              {live && <span className="badge" data-tone="live">Draft Live</span>}
              {draft?.status === "paused" && <span className="badge" data-tone="warn">Draft Paused</span>}
              {complete && <span className="badge" data-tone="ok">Draft Complete</span>}
            </div>

            <h1 className="display">
              {complete ? (
                <>Rosters are set.<br /><span className="hero__wine">Now go win it.</span></>
              ) : live ? (
                <><span className="hero__wine">{onClock?.name ?? "Someone"}</span><br />is on the clock.</>
              ) : joined < teamCount ? (
                <>{teamCount - joined} seat{teamCount - joined === 1 ? "" : "s"} still<br />
                  <span className="hero__wine">waiting on a manager.</span></>
              ) : (
                <>Twelve managers.<br /><span className="hero__wine">One draft board.</span></>
              )}
            </h1>

            {live && msLeft !== null ? (
              <div className="hero__clock" data-urgent={msLeft <= 15000}>
                <span className="score">{fmtClock(msLeft)}</span>
                <span className="eyebrow">
                  Pick {pickLabel(draft!.current_pick, teamCount)} · {draft!.picks_made} of {draft!.picks_total} made
                </span>
              </div>
            ) : (
              <p className="prose" style={{ margin: 0 }}>
                {complete
                  ? "The board is closed and the schedule is posted. Lineups lock at each player's kickoff — the clock is the server's, not your phone's."
                  : draft?.status === "paused"
                  ? "The room is paused. Nobody can pick until the commissioner resumes — a good moment to chase down whoever is missing."
                  : joined < teamCount
                  ? "Everyone drafts from the same board, on the same clock. Get the last invites out and this room is ready."
                  : "Everyone is in. Set the order, tell them the time, and open the room."}
              </p>
            )}

            <div className="hero__cta">
              <Link className="btn" data-v="primary" href="/draft">
                {live ? "Enter the draft room" : "Draft room"} <ArrowRight size={14} />
              </Link>
              {pulse.league.is_commissioner && (
                <Link className="btn" data-v="gold" href="/admin"><Crown size={14} /> Commish tools</Link>
              )}
              <Link className="btn" href="/matchups"><Radio size={14} /> Live scores</Link>
              <Link className="btn" href="/chat"><MessageCircle size={14} /> Clubhouse</Link>
            </div>
          </div>

          <Ring pct={pulse.readiness.pct} passed={pulse.readiness.passed} total={pulse.readiness.total} />
        </section>

        {/* ======================================================= plaque == */}
        <Plaque now={now} />

        {/* ========================================================= KPIs == */}
        <div className="kpis">
          <Kpi
            label="Managers in"
            icon={<Users size={11} />}
            value={`${joined}/${teamCount}`}
            tone={joined >= teamCount ? "ok" : "warn"}
            foot={`${invited} invited · ${teamCount - invited} seat${teamCount - invited === 1 ? "" : "s"} with no email`}
            href="/admin"
          />
          <Kpi
            label="Draft board"
            icon={<Swords size={11} />}
            value={draft ? `${draft.picks_made}/${draft.picks_total}` : "—"}
            tone={complete ? "ok" : live ? "wine" : undefined}
            foot={draft ? `${draft.rounds} rounds · ${draft.pick_seconds}s per pick` : "No draft configured"}
            href="/draft"
          />
          <Kpi
            label="Queues set"
            icon={<ClipboardList size={11} />}
            value={`${draft?.teams_with_queue ?? 0}/${teamCount}`}
            tone={(draft?.teams_with_queue ?? 0) >= teamCount ? "ok" : "warn"}
            foot="Autopick follows the queue when a clock runs out"
            href="/draft"
          />
          <Kpi
            label="Next kickoff"
            icon={<Timer size={11} />}
            value={fmtDay(pulse.season.next_kickoff)}
            tone="gold"
            foot={relTime(pulse.season.next_kickoff, now)}
            href="/matchups"
          />
          <Kpi
            label="Open challenges"
            icon={<CircleDollarSign size={11} />}
            value={pulse.clubhouse.open_challenges}
            tone={pulse.clubhouse.open_challenges > 0 ? "wine" : undefined}
            foot={`${pulse.clubhouse.messages_7d} clubhouse message${pulse.clubhouse.messages_7d === 1 ? "" : "s"} this week`}
            href="/challenges"
          />
          <Kpi
            label="Data wire"
            icon={<Server size={11} />}
            value={badJobs === 0 ? "Healthy" : `${badJobs} late`}
            tone={badJobs === 0 ? "ok" : "warn"}
            foot={`Last ingest ${relTime(pulse.data.last_ingest_at, now)}`}
            href="/admin"
          />
        </div>

        {/* ==================================================== main grid == */}
        <div className="dash">

          {/* --------------------------------------------------- left rail */}
          <div className="dash__col">

            {/* draft command */}
            <article className="card" data-accent={live ? "gold" : undefined}>
              <div className="card__head">
                <h2>{complete ? "The board" : "Draft command"}</h2>
                <span className="badge" data-tone={live ? "live" : complete ? "ok" : "neutral"}>
                  {draft?.status ?? "none"}
                </span>
              </div>

              <div className="card__body" style={{ display: "grid", gap: "var(--s4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s3)", alignItems: "baseline" }}>
                  <span className="eyebrow">Board progress</span>
                  <span className="num" style={{ fontSize: "var(--t-small)", color: "var(--muted)" }}>
                    {draft?.picks_made ?? 0} of {draft?.picks_total ?? 0} picks
                  </span>
                </div>
                <Meter pct={pickPct} tone={complete ? "ok" : undefined} />

                {!complete && upNext.length > 0 && (
                  <div style={{ display: "grid", gap: "var(--s2)" }}>
                    <span className="eyebrow">On deck</span>
                    <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
                      {upNext.map(({ pick, team: t }) => (
                        <span key={pick} className="badge" data-tone="neutral" title={`Pick ${pick}`}>
                          {pickLabel(pick, teamCount)} · {t?.name ?? "—"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="card__head" style={{ borderTop: "1px solid var(--rule)", borderBottom: 0 }}>
                <h2 style={{ fontSize: "var(--t-body)" }}>Recent picks</h2>
                <Flame size={15} color="var(--gold)" />
              </div>
              <div className="rows">
                {data.recent.length === 0 && (
                  <div className="empty">The board is empty.<br />Nothing drafted yet.</div>
                )}
                {data.recent.map((p) => (
                  <div className="row" key={p.player_id} data-mine={p.team_id === team?.id}>
                    <span className="num eyebrow" style={{ width: 36 }}>{pickLabel(p.pick_number, teamCount)}</span>
                    <span className="pos" data-p={p.position}>{p.position}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.player_name}
                        {p.nfl_team && <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {p.nfl_team}</span>}
                      </div>
                      <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em" }}>{p.team_name}</div>
                    </div>
                    {p.is_autopick && <span className="badge" data-tone="neutral">Auto</span>}
                  </div>
                ))}
              </div>
            </article>

            {/* week scoreboard */}
            <article className="card">
              <div className="card__head">
                <h2>Week {pulse.season.week}</h2>
                <Radio size={16} color="var(--gold)" />
              </div>
              <div className="rows">
                {data.matchups.length === 0 && (
                  <div className="empty">The schedule posts<br />once the draft is done.</div>
                )}
                {data.matchups.map((m) => {
                  const mine = m.home_team_id === team?.id || m.away_team_id === team?.id;
                  const hp = Number(m.home_points), ap = Number(m.away_points);
                  return (
                    <div className="row" key={m.id} data-mine={mine} style={{ display: "block" }}>
                      <Side name={nameOf(m.away_team_id)} pts={ap} win={ap > hp} />
                      <Side name={nameOf(m.home_team_id)} pts={hp} win={hp > ap} />
                    </div>
                  );
                })}
              </div>
            </article>

            {/* standings */}
            <article className="card">
              <div className="card__head">
                <h2>Standings</h2>
                <ListOrdered size={16} color="var(--gold)" />
              </div>
              <div className="rows">
                {table.length === 0 && <div className="empty">No games played yet.</div>}
                {table.map((s, i) => (
                  <div className="row" key={s.team_id} data-mine={s.team_id === team?.id}>
                    <span className="num eyebrow" style={{ width: 18 }}>{i + 1}</span>
                    <Seal name={s.name} src={crestOf(s.team_id)} mine={s.team_id === team?.id} size={28} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>
                      {s.name}
                      {(s.manager_name ?? managerOf(s.team_id)) && (
                        <span style={{ color: "var(--dim)", fontWeight: 400 }}> · {s.manager_name ?? managerOf(s.team_id)}</span>
                      )}
                    </span>
                    <span className="num" style={{ fontSize: "var(--t-small)" }}>
                      {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}
                    </span>
                    <span className="num" style={{ fontSize: "var(--t-micro)", color: "var(--dim)", width: 52, textAlign: "right" }}>
                      {fmtPts(s.points_for)}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </div>

          {/* -------------------------------------------------- right rail */}
          <div className="dash__col">

            {/* readiness checklist */}
            <article className="card" data-accent={openChecks.length ? "wine" : undefined}>
              <div className="card__head">
                <h2>League readiness</h2>
                <span className="badge" data-tone={openChecks.length ? "warn" : "ok"}>
                  {openChecks.length ? <AlertTriangle /> : <CheckCircle2 />}
                  {openChecks.length ? `${openChecks.length} open` : "All clear"}
                </span>
              </div>
              <div className="rows">
                {[...pulse.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((c) => (
                  <CheckRow key={c.key} ok={c.ok} label={c.label} detail={c.detail} fix={c.fix} />
                ))}
              </div>
            </article>

            {/* quick actions */}
            <article className="card">
              <div className="card__head">
                <h2>Run the league</h2>
                <Shield size={16} color="var(--gold)" />
              </div>
              <div className="qa">
                <Link className="qa__btn" href="/admin"><Mail /> Send invites</Link>
                <Link className="qa__btn" href="/admin"><ListOrdered /> Draft order</Link>
                <Link className="qa__btn" href="/admin"><Timer /> Clock &amp; rounds</Link>
                <Link className="qa__btn" href="/admin"><BarChart3 /> Scoring rules</Link>
                <Link className="qa__btn" href="/players"><Users /> Player pool</Link>
                <Link className="qa__btn" href="/challenges"><CircleDollarSign /> Settle bets</Link>
              </div>
            </article>

            {/* manager roll call */}
            <article className="card">
              <div className="card__head">
                <h2>Roll call</h2>
                <span className="badge" data-tone={joined >= teamCount ? "ok" : "warn"}>
                  {joined}/{teamCount} in
                </span>
              </div>
              <div className="rows">
                {pulse.managers.map((m) => (
                  <div className="mgr" key={m.team_id}>
                    <span className="mgr__slot">{m.draft_slot ?? "–"}</span>
                    <Seal name={m.name} src={crestOf(m.team_id)} mine={m.team_id === team?.id} size={28} />
                    <span className="mgr__name">
                      <b>{m.name}</b>
                      {/* The person, never the address: emails stay on the invite screen. */}
                      <span>
                        {managerOf(m.team_id) || m.display_name
                          || (m.joined ? "Signed in" : m.invited ? "Invite sent" : "No manager yet")}
                      </span>
                    </span>
                    <span className="badge" data-tone={m.joined ? "ok" : m.invited ? "warn" : "danger"}>
                      {m.joined ? "In" : m.invited ? "Invited" : "Empty"}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            {/* season calendar */}
            <article className="card">
              <div className="card__head">
                <h2>Season calendar</h2>
                <CalendarDays size={16} color="var(--gold)" />
              </div>
              <div className="cal scroll">
                {pulse.season.calendar.map((w) => (
                  <div
                    key={w.week}
                    className="cal__wk"
                    data-state={w.week === pulse.season.week ? "now" : w.final >= w.games ? "done" : "next"}
                    title={`${w.games} games · first kick ${fmtDay(w.first_kick)}`}
                  >
                    <span>Wk</span>
                    <b className="num">{w.week}</b>
                    <span>{fmtDay(w.first_kick)}</span>
                  </div>
                ))}
              </div>
            </article>

            {/* automation */}
            <article className="card">
              <div className="card__head">
                <h2>Automation</h2>
                <span className="badge" data-tone={badJobs === 0 ? "ok" : "danger"}>
                  {badJobs === 0 ? "On time" : `${badJobs} late`}
                </span>
              </div>
              <div className="jobs">
                {pulse.data.jobs.length === 0 && <div className="empty">Job status unavailable.</div>}
                {pulse.data.jobs.map((j) => (
                  <div className="job" key={j.name} data-ok={j.healthy}>
                    <i className="job__dot" />
                    <span className="job__name">{j.name}</span>
                    <span className="job__meta">{cronWords(j.schedule)} · {relTime(j.last_run, now)}</span>
                  </div>
                ))}
              </div>
              <div className="card__body" style={{ paddingTop: 0, display: "grid", gap: 6 }}>
                <span className="kpi__foot">
                  {pulse.data.players.toLocaleString()} players · {pulse.data.adp.toLocaleString()} ranked ·{" "}
                  {pulse.data.byes.toLocaleString()} byes · {pulse.data.games} games
                </span>
                <span className="kpi__foot">Stats last written {relTime(pulse.data.last_stats_at, now)}</span>
              </div>
            </article>

            {/* activity */}
            <article className="card">
              <div className="card__head">
                <h2>League ledger</h2>
                <Activity size={16} color="var(--gold)" />
              </div>
              <div className="feed">
                {pulse.activity.length === 0 && (
                  <div className="empty">Nothing on the ledger yet.<br />It fills up fast once you draft.</div>
                )}
                {pulse.activity.map((e) => (
                  <div className="feed__item" key={e.id}>
                    <span className="feed__dot"><Activity /></span>
                    <span className="feed__body">
                      <b>{e.headline}</b>
                      {(e.detail || e.actor) && <span>{[e.actor, e.detail].filter(Boolean).join(" · ")}</span>}
                    </span>
                    <span className="feed__when">{relTime(e.created_at, now)}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>

        <p className="eyebrow" style={{ textAlign: "center", padding: "var(--s4) 0 var(--s2)" }}>
          Main Street Steakhouse · Est. 2016 · Members Only
        </p>
      </main>
    </>
  );
}

/** Raw cron syntax reads like an error message on a dashboard. */
function cronWords(schedule: string): string {
  const s = schedule.trim();
  const secs = s.match(/^(\d+)\s*seconds?$/i);
  if (secs) return `every ${secs[1]}s`;
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour] = parts;
    const everyMin = min.match(/^\*\/(\d+)$/);
    if (everyMin && hour === "*") return `every ${everyMin[1]} min`;
    if (min === "*" && hour === "*") return "every minute";
    const everyHr = hour.match(/^\*\/(\d+)$/);
    if (everyHr) return `every ${everyHr[1]}h`;
    if (/^\d+$/.test(min) && hour === "*") return "hourly";
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      return `daily ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
    }
  }
  return s;
}

function Side({ name, pts, win }: { name: string; pts: number; win: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s3)", padding: "3px 0" }}>
      <span style={{
        color: win ? "var(--cream)" : "var(--muted)", fontWeight: win ? 600 : 400,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{name}</span>
      <span className="num" style={{ color: win ? "var(--wine)" : "var(--muted)", fontWeight: win ? 700 : 400 }}>
        {fmtPts(pts)}
      </span>
    </div>
  );
}
