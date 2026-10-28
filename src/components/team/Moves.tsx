"use client";

import Link from "next/link";
import { ArrowLeftRight, Clock, Gavel, UserPlus } from "lucide-react";
import { when } from "@/lib/waivers";

/**
 * The strip under the hero that says where roster moves are made, and when the
 * one with a deadline is due.
 *
 * Signing, claiming and trading live in the transaction centre, which on a
 * phone is behind More. A manager whose starter just went down is on his desk
 * looking at the hole, and the question he has — "who can I sign, and by
 * when" — was two taps and a tab away with nothing on this screen pointing at
 * it. So the doors are here, on the desk, with the settlement time beside them:
 * the deadline is what decides whether he signs a free agent tonight or files a
 * claim and waits for Wednesday.
 *
 * Presentation only. The live desk asks `useWaiverDeadline` for the moment;
 * the fixture hands in a Wednesday. Null while it is still being asked, and
 * the strip says so rather than guessing a day.
 */
export function RosterMoves({ settlesAt }: { settlesAt: string | null }) {
  return (
    <section className="card moves" aria-label="Roster moves">
      <div className="moves__when">
        <Clock size={16} strokeWidth={2} aria-hidden />
        <span>
          {settlesAt
            ? <>Waivers settle <strong>{when(settlesAt)}</strong></>
            : "Waivers settle weekly"}
          <span className="eyebrow moves__blind">Claims are blind until then</span>
        </span>
      </div>
      <nav className="moves__doors" aria-label="Transactions">
        <Link className="btn" data-size="sm" href="/transactions?tab=players">
          <UserPlus size={13} /> Free agents
        </Link>
        <Link className="btn" data-size="sm" href="/transactions?tab=waivers">
          <Gavel size={13} /> Waiver wire
        </Link>
        <Link className="btn" data-v="ghost" data-size="sm" href="/transactions?tab=trades">
          <ArrowLeftRight size={13} /> Trades
        </Link>
      </nav>
    </section>
  );
}
