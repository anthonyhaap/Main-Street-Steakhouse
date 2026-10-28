"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { supabaseBrowser } from "@/lib/supabase/client";
import { closesLabel, deadlinePhase, inPlay, timeLeft, type TradeDeadline } from "@/lib/deadline";

/**
 * The trade deadline, on the front page, in the week it matters.
 *
 * Silent for most of the season — a deadline five weeks out is a fact for the
 * trade desk, not news. From the start of the deadline week it says when the
 * market shuts, on the league's clock, and what is still in play: the offers
 * waiting on you first, because those are the ones only you can answer.
 *
 * Presentation only; `DeadlineSoon` is the live wrapper.
 */
export function DeadlineCard({ d, now }: { d: TradeDeadline; now: number }) {
  const phase = deadlinePhase(d, now);
  if ((phase !== "week" && phase !== "day") || !d.closes_at) return null;
  const parts = inPlay(d);
  return (
    <section className="card tdl" data-phase={phase} aria-label="Trade deadline">
      <div className="card__head">
        <span className="eyebrow tdl__eyebrow"><ArrowLeftRight size={13} aria-hidden /> Trade deadline</span>
        <span className="tdl__left">{phase === "day" ? "Last day · " : ""}{timeLeft(d.closes_at, now)} left</span>
      </div>
      <div className="card__body tdl__body">
        <p className="tdl__line">
          Trades close <b>{closesLabel(d.closes_at, now)}</b>, after Monday night&apos;s game.
        </p>
        <p className="tdl__play">
          {parts.length > 0 ? parts.join(" · ") : "Nothing on the table and nobody on the block yet."}
        </p>
        <Link className="club__on tdl__go" href="/transactions?tab=trades">
          {d.waiting ? "Answer your offers" : "Open the trade desk"} <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export function DeadlineSoon({ teamId, now, enabled }: { teamId: string | null; now: number; enabled: boolean }) {
  const fetcher = useCallback(async (): Promise<TradeDeadline | null> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_trade_deadline", { p_league_id: LEAGUE_ID, p_team_id: teamId });
    // Not worth a broken front page: no answer means no card.
    if (error) return null;
    return data as TradeDeadline;
  }, [teamId]);

  const { data } = useLive<TradeDeadline | null>(fetcher, {
    tables: ["trades", "trade_block"],
    channel: "tonight-deadline",
    pollMs: 5 * 60_000,
    enabled,
  });

  return data ? <DeadlineCard d={data} now={now} /> : null;
}
