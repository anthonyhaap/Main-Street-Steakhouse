"use client";

/**
 * The featured table: the Game of the Week before kickoff, the Game to Watch
 * once football is on, and whichever table the reader picked after that.
 *
 * On a desktop it is the big panel — both lineups, who is on the field, who
 * has the ball, what each side needs. On a phone it is the strip above the
 * tabs: two names, two scores, the split, and a button for the rest.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Seal } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import {
  cardState, fmt1, gameMark, pctLabel, projectedFinal, who, winOdds, leader,
  type ScoreCard, type ScoreSide, type ScoreStarter,
} from "@/lib/scoreboard";
import {
  gameFor, lastName, moodOf, needs, remaining, sideCounts,
  type NflGame, type Phase, type Side,
} from "@/lib/sunday";
import { LiveScore, MoodChip, StateTag } from "./bits";

type Props = {
  card: ScoreCard;
  label: string;
  auto: boolean;
  phase: Phase;
  now: number;
  nfl: NflGame[];
  cards: ScoreCard[];
  onPick: (id: string | null) => void;
};

export function Featured({ card, label, auto, phase, now, nfl, cards, onPick }: Props) {
  const state = cardState(card);
  const pre = state === "pre";
  const odds = winOdds(card);
  const lead = leader(card);
  const [open, setOpen] = useState(false);

  // A lead that changes hands while you watch lights the new leader once. It
  // is keyed to the table, so switching tables is not a lead change.
  const seen = useRef<{ id: string; lead: Side | null } | null>(null);
  const [flash, setFlash] = useState<{ key: Side; n: number } | null>(null);
  useEffect(() => {
    const was = seen.current;
    if (was && was.id === card.id && was.lead && lead && was.lead !== lead && !pre) {
      setFlash((f) => ({ key: lead, n: (f?.n ?? 0) + 1 }));
    }
    seen.current = { id: card.id, lead };
  }, [card.id, lead, pre]);

  return (
    <section id="sun-featured" className="sun-feat" data-panel="featured" data-open={open} aria-label="Featured matchup">
      <div className="sun-feat__label">
        <b>{auto ? (phase === "live" ? "🔥 " : "🏆 ") + label : "Your pick"}</b>
        <div className="sun-pick scroll" role="group" aria-label="Switch matchup">
          {!auto && <button type="button" onClick={() => onPick(null)}>{label}</button>}
          {cards.map((c) => (
            <button
              key={c.id} type="button"
              data-on={c.id === card.id}
              data-live={cardState(c) === "live"}
              aria-pressed={c.id === card.id}
              onClick={() => onPick(c.id)}
            >
              {who(c.away)} v {who(c.home)}
            </button>
          ))}
        </div>
      </div>

      <div className="sun-score">
        <TeamBlock s={card.away} k="away" card={card} pre={pre} lead={lead} phase={phase}
          flash={flash?.key === "away" ? flash.n : 0} />
        <div className="sun-mid">
          <StateTag state={state} />
          {pre ? (
            <span className="sun-mid__vs">Projected</span>
          ) : (
            <div className="sun-odds">
              <div className="sun-odds__nums">
                <span>{pctLabel(odds.away)}</span>
                <span>{pctLabel(odds.home)}</span>
              </div>
              <div
                className="sun-odds__bar" role="img"
                aria-label={`Win probability: ${who(card.away)} ${pctLabel(odds.away)}, ${who(card.home)} ${pctLabel(odds.home)}`}
              >
                <span style={{ width: `${odds.away}%` }} />
                <span style={{ width: `${odds.home}%` }} />
              </div>
              <span className="sun-odds__cap">{odds.settled ? "Final" : "Win probability"}</span>
            </div>
          )}
        </div>
        <TeamBlock s={card.home} k="home" card={card} pre={pre} lead={lead} phase={phase}
          flash={flash?.key === "home" ? flash.n : 0} />
      </div>

      <button type="button" className="sun-btn sun-feat__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ marginTop: "var(--s3)", width: "100%", justifyContent: "center" }}>
        {open ? "Hide lineups" : "Lineups"} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      <div className="sun-feat__detail">
        {!pre && state !== "settled" && (
          <div className="sun-path">
            <Path card={card} k="away" nfl={nfl} />
            <Path card={card} k="home" nfl={nfl} />
          </div>
        )}
        <div className="sun-lineups">
          <Lineup s={card.away} now={now} nfl={nfl} />
          <Lineup s={card.home} now={now} nfl={nfl} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link className="sun-btn" href={`/matchups/${card.id}?week=${card.week}`}>Full matchup</Link>
        </div>
      </div>
    </section>
  );
}

function TeamBlock({ s, k, card, pre, lead, phase, flash }: {
  s: ScoreSide; k: Side; card: ScoreCard; pre: boolean; lead: Side | null; phase: Phase; flash: number;
}) {
  const c = sideCounts(s);
  const pf = projectedFinal(s);
  return (
    <div key={flash} className="sun-team" data-key={k} data-lead={lead === null ? undefined : lead === k}
      data-flash={flash > 0}>
      <div className="sun-team__id">
        <Seal name={s.name} src={crestUrl(s.logo_path)} mine={s.mine} size={40} />
        <span className="sun-team__names">
          <span className="sun-team__who">{who(s)}{s.mine ? " · You" : ""}</span>
          <span className="sun-team__sub">{s.name} · {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}</span>
        </span>
      </div>
      {pre
        ? <span className="sun-team__pts">{fmt1(s.proj)}</span>
        : <LiveScore value={Number(s.points)} className="sun-team__pts" />}
      <span className="sun-team__proj">
        {pre ? "Projected" : <>Projected <b>{fmt1(pf)}</b></>}
      </span>
      {!pre && (
        <span className="sun-team__counts">
          {c.on > 0 && <><em>{c.on} playing</em> · </>}
          {c.toCome} to come · {c.done} done
        </span>
      )}
      {phase !== "pre" && <MoodChip mood={moodOf(card, k)} />}
    </div>
  );
}

/** "Needs about 11.7 more" and who is left to get it. Never a promise. */
function Path({ card, k, nfl }: { card: ScoreCard; k: Side; nfl: NflGame[] }) {
  const s = k === "home" ? card.home : card.away;
  const them = k === "home" ? card.away : card.home;
  const need = needs(card, k);
  const left = remaining(s);
  return (
    <div className="sun-path__side">
      <h3>{who(s)}</h3>
      {need !== null
        ? <span>Needs about <b>{fmt1(need)}</b> more to pass {who(them)}&apos;s projected {fmt1(projectedFinal(them))}.</span>
        : left.length > 0
          ? <span>On course: projected <b>{fmt1(projectedFinal(s))}</b>.</span>
          : <span>Done for the day on <b>{fmt1(s.points)}</b>.</span>}
      {left.length > 0 && (
        <span>
          {left.length} left: {left.map((p) => {
            const g = gameFor(nfl, p.nfl_team);
            const when = p.game_status === "in" ? (p.game_detail ?? g?.detail ?? "live") : null;
            return `${lastName(p.full_name)}${when ? ` (${when})` : ""}`;
          }).join(", ")}
        </span>
      )}
    </div>
  );
}

