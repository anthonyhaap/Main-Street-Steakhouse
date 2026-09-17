"use client";

import Link from "next/link";
import { Newspaper, Share2 } from "lucide-react";
import { PowerRankings } from "@/components/standings/PowerRankings";
import { Reactions } from "@/components/house/Reactions";
import { recapHeading, type RecapLine, type RecapRow, type SettledBet, type WireCount } from "@/lib/recap";
import type { Outlook, Reaction } from "@/lib/types";

/**
 * The Weekly Special, as a page.
 *
 * The house writes the week up into the clubhouse, and the column scrolled
 * away by Thursday. This is its address: the push lands here, the reactions
 * under it are the league's verdict on the week, and around it sit the three
 * things the column does not say — where the table moved, how the wire moved,
 * and which bets the week decided — plus your own line, the same one that
 * was pushed.
 *
 * Pure: every fact arrives as a prop, so /preview/recap renders it from a
 * fixture and tests/e2e/recap.spec.ts can read the sentences.
 */
export function RecapPage({
  recap, weeks, outlook, myTeamId, crestOf, mine, reactions, busy, onReact, onShare, wire, settled,
}: {
  recap: RecapRow | null;
  /** Every week the house has written up, newest first. */
  weeks: number[];
  outlook: Outlook | null;
  myTeamId?: string | null;
  crestOf?: (teamId: string) => string | null;
  /** The signed-in seat's own line, when its team played. */
  mine: RecapLine | null;
  reactions: Reaction[];
  busy: boolean;
  onReact?: (emoji: string) => void;
  onShare: () => void;
  wire: WireCount[];
  settled: SettledBet[];
}) {
  if (!recap) {
    return (
      <div className="card">
        <div className="card__head"><h2>The Weekly Special</h2><Newspaper size={17} color="var(--gold)" /></div>
        <div className="empty">
          The house hasn&apos;t written this week up yet.<br />
          The Special is posted the morning after the week&apos;s last game.
        </div>
      </div>
    );
  }

  return (
    <div className="recap">
      <header className="recap__head">
        <div>
          <div className="eyebrow" data-tone="gold">The House · Week {recap.week}</div>
          <h1 className="display recap__h1">{recapHeading(recap).replace(/ · Week \d+$/, "")}</h1>
        </div>
        {weeks.length > 1 && (
          <nav className="segmented" aria-label="Week">
            {weeks.map((w) => (
              <Link key={w} className="segmented__opt" data-on={w === recap.week} href={`/recap/${w}`}>Wk {w}</Link>
            ))}
          </nav>
        )}
      </header>

      <article className="card" data-accent="gold">
        <div className="card__body">
          <p className="special">{recap.body}</p>
          <div className="recap__foot">
            {onReact
              ? <Reactions reactions={reactions} busy={busy} onPress={onReact} />
              : <span />}
            <button className="btn" data-size="sm" onClick={onShare}><Share2 size={14} />Share the Special</button>
          </div>
        </div>
      </article>

      {mine && (
        <section className="card recap__mine" aria-label="Your week">
          <div className="card__body">
            <div className="eyebrow" data-tone="wine">Your week</div>
            <h2 className="recap__line">{mine.title}</h2>
            <p className="prose" style={{ margin: 0 }}>{mine.body}</p>
          </div>
        </section>
      )}

      <PowerRankings outlook={outlook} myTeamId={myTeamId} crestOf={crestOf} />

      <div className="recap__pair">
        <section className="card" aria-label="The wire">
          <div className="card__head"><h2>The wire</h2></div>
          <div className="card__body">
            {wire.length === 0 ? (
              <p className="prose" style={{ margin: 0, color: "var(--dim)" }}>Nobody moved a player this week.</p>
            ) : (
              <div className="recap__badges">
                {wire.map((w) => (
                  <span key={w.kind} className="badge" data-tone="neutral">
                    <span className="num">{w.count}</span> {w.label}
                  </span>
                ))}
              </div>
            )}
            <Link className="club__on" href="/transactions?tab=ledger" style={{ marginTop: "var(--s3)", display: "inline-block" }}>
              The ledger →
            </Link>
          </div>
        </section>

        <section className="card" aria-label="Settled at the table">
          <div className="card__head"><h2>Settled at the table</h2></div>
          <div className="card__body">
            {settled.length === 0 ? (
              <p className="prose" style={{ margin: 0, color: "var(--dim)" }}>No bets rode on this week.</p>
            ) : (
              <ul className="recap__bets">
                {settled.map((b) => (
                  <li key={b.id}>
                    <Link href={`/challenges#${b.id}`}><b>{b.winner}</b> won {b.amount ? `${b.amount} on ` : ""}{b.title.toLowerCase()}</Link>
                    <span className="badge" data-tone={b.status === "settled" ? "ok" : b.status === "voided" ? "neutral" : "warn"} data-size="sm">
                      {b.status === "settled" ? "Paid" : b.status === "voided" ? "Void" : "Owed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
