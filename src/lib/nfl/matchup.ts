"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import type { HubPlayer } from "@/lib/nfl/types";

/**
 * Whether this week's opponent is a good draw, read out of the projections we
 * already hold.
 *
 * The obvious way to price a matchup is fantasy points allowed by position:
 * take every stat line, join it to the game it came from, and see which
 * defences give up what. We cannot. `player_stat_lines` carries no game id and
 * `nfl_games` holds this season only, so there is no join from a 2025 stat line
 * to the defence that surrendered it. Building one means a new feed, a new
 * table and a cron to keep it, for a number somebody has already worked out.
 *
 * Because somebody has. Sleeper's weekly projection is opponent-aware — it is
 * the whole reason a player's number moves from week to week when his role has
 * not. So a matchup read is already sitting in `player_projections`, in the
 * shape of a curve: eighteen numbers for one player, one per week. Compare the
 * week in front of you against the rest of his own season and you have exactly
 * the question a manager asks. Not "is he good" — the projection says that
 * already — but "is this a better week than his usual, or a worse one".
 *
 * That makes the reading self-relative, which is the property that matters:
 * every player is compared against himself, so a workhorse back and a boom-bust
 * receiver are on the same scale, and no scoring assumption survives the
 * division. `ref_points` is Sleeper's own PPR figure rather than ours, and it
 * cancels.
 *
 * Two guards keep it honest. Weeks he is not expected to play at all — byes,
 * and anything near zero — are left out of the baseline rather than dragging
 * it down. And a player with fewer than six live weeks on file gets no reading
 * at all, because a ratio against three numbers is noise wearing a percentage.
 */

/** player_id → how this week compares with his own season. */
export type MatchupCurve = Map<string, MatchupRead>;

export type MatchupRead = {
  /** This week's projection over his own weekly average. 1.10 is a 10% draw. */
  index: number;
  /** The projection for this week, in the source's scoring. */
  week: number;
  /** His average across the weeks he is expected to play. */
  typical: number;
  /** How many weeks the average is drawn from. */
  weeks: number;
};

/** Below this a projection is a week he isn't playing, not a bad matchup. */
const ALIVE = 1.5;

/** Fewer live weeks than this and the ratio is noise. */
const ENOUGH = 6;

/**
 * The whole season's projections for this roster, folded into one number each.
 *
 * `player_projections` is readable by any league member and the roster is
 * fifteen players, so this is one select of a few hundred rows — cheaper than
 * the hub it sits beside. It rides `useLive` for the same reason everything
 * else does: projections are rewritten daily until kickoff, and a manager who
 * left the tab open on Thursday should not be optimising against Tuesday's.
 */
export function useMatchups(roster: HubPlayer[] | null, season: number | null, week: number | null, enabled = true) {
  const ids = roster ? roster.map((p) => p.player_id).sort().join(",") : "";

  const fetcher = useCallback(async (): Promise<MatchupCurve> => {
    if (!ids || season === null || week === null) return new Map();

    const { data, error } = await supabaseBrowser()
      .from("player_projections")
      .select("player_id,week,ref_points")
      .eq("season", season)
      .eq("season_type", 2)
      .eq("source", "sleeper")
      .in("player_id", ids.split(","));
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { player_id: string; week: number; ref_points: number | null }[];
    const byPlayer = new Map<string, { week: number; points: number }[]>();
    for (const row of rows) {
      const points = Number(row.ref_points ?? 0);
      if (!Number.isFinite(points)) continue;
      const list = byPlayer.get(row.player_id);
      if (list) list.push({ week: row.week, points });
      else byPlayer.set(row.player_id, [{ week: row.week, points }]);
    }

    const curve: MatchupCurve = new Map();
    for (const [playerId, weeks] of byPlayer) {
      const here = weeks.find((w) => w.week === week);
      if (!here || here.points < ALIVE) continue;

      const live = weeks.filter((w) => w.points >= ALIVE);
      if (live.length < ENOUGH) continue;

      const typical = live.reduce((a, w) => a + w.points, 0) / live.length;
      if (typical <= 0) continue;

      curve.set(playerId, {
        index: here.points / typical,
        week: here.points,
        typical,
        weeks: live.length,
      });
    }
    return curve;
  }, [ids, season, week]);

  return useLive<MatchupCurve>(fetcher, {
    tables: ["player_projections"],
    channel: "matchup-curve",
    pollMs: 600000,
    enabled: enabled && !!ids && season !== null && week !== null,
  });
}

/* ------------------------------------------------------------- judgement -- */

export type MatchupJudgement = {
  mult: number;
  label: string;
  detail: string;
};

/**
 * What the curve is worth to a lineup decision.
 *
 * The index is taken at three quarters strength and capped at ±12%. The
 * projection it is derived from is already the baseline being adjusted, so
 * applying the swing in full would count the same opinion twice; the cap stops
 * one strange week — a projection cut on Friday for a reason we cannot see —
 * from rewriting the lineup on its own.
 */
export function matchupJudgement(read: MatchupRead | null | undefined): MatchupJudgement | null {
  if (!read) return null;

  const swing = read.index - 1;
  if (Math.abs(swing) < 0.05) return null;

  const mult = Math.min(1.12, Math.max(0.88, 1 + swing * 0.75));
  const pct = Math.round(Math.abs(swing) * 100);
  const good = swing > 0;

  return {
    mult,
    label: good ? "Good draw" : "Tough draw",
    detail:
      `His week ${good ? "projects" : "projects only"} ${read.week.toFixed(1)} against ` +
      `${read.typical.toFixed(1)} in a typical week — ${pct}% ${good ? "above" : "below"} ` +
      `his own line across ${read.weeks} weeks, which is the projection reading the opponent.`,
  };
}
