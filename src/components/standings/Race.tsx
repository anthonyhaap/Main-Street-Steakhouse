"use client";

import Link from "next/link";
import { ArrowRight, Flag } from "lucide-react";
import type { Outlook } from "@/lib/types";
import { SIMS, stakesFor, winsNeeded, type PlayoffRace, type WinsPath } from "@/lib/playoffs";

/**
 * The playoff picture as a race: what this week is worth.
 *
 * The table says where everybody stands and what their odds are. It cannot
 * say the thing a manager on the bubble actually wants to know on a Tuesday —
 * what this Sunday does to him, whose games to watch, and how many more he
 * needs. Those come out of the same simulated seasons, conditioned on this
 * week's results and on how many games each team goes on to win.
 *
 * Presentation only: `race` is `playoffRace(outlook)`, so a fixture renders
 * it exactly as the league does.
 */
export function RaceCard({ race, outlook, myTeamId }: {
  race: PlayoffRace;
  outlook: Outlook;
  myTeamId?: string | null;
}) {
  if (race.week === null || race.games.length === 0) return null;
  const name = (id: string) => outlook.teams.find((t) => t.id === id)?.name ?? "—";
  const mine = myTeamId ? race.projections.find((p) => p.team_id === myTeamId) : undefined;
  const stakes = mine ? stakesFor(race, mine.team_id) : null;
  const own = mine ? race.games.find((g) => g.home_team_id === mine.team_id || g.away_team_id === mine.team_id) : undefined;
  const opp = own && mine ? (own.home_team_id === mine.team_id ? own.away_team_id : own.home_team_id) : null;
  const biggest = race.games.filter((g) => g.leverage >= 1).slice(0, 3);

  return (
    <section className="card race" aria-label="The race">
      <div className="card__head">
        <div>
          <h2>The race</h2>
          <div className="eyebrow" style={{ marginTop: 5 }}>Week {race.week} · what it is worth</div>
        </div>
        <Flag size={17} color="var(--gold)" aria-hidden />
      </div>

      {mine && stakes && (
        <div className="card__body race__mine">
          {mine.status === "clinched_bye" ? (
            <p className="race__lead">You have clinched a first-round bye. This week is for seeding.</p>
          ) : mine.status === "clinched" ? (
            <p className="race__lead">You are in. What is left is seeding{outlook.playoff_byes > 0 ? " and the bye" : ""}.</p>
          ) : mine.status === "eliminated" ? (
            <p className="race__lead">You are out of the running. You can still decide who is not.</p>
          ) : (
            <>
              <p className="race__lead">
                You are at <b>{pct(stakes.now)}</b>.
                {stakes.ifWin !== null && opp && (
                  <> Beat {name(opp)}: <b className="race__up">{pct(stakes.ifWin)}</b>. Lose: <b className="race__down">{pct(stakes.ifLose ?? 0)}</b>.</>
                )}
              </p>
              {stakes.rootFor.length > 0 && (
                <p className="race__root">
                  Also root for{" "}
                  {stakes.rootFor.map((r, k) => (
                    <span key={r.matchup_id}>
                      {k > 0 && (k === stakes.rootFor.length - 1 ? " and " : ", ")}
                      <b>{name(r.team_id)}</b> over {name(r.against_id)} <span className="race__gain">(+{Math.round(r.gain)} for you)</span>
                    </span>
                  ))}
                  .
                </p>
              )}
              <Takes paths={stakes.paths} />
            </>
          )}
        </div>
      )}

      {biggest.length > 0 && (
        <div className="card__body race__games">
          <div className="eyebrow">The games that move it most</div>
          <ul>
            {biggest.map((g) => {
              const h = race.teamIndex.get(g.home_team_id)!;
              const a = race.teamIndex.get(g.away_team_id)!;
              return (
                <li key={g.matchup_id}>
                  <Link className="race__game" href={`/matchups/${g.matchup_id}?week=${race.week}`}>
                    <span className="race__vs">{name(g.away_team_id)} <i>at</i> {name(g.home_team_id)}</span>
                    <span className="race__sides">
                      <Side label={name(g.away_team_id)} win={g.ifAway[a]} lose={g.ifHome[a]} />
                      <Side label={name(g.home_team_id)} win={g.ifHome[h]} lose={g.ifAway[h]} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card__body">
        <span className="race__note">
          From the same {SIMS.toLocaleString()} simulated seasons as the table: each number is the share of them
          that ended in the playoffs.
        </span>
      </div>
    </section>
  );
}

/**
 * "Two more wins: 69%" — the counts the simulation actually reached, from the
 * first that gives a real chance: a row of "<1%" in front says nothing.
 */
function Takes({ paths }: { paths: WinsPath[] }) {
  const reached = paths.filter((p) => p.share >= 1);
  const first = reached.findIndex((p) => Math.round(p.pct) >= 1);
  const seen = first < 0 ? reached.slice(-1) : reached.slice(first);
  if (seen.length === 0) return null;
  const need = winsNeeded(paths);
  const last = paths[paths.length - 1];
  return (
    <div className="race__takes">
      <p className="race__root">
        {need
          ? <>{need.more === 0 ? "Even with no more wins" : `${words(need.more)} more win${need.more === 1 ? "" : "s"}`} and you are in {pct(need.pct)} of the seasons that go that way.</>
          : <>Even winning all {words(last.more).toLowerCase()} gets you in {pct(last.pct)} of the time — you need help.</>}
      </p>
      <ol className="race__path" aria-label="Your odds by how many more games you win">
        {seen.map((p) => (
          <li key={p.more} data-need={need?.more === p.more || undefined}>
            <span className="race__more">{p.more} more</span>
            <b>{pct(p.pct)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One side's odds either way — or, when the game cannot move them, that. */
function Side({ label, win, lose }: { label: string; win: number; lose: number }) {
  const settled = pct(win) === pct(lose) && (win < 1 || win >= 99.5);
  return (
    <span className="race__side">
      <span className="race__team">{label}</span>{" "}
      {settled
        ? <span className="race__flat">{win < 1 ? "no chance either way" : "in either way"}</span>
        : <><b className="race__up">{pct(win)}</b> win · <b className="race__down">{pct(lose)}</b> loss</>}
    </span>
  );
}

const WORDS = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const words = (n: number) => WORDS[n] ?? String(n);

/** Whole percent, with the ends held off: a simulation cannot back 0 or 100. */
export function pct(v: number): string {
  const r = Math.round(v);
  return r <= 0 ? "<1%" : r >= 100 ? ">99%" : `${r}%`;
}

/** The race in a line, for the front page: you, this week, and a link to the rest. */
export function RaceLine({ race, outlook, myTeamId }: { race: PlayoffRace; outlook: Outlook; myTeamId: string }) {
  if (race.week === null) return null;
  const mine = race.projections.find((p) => p.team_id === myTeamId);
  const stakes = mine && mine.status === null ? stakesFor(race, myTeamId, 1) : null;
  if (!mine || !stakes || stakes.ifWin === null) return null;
  const name = (id: string) => outlook.teams.find((t) => t.id === id)?.name ?? "—";
  const root = stakes.rootFor[0];
  return (
    <section className="card race race--line" aria-label="Your playoff race">
      <div className="card__body race__mine">
        <span className="eyebrow"><Flag size={12} aria-hidden /> Playoff race · week {race.week}</span>
        <p className="race__lead">
          <b>{pct(stakes.now)}</b> now. A win this week: <b className="race__up">{pct(stakes.ifWin)}</b>. A loss: <b className="race__down">{pct(stakes.ifLose ?? 0)}</b>.
        </p>
        {root && (
          <p className="race__root">Also root for <b>{name(root.team_id)}</b> over {name(root.against_id)}.</p>
        )}
        <Link className="club__on race__go" href="/standings">
          The whole race <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