function Lineup({ s, now, nfl }: { s: ScoreSide; now: number; nfl: NflGame[] }) {
  return (
    <div className="sun-lu" aria-label={`${who(s)}'s lineup`}>
      {s.starters.map((p) => <Row key={p.player_id} p={p} now={now} nfl={nfl} />)}
    </div>
  );
}

function Row({ p, now, nfl }: { p: ScoreStarter; now: number; nfl: NflGame[] }) {
  const mark = gameMark(p, now);
  const g = gameFor(nfl, p.nfl_team);
  const ball = p.game_status === "in" && g?.status === "in" && g.possession === p.nfl_team;
  const rz = ball && g!.red_zone && p.position !== "DST" && p.position !== "K";
  return (
    <div className="sun-lu__row" data-state={mark.state} data-rz={rz}>
      <span className="sun-lu__slot">{p.slot}</span>
      <span className="sun-lu__name">
        <b>{p.full_name}</b>
        <span>{p.position} · {p.nfl_team ?? "FA"}{ball && <span className="sun-ball" title="Has the ball"> · 🏈</span>}</span>
      </span>
      <span className="sun-lu__game">{mark.label}{mark.detail ? ` ${mark.detail}` : ""}</span>
      <span className="sun-lu__pts">{mark.state === "pre" ? fmt1(p.projection) : fmt1(p.points)}</span>
    </div>
  );
}
