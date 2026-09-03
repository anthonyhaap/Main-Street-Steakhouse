"use client";

import Link from "next/link";
import { ArrowRight, Share2 } from "lucide-react";
import { Seal, fmtPts, useCountUp } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import {
  action, fmtKick, headline, narrative, ordinal, phaseOf, until, weekdayIn, who,
  type Briefing, type BriefStarter, type Phase,
} from "@/lib/briefing";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type Flash = "up" | "dim" | null;

/**
 * The reservation card. One tall card, typeset like a menu: who you're
 * playing, whether you're winning, and the one thing to do. Pure function of
 * the briefing and the clock, so the fixture page can show every day of the
 * week from one payload.
 */
export function TonightsTable({ b, now, flash = null, onShare }: {
  b: Briefing;
  now: number;
  /** A live tick: gold when your number moved, dim when his did. */
  flash?: Flash;
  onShare?: () => void;
}) {
  const phase = phaseOf(b, now);
  const h = headline(b, phase);
  const line = narrative(b, phase, now);
  const act = action(b, phase);
  const day = DAY[weekdayIn(now)];

  return (
    <section className="tt" data-phase={phase} aria-label="Tonight's table">
      <i className="tt__rule" data-i="0" />
      <p className="tt__eyebrow eyebrow" data-i="1">
        <span>{h.eyebrow}</span>
        <span className="tt__day">{day}</span>
      </p>
      <h1 className="tt__title display" data-i="2">{h.title}</h1>
      {h.sub && <p className="tt__sub" data-i="2">{h.sub}</p>}

      <Numbers b={b} phase={phase} flash={flash} now={now} />

      <i className="tt__rule" data-i="4" />
      <p className="tt__line" data-i="5">{line}</p>

      <StillToPlay b={b} phase={phase} now={now} />

      <i className="tt__rule" data-i="6" />
      {act && (
        act.kind === "share" ? (
          <button type="button" className="tt__action" data-i="7" onClick={onShare}>
            <span>{act.label}</span><Share2 size={16} />
          </button>
        ) : (
          <Link href={act.href ?? "/"} className="tt__action" data-i="7" data-urgent={act.urgent}>
            <span>{act.label}</span><ArrowRight size={16} />
          </Link>
        )
      )}
    </section>
  );
}

/* --------------------------------------------------------------- numbers -- */

function Numbers({ b, phase, flash, now }: { b: Briefing; phase: Phase; flash: Flash; now: number }) {
  if (phase === "unlinked") return <div className="tt__nums" data-i="3" />;

  if (phase === "draft" && b.draft) {
    const d = b.draft;
    const left = d.pick_deadline ? Math.max(0, Math.round((new Date(d.pick_deadline).getTime() - now) / 1000)) : null;
    return (
      <div className="tt__nums" data-i="3">
        <Side name="Pick" sub={`of ${d.picks_total}`} value={d.current_pick} decimals={0} lead plain />
        <span className="tt__vs eyebrow">{d.status}</span>
        <Side name="Clock" sub={d.status === "active" ? "seconds" : "paused"} value={left ?? 0} decimals={0} align="end" plain />
      </div>
    );
  }

  if (phase === "recap" && b.last) {
    const l = b.last;
    const me = b.me!;
    return (
      <div className="tt__nums" data-i="3">
        <Side name={me.name} sub={record(me)} crest={crestUrl(me.logo_path)} mine value={l.my_points} lead={l.my_points >= l.opp_points} label="final" />
        <span className="tt__vs eyebrow">final</span>
        <Side name={l.opponent.name} sub={who(l.opponent)} crest={crestUrl(l.opponent.logo_path)} value={l.opp_points} lead={l.opp_points > l.my_points} align="end" label="final" />
      </div>
    );
  }

  const m = b.matchup;
  const me = b.me;
  if (!m || !me) {
    return (
      <div className="tt__nums" data-i="3">
        {me && <Side name={me.name} sub={record(me)} crest={crestUrl(me.logo_path)} mine value={Number(me.points_for ?? 0)} label="points for" lead />}
      </div>
    );
  }

  const started = m.my_points + m.opp_points > 0 || phase === "live" || phase === "monday" || phase === "settled";
  const mine = started ? m.my_points : m.my_proj;
  const theirs = started ? m.opp_points : m.opp_proj;
  const label = phase === "settled" ? "final" : started ? "live" : "proj.";
  return (
    <div className="tt__nums" data-i="3" data-flash={flash ?? undefined}>
      <Side name={me.name} sub={record(me)} crest={crestUrl(me.logo_path)} mine
        value={mine} lead={mine >= theirs} label={label} proj={started ? m.my_proj : null} />
      <span className="tt__vs eyebrow">{m.home ? "home" : "away"}</span>
      <Side name={m.opponent.name} sub={record(m.opponent, who(m.opponent))} crest={crestUrl(m.opponent.logo_path)}
        value={theirs} lead={theirs > mine} align="end" label={label} proj={started ? m.opp_proj : null} />
    </div>
  );
}

