"use client";

import { useCallback, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { LEAGUE_ID, SEASON } from "@/lib/config";
import { oddsCanSeparate, projectPlayoffs } from "@/lib/playoffs";
import {
  PICKEM_SITTING_OUT, PICKEM_EXTRA_ENTRANTS, PICKEM_BUY_IN, leagueNet, pickemNet, signedDollars,
} from "@/lib/payouts";
import { ordinal } from "@/lib/power";
import type { Outlook, Team } from "@/lib/types";
import type { PickemSeasonStanding } from "@/lib/pickem/types";

/**
 * What the season is on course to pay you, drawn beside your own team's name
 * and nowhere else — not on anybody else's desk, and not on theirs for you.
 *
 * Two pots. The league: the playoff simulation plays the bracket out, every
 * team is put in order of where it finished on average, and that order is the
 * projected finish — first and second get their shares, third gets the
 * buy-in back, everybody else is out $100. The pick'em: whoever leads the
 * season standings now takes the pot (every team owner who is in, plus anybody
 * in it without a team); a manager not in the pick'em has no
 * line for it at all.
 *
 * A projection, and it says so: the place is where the sim has you, not a
 * promise, and the chance of the podium spot is printed under it.
 */
export type Take = {
  total: number;
  league: { place: number; net: number; teams: number; podiumPct: number | null } | null;
  /** Null for a manager who is not in the pick'em. */
  pickem: { rank: number; net: number; pot: number; tied: number } | null;
};

export function useProjectedTake(team: Team | null, teams: Team[], enabled: boolean): Take | null {
  const outlookFetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_playoff_outlook", { p_league_id: LEAGUE_ID });
    if (error) throw error;
    return data as Outlook;
  }, []);
  const { data: outlook } = useLive<Outlook>(outlookFetcher, {
    tables: ["matchups"], channel: "take-outlook", pollMs: 120000, enabled,
  });

  const inPickem = !!team?.owner_id && !PICKEM_SITTING_OUT.has(team.owner_id);
  const pickemFetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_pickem_season_standings", {
      p_league_id: LEAGUE_ID, p_season: SEASON,
    });
    if (error) throw error;
    return (data as PickemSeasonStanding[]) ?? [];
  }, []);
  const { data: season } = useLive<PickemSeasonStanding[]>(pickemFetcher, {
    tables: ["pickem_picks"], channel: "take-pickem", pollMs: 120000, enabled: enabled && inPickem,
  });

  // Four thousand seasons with a bracket on the end — once per outlook, not
  // once per render of the desk.
  const projections = useMemo(
    () => (outlook && oddsCanSeparate(outlook) ? projectPlayoffs(outlook) : null),
    [outlook],
  );

  return useMemo(() => {
    if (!team || !enabled) return null;

    let league: Take["league"] = null;
    if (projections) {
      const order = [...projections].sort((a, b) => a.avg_finish - b.avg_finish);
      const at = order.findIndex((p) => p.team_id === team.id);
      if (at >= 0) {
        const place = at + 1;
        const mine = order[at];
        league = {
          place,
          net: leagueNet(place, projections.length),
          teams: projections.length,
          podiumPct: place <= 3 ? mine.podium_pct[place - 1] : null,
        };
      }
    }

    let pickem: Take["pickem"] = null;
    if (inPickem && season) {
      const entrantIds = new Set([
        ...teams.map((t) => t.owner_id).filter((id): id is string => !!id && !PICKEM_SITTING_OUT.has(id)),
        ...PICKEM_EXTRA_ENTRANTS,
      ]);
      const rows = season.filter((r) => entrantIds.has(r.user_id));
      const me = rows.find((r) => r.user_id === team.owner_id) ?? rows.find((r) => r.mine);
      const pot = PICKEM_BUY_IN * entrantIds.size;
      if (me) {
        const top = Math.max(...rows.map((r) => Number(r.correct)));
        const tied = rows.filter((r) => Number(r.correct) === top).length;
        const rank = 1 + rows.filter((r) => Number(r.correct) > Number(me.correct)).length;
        pickem = { rank, pot, tied: rank === 1 ? tied : 0, net: pickemNet(rank, entrantIds.size, rank === 1 ? tied : 0) };
      } else {
        pickem = { rank: rows.length + 1, pot, tied: 0, net: -PICKEM_BUY_IN };
      }
    }

    if (!league && !pickem) return null;
    return { total: (league?.net ?? 0) + (pickem?.net ?? 0), league, pickem };
  }, [team, teams, enabled, projections, inPickem, season]);
}

const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "even");

/** The pill beside the name, and the breakdown it opens. */
export function ProjectedTake({ take }: { take: Take }) {
  return (
    <details className="take" data-tone={tone(take.total)}>
      <summary title="Projected winnings — only you can see this">
        <span className="take__label">Proj.</span>
        <span className="num">{signedDollars(take.total)}</span>
      </summary>
      <div className="take__sheet" role="note">
        <div className="take__head">Projected take · only you see this</div>
        {take.league && (
          <div className="take__row">
            <div>
              <b>League</b>
              <span>
                Projected {ordinal(take.league.place)} of {take.league.teams}
                {take.league.podiumPct !== null && ` · ${Math.round(take.league.podiumPct)}% to finish there`}
              </span>
            </div>
            <span className="num" data-tone={tone(take.league.net)}>{signedDollars(take.league.net)}</span>
          </div>
        )}
        {take.pickem && (
          <div className="take__row">
            <div>
              <b>Pick&apos;em</b>
              <span>
                {take.pickem.rank === 1
                  ? take.pickem.tied > 1 ? `Tied for 1st (${take.pickem.tied} ways)` : "1st — leading"
                  : `${ordinal(take.pickem.rank)} — winner takes the pot`}
                {` · $${take.pickem.pot} pot`}
              </span>
            </div>
            <span className="num" data-tone={tone(take.pickem.net)}>{signedDollars(take.pickem.net)}</span>
          </div>
        )}
        <div className="take__foot">
          $100 buy-in · 1st 70% / 2nd 30% after 3rd gets $100 back
          {take.pickem && " · Pick'em $20, winner take all"}
        </div>
      </div>
    </details>
  );
}
