"use client";

/**
 * One manager's career, opened from his card on the wall.
 *
 * The cards were the end of the road: twelve summaries and nowhere to go from
 * any of them. Everything here was already on the client — `ff_history` brings
 * down the champions, the grid and the record weeks, and the page fetches the
 * historical standings beside it — so this adds no request and no table. It is
 * the same numbers, read down a column instead of across a row.
 *
 * Rendered inline under the cards rather than in a modal. A career is
 * something two people read together over a table, and a dialog that dims the
 * league behind it is the wrong shape for that. It is also addressable —
 * `/history?manager=Ada` — because "look at his record" is a thing said in a
 * group chat, with a link.
 */

import { X } from "lucide-react";
import { crestUrl } from "@/lib/crest";
import { Seal } from "@/components/ui";
import { titleOf, type History } from "@/lib/history";
import { recordOf, type ManagerProfile as Profile, type Trophy } from "@/lib/profile";
import type { Monster, SundayLine, Swing } from "@/lib/sundayline";

export function ManagerProfileCard({ profile, history, mine, onClose, sundays = null }: {
  profile: Profile;
  history: History;
  mine: boolean;
  onClose: () => void;
  /** `sundayLine` for his current team: absent until the league has stored a Sunday he played. */
  sundays?: SundayLine | null;
}) {
  const m = profile.manager;
  const games = m.wins + m.losses + m.ties;

  return (
    <section className="prof" aria-label={`${m.manager}'s career`}>
      <header className="prof__head">
        <Seal name={m.current_team ?? m.manager} src={crestUrl(m.logo_path)} mine={mine} size={44} />
        <div style={{ minWidth: 0 }}>
          <h2>{m.manager}</h2>
          <p className="prof__sub">
            {m.current_team ?? "Not at the table this year"} · {m.seasons} season{m.seasons === 1 ? "" : "s"} ·{" "}
            <span className="num">{recordOf(m)}</span>
            {games > 0 && <> · <span className="num">{Number(m.avg).toFixed(1)}</span> a week</>}
          </p>
        </div>
        <button className="btn" data-size="icon" onClick={onClose} aria-label="Close the profile">
          <X size={15} />
        </button>
      </header>

      <p className="prof__title">{titleOf(m, history.managers)}</p>

      {/* ------------------------------------------------- the cabinet -- */}
      <div className="prof__block">
        <span className="eyebrow">The cabinet</span>
        {profile.trophies.length === 0 ? (
          <p className="prof__empty">
            Nothing in it yet. {m.seasons <= 1 ? "First season." : "Still looking."}
          </p>
        ) : (
          <ul className="prof__cab">
            {profile.trophies.map((t) => <TrophyRow key={t.kind} t={t} />)}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------- the years -- */}
      {profile.seasons.length > 0 && (
        <div className="prof__block">
          <span className="eyebrow">Season by season</span>
          <div className="scroll" style={{ overflowX: "auto" }}>
            <table className="prof__tbl">
              <thead>
                <tr>
                  <th scope="col" className="eyebrow">Year</th>
                  <th scope="col" className="eyebrow" style={{ textAlign: "left" }}>Team</th>
                  <th scope="col" className="eyebrow">W–L</th>
                  <th scope="col" className="eyebrow">PF</th>
                  <th scope="col" className="eyebrow">Finish</th>
                </tr>
              </thead>
              <tbody>
                {profile.seasons.map((s) => (
                  <tr key={s.season}>
                    <td className="num">{s.season}</td>
                    <td>{s.team_name ?? "—"}</td>
                    <td className="num">
                      {s.wins === null ? "—" : `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`}
                    </td>
                    <td className="num">{s.points_for === null ? "—" : Number(s.points_for).toFixed(0)}</td>
                    <td className="num">
                      {s.outcome === "champion" && <b className="prof__won">Won it</b>}
                      {s.outcome === "runner_up" && <span className="prof__lost">Lost the final</span>}
                      {!s.outcome && (s.finish === null
                        ? <span style={{ color: "var(--faint)" }}>—</span>
                        : <>{s.finish}{s.of ? ` of ${s.of}` : ""}</>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- the grid -- */}
      {profile.h2h.length > 0 && (
        <div className="prof__block">
          <span className="eyebrow">Against the league</span>
          {(profile.owns || profile.owned_by) && (
            <p className="prof__owns">
              {profile.owns && (
                <>Owns <b>{profile.owns.opponent}</b>, <span className="num">{recordOf(profile.owns)}</span>.{" "}</>
              )}
              {profile.owned_by && (
                <><b>{profile.owned_by.opponent}</b> owns him,{" "}
                  <span className="num">{recordOf({
                    wins: profile.owned_by.losses,
                    losses: profile.owned_by.wins,
                    ties: profile.owned_by.ties,
                  })}</span>.</>
              )}
            </p>
          )}
          <ul className="prof__h2h">
            {profile.h2h.map((c) => (
              <li key={c.opponent}>
                <span>{c.opponent}</span>
                <b className="num" data-tone={c.wins > c.losses ? "up" : c.wins < c.losses ? "down" : undefined}>
                  {recordOf(c)}
                </b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------- on Sundays -- */}
      {sundays && <OnSundays line={sundays} />}

      {/* -------------------------------------------------- the extras -- */}
      {(m.best_week || profile.best_run) && (
        <div className="prof__block prof__notes">
          {m.best_week && (
            <span>
              Best week <b className="num">{Number(m.best_week.points).toFixed(1)}</b>
              {" "}· {m.best_week.season} week {m.best_week.week}
            </span>
          )}
          {profile.best_run && (
            <span>
              Longest run <b className="num">{profile.best_run.n} straight</b>
              {" "}· {profile.best_run.from.season === profile.best_run.to.season
                ? `${profile.best_run.from.season}, weeks ${profile.best_run.from.week}–${profile.best_run.to.week}`
                : `${profile.best_run.from.season} → ${profile.best_run.to.season}`}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

const wk = (x: { season: number; week: number }) => `${x.season} week ${x.week}`;
const pts = (n: number) => n.toFixed(1);

/**
 * What the game center saw him do, and have done to him: the half of a Sunday
 * line the wall's table leaves out. Counts in a row; under them, the one of
 * each worth a sentence.
 */
function OnSundays({ line }: { line: SundayLine }) {
  const come: Swing | undefined = line.comebacks[0];
  const blown: Swing | undefined = line.blown[0];
  const best: Monster | undefined = line.monsters[0];
  const stats: [string, number, string?][] = [
    ["Leads taken", line.took],
    ["Leads lost", line.lost],
    ["Taken late", line.late, "lead changes the game center marked late"],
    ["Comebacks", line.comebacks.length],
    ["Blown leads", line.blown.length, "comebacks made on him"],
    ["Monster games", line.monsters.length],
  ];
  return (
    <div className="prof__block" aria-label="On Sundays">
      <span className="eyebrow">On Sundays · {line.sundays} on record</span>
      <dl className="prof__sun">
        {stats.map(([label, n, hint]) => (
          <div key={label} title={hint}>
            <dt>{label}</dt>
            <dd className="num">{n}</dd>
          </div>
        ))}
      </dl>
      {(come || blown || best) && (
        <ul className="prof__sunlines">
          {come && <li>Deepest comeback: <b className="num">{pts(come.down)}</b> down against {come.opp}, {wk(come)}.</li>}
          {blown && <li>Worst collapse: <b className="num">{pts(blown.down)}</b> up on {blown.who}, and lost the lead, {wk(blown)}.</li>}
          {best && <li>Biggest game: {best.player}, <b className="num">{pts(best.points)}</b>, {wk(best)}.</li>}
        </ul>
      )}
    </div>
  );
}

function TrophyRow({ t }: { t: Trophy }) {
  return (
    <li className="prof__trophy" data-good={t.good}>
      <b>{t.label}</b>
      <span className="num">{t.years.join(", ")}</span>
    </li>
  );
}