function record(t: { wins: number; losses: number; ties: number; seed: number | null }, prefix?: string) {
  const rec = `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ""}`;
  const seed = t.seed ? ` · ${ordinal(t.seed)}` : "";
  return prefix ? `${prefix} · ${rec}${seed}` : `${rec}${seed}`;
}

function Side({ name, sub, crest = null, mine = false, value, decimals = 1, lead = false, align = "start", label, proj, plain = false }: {
  name: string; sub?: string; crest?: string | null; mine?: boolean;
  value: number; decimals?: number; lead?: boolean; align?: "start" | "end";
  label?: string; proj?: number | null;
  /** A number with a caption, not a team: no seal. */
  plain?: boolean;
}) {
  const shown = useCountUp(Number(value));
  return (
    <div className="tt__side" data-align={align} data-lead={lead}>
      <div className="tt__who">
        {!plain && <Seal name={name} src={crest} mine={mine} size={34} />}
        <span>
          <b>{name}</b>
          {sub && <i>{sub}</i>}
        </span>
      </div>
      <b className="tt__num num">{shown.toFixed(decimals)}</b>
      {(label || proj != null) && (
        <span className="tt__numlabel eyebrow">
          {label}{proj != null && proj > 0 ? ` · proj. ${fmtPts(proj)}` : ""}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------- still to play -- */

/** Who still has a game left, mine by name, his by count. */
function StillToPlay({ b, phase, now }: { b: Briefing; phase: Phase; now: number }) {
  const m = b.matchup;
  if (!m || (phase !== "live" && phase !== "monday")) return null;
  const mine = m.my_starters.filter((p) => !p.final);
  const theirs = m.opp_starters.filter((p) => !p.final);
  if (mine.length === 0 && theirs.length === 0) return null;
  return (
    <div className="tt__left" data-i="5">
      <span className="eyebrow">Still to play</span>
      <ul>
        {mine.slice(0, 5).map((p) => <li key={p.player_id}><Starter p={p} now={now} /></li>)}
        {mine.length > 5 && <li className="tt__more">+{mine.length - 5} more</li>}
        {mine.length === 0 && <li className="tt__more">Nobody. You&apos;re done.</li>}
      </ul>
      <span className="tt__theirs">
        {who(m.opponent)}: {theirs.length === 0 ? "done" : `${theirs.length} left`}
        {theirs.length > 0 && theirs.length <= 2 && ` (${theirs.map((p) => p.full_name.split(" ").slice(-1)[0]).join(", ")})`}
      </span>
    </div>
  );
}

function Starter({ p, now }: { p: BriefStarter; now: number }) {
  const live = p.game_status === "in";
  return (
    <>
      <span className="pos" data-p={p.slot}>{p.slot}</span>
      <b>{p.full_name}</b>
      <span className="tt__when">
        {live ? `${fmtPts(p.points)} · live` : p.kickoff_at ? `${fmtKick(p.kickoff_at)} · ${until(p.kickoff_at, now)}` : "—"}
      </span>
      <span className="num tt__proj">{p.projection != null ? fmtPts(p.projection) : "—"}</span>
    </>
  );
}

/* -------------------------------------------------------------- skeleton -- */

/** The card's exact silhouette, so the reveal never shifts a pixel. */
export function TonightSkeleton() {
  return (
    <section className="tt" data-skeleton="true" aria-hidden>
      <i className="tt__rule" />
      <p className="tt__eyebrow"><span className="skel" style={{ width: 120, height: 11 }} /><span className="skel" style={{ width: 54, height: 11 }} /></p>
      <div className="tt__title"><span className="skel" style={{ display: "block", width: "62%", height: "1em" }} /></div>
      <div className="tt__nums">
        <div className="tt__side"><div className="tt__who"><span className="skel" style={{ width: 34, height: 34, borderRadius: "50%" }} /><span className="skel" style={{ width: 110, height: 14 }} /></div><span className="skel" style={{ width: 128, height: 56 }} /></div>
        <span className="tt__vs" />
        <div className="tt__side" data-align="end"><div className="tt__who"><span className="skel" style={{ width: 110, height: 14 }} /><span className="skel" style={{ width: 34, height: 34, borderRadius: "50%" }} /></div><span className="skel" style={{ width: 128, height: 56 }} /></div>
      </div>
      <i className="tt__rule" />
      <p className="tt__line"><span className="skel" style={{ display: "block", width: "88%", height: 16 }} /></p>
      <i className="tt__rule" />
      <div className="tt__action"><span className="skel" style={{ width: 180, height: 14 }} /></div>
    </section>
  );
}
