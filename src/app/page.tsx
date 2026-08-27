"use client";

import { useCallback } from "react";
import Link from "next/link";
import { ArrowRight, Flame, ListOrdered, Radio } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock, useTicker } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { BoardPick, Draft, Matchup, Standing, Team } from "@/lib/types";
import { fmtClock, pickLabel, teamAtPick } from "@/lib/draft";
import { TopBar } from "@/components/Shell";
import { Seal, Skeleton, SkeletonRows, fmtPts } from "@/components/ui";

type Hub = {
  draft: Draft;
  teams: Team[];
  recent: BoardPick[];
  standings: Standing[];
  matchups: Matchup[];
  week: number;
};

export default function HomePage() {
  const { ready, team, league } = useSession();
  const { serverNow, synced } = useServerClock();
  useTicker(500);

  const fetcher = useCallback(async (): Promise<Hub> => {
    const supabase = supabaseBrowser();
    const wk = await supabase.rpc("ff_current_week");
    const week = (wk.data as number) ?? 1;
    const [d, t, r, s, m] = await Promise.all([
      supabase.from("drafts").select("*").eq("id", DRAFT_ID).single(),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      supabase.from("draft_board").select("*").eq("draft_id", DRAFT_ID)
        .order("pick_number", { ascending: false }).limit(8),
      supabase.from("standings").select("*").eq("league_id", LEAGUE_ID),
      supabase.from("matchups").select("*").eq("league_id", LEAGUE_ID).eq("week", week),
    ]);
    return {
      draft: d.data as Draft,
      teams: (t.data ?? []) as Team[],
      recent: (r.data ?? []) as BoardPick[],
      standings: (s.data ?? []) as Standing[],
      matchups: (m.data ?? []) as Matchup[],
      week,
    };
  }, []);

  const { data, status } = useLive<Hub>(fetcher, {
    tables: ["draft_picks", "drafts", "matchups", "teams"],
    channel: "league-hub",
    pollMs: 30000,
    enabled: ready,
  });

  if (!ready || !data) {
    return (
      <>
        <TopBar status={status} />
        <main className="page">
          <div className="card"><div className="card__body"><Skeleton h={130} /></div></div>
          <div className="grid-auto">
            {[0, 1, 2].map((i) => <div className="card" key={i}><SkeletonRows n={4} /></div>)}
          </div>
        </main>
      </>
    );
  }

  const teamCount = data.teams.length || 12;
  const onClock = teamAtPick(data.draft.current_pick, data.teams, teamCount);
  const nameOf = (id: string) => data.teams.find((t) => t.id === id)?.name ?? "—";
  const table = [...data.standings].sort((a, b) => b.wins - a.wins || Number(b.points_for) - Number(a.points_for));
  const total = teamCount * data.draft.rounds;

  const msLeft =
    data.draft.status === "active" && data.draft.pick_deadline && synced
      ? new Date(data.draft.pick_deadline).getTime() - serverNow()
      : null;

  const live = data.draft.status === "active";

  return (
    <>
      <TopBar status={status} />
      <main className="page">

        {/* ---------------------------------------------------------- hero -- */}
        <section className="card" data-accent={live ? "gold" : undefined}
          style={{ padding: "clamp(var(--s5), 4vw, var(--s7))" }}>
          <div className="eyebrow" data-tone="gold">
            {league?.name ?? "League"} · {league?.season ?? 2026} · {teamCount} managers
          </div>

          <h1 className="display" style={{ fontSize: "var(--t-hero)", margin: "var(--s4) 0 var(--s3)" }}>
            {data.draft.status === "complete" ? (
              <>Rosters are set.<br />Now go win it.</>
            ) : live ? (
              <><span style={{ color: "var(--gold)" }}>{onClock?.name}</span><br />is on the clock.</>
            ) : (
              <>Built for Sundays.<br /><span style={{ color: "var(--gold)" }}>Owned by the league.</span></>
            )}
          </h1>

          {live && msLeft !== null && (
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)", margin: "0 0 var(--s4)" }}>
              <span className="score" style={{ fontSize: "clamp(2rem,6vw,3rem)", color: msLeft <= 15000 ? "var(--gold-lit)" : "var(--cream)" }}>
                {fmtClock(msLeft)}
              </span>
              <span className="eyebrow">
                Pick {pickLabel(data.draft.current_pick, teamCount)} · {data.draft.current_pick} of {total}
              </span>
            </div>
          )}

          {!live && (
            <p className="prose" style={{ margin: "0 0 var(--s5)" }}>
              {data.draft.status === "setup"
                ? "The draft room is open and waiting on the commissioner. Set your queue now — if your clock ever runs out, autopick works straight down it."
                : "One home for the draft, live scoring, matchups and standings."}
            </p>
          )}

          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
            <Link className="btn" data-v="primary" href="/draft">
              {live ? "Enter the draft room" : "Draft room"} <ArrowRight size={14} />
            </Link>
            <Link className="btn" href="/team">My team</Link>
            <Link className="btn" href="/matchups">Live scores</Link>
          </div>
        </section>

        {/* -------------------------------------------------------- panels -- */}
        <div className="grid-auto">

          <article className="card">
            <div className="card__head"><h2>Recent picks</h2><Flame size={16} color="var(--gold)" /></div>
            <div className="rows">
              {data.recent.length === 0 && <div className="empty">The board is empty.<br />Nothing drafted yet.</div>}
              {data.recent.map((p) => (
                <div className="row" key={p.player_id} data-mine={p.team_id === team?.id}>
                  <span className="num eyebrow" style={{ width: 34 }}>{pickLabel(p.pick_number, teamCount)}</span>
                  <span className="pos" data-p={p.position}>{p.position}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.player_name}
                    </div>
                    <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em" }}>{p.team_name}</div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="card__head"><h2>Week {data.week}</h2><Radio size={16} color="var(--gold)" /></div>
            <div className="rows">
              {data.matchups.length === 0 && <div className="empty">The schedule posts<br />once the draft is done.</div>}
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

          <article className="card">
            <div className="card__head"><h2>Standings</h2><ListOrdered size={16} color="var(--gold)" /></div>
            <div className="rows">
              {table.map((s, i) => (
                <div className="row" key={s.team_id} data-mine={s.team_id === team?.id}>
                  <span className="num eyebrow" style={{ width: 18 }}>{i + 1}</span>
                  <Seal name={s.name} mine={s.team_id === team?.id} size={26} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.name}
                  </span>
                  <span className="num" style={{ fontSize: "var(--t-small)" }}>
                    {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}
                  </span>
                  <span className="num" style={{ fontSize: "var(--t-micro)", color: "var(--dim)", width: 50, textAlign: "right" }}>
                    {fmtPts(s.points_for)}
                  </span>
                </div>
              ))}
            </div>
          </article>

        </div>
      </main>
    </>
  );
}

function Side({ name, pts, win }: { name: string; pts: number; win: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s3)", padding: "3px 0" }}>
      <span style={{
        color: win ? "var(--cream)" : "var(--muted)", fontWeight: win ? 600 : 400,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{name}</span>
      <span className="num" style={{ color: win ? "var(--gold)" : "var(--muted)", fontWeight: win ? 600 : 400 }}>
        {fmtPts(pts)}
      </span>
    </div>
  );
}
