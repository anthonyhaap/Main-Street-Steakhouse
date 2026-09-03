import Link from "next/link";
import { Crest } from "@/components/Shell";
import { shareName, type ShareCard } from "@/lib/share";

/**
 * The card that lands in the group chat, as a page. Ink, gold hairlines,
 * two names and two numbers, and the player who decided it. Pure: the share
 * route hands it the anon read, the fixture hands it an invented game.
 */
export function ShareCardView({ c }: { c: ShareCard }) {
  const started = c.home.points + c.away.points > 0;
  const homeLead = c.home.points >= c.away.points;
  const label = started ? (c.final ? "Final" : "Live") : "Projected";

  return (
    // The shell keeps room for a tab bar this page never shows; take it back
    // so the ink runs to the bottom edge.
    <main className="sharepage ink" style={{ borderRadius: 0, marginBottom: "calc(-1 * var(--bottom-nav))" }}>
      <section className="sharecard ink">
        <Crest size={44} />
        <span className="eyebrow">{c.league} · Week {c.week} · {label}</span>
        <h1>{shareName(c.home)} vs. {shareName(c.away)}</h1>
        <i className="hairline" style={{ width: "70%" }} />
        <div className="sharecard__nums">
          <div className="sharecard__side" data-lead={started && homeLead}>
            <b className="num">{Number(c.home.points).toFixed(1)}</b>
            <span>{c.home.name}</span>
            {c.home.manager && <i>{c.home.manager}</i>}
          </div>
          <span className="sharecard__vs">vs</span>
          <div className="sharecard__side" data-lead={started && !homeLead}>
            <b className="num">{Number(c.away.points).toFixed(1)}</b>
            <span>{c.away.name}</span>
            {c.away.manager && <i>{c.away.manager}</i>}
          </div>
        </div>
        {c.top && (
          <p>Tonight&apos;s Specials: {c.top.full_name}, {Number(c.top.points).toFixed(1)} points for {c.top.team}.</p>
        )}
        <i className="hairline" style={{ width: "70%" }} />
        <Link href="/" className="sharecard__cta">Open the league →</Link>
        <span className="eyebrow" style={{ color: "#7a6f5e" }}>Main Street Steakhouse · Est. 2016 · Members Only</span>
      </section>
    </main>
  );
}
