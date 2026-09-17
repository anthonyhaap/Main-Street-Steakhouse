"use client";

import { useCallback, useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { RecapPage } from "@/components/recap/RecapPage";
import { LEAGUE_ID, SITE_URL } from "@/lib/config";
import { useLive } from "@/lib/live";
import { recapShareText, recapWeekOutlook, settledThisWeek, wireCounts, type RecapLine, type RecapRow } from "@/lib/recap";
import { useCrests, useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Challenge, Outlook, Reaction } from "@/lib/types";

/**
 * The live page around RecapPage. One fetch gathers the column, the outlook
 * for the table, the week's moves, the bets it decided, the reactions on the
 * house post and the signed-in seat's own line; the realtime watch refetches
 * when a recap lands or somebody reacts.
 */

type Data = {
  recap: RecapRow | null;
  weeks: number[];
  outlook: Outlook | null;
  wire: { kind: string }[];
  challenges: Pick<Challenge, "id" | "title" | "status" | "winner_id" | "resolved_at" | "stake_amount_cents">[];
  reactions: Reaction[];
  mine: RecapLine | null;
};

const firstName = (s: string | null | undefined) => s?.trim().split(/\s+/)[0] || null;

export function RecapScreen({ week }: { week: number | null }) {
  const { ready, team, teams } = useSession();
  const crestOf = useCrests();
  const toast = useToast();
  const [reacting, setReacting] = useState(false);

  const fetcher = useCallback(async (): Promise<Data> => {
    const sb = supabaseBrowser();
    const recaps = await sb.from("league_recaps").select("week,body,created_at,message_id")
      .eq("league_id", LEAGUE_ID).order("week", { ascending: false });
    if (recaps.error) throw recaps.error;
    const rows = (recaps.data ?? []) as RecapRow[];
    const recap = week ? rows.find((r) => r.week === week) ?? null : rows[0] ?? null;

    const [outlook, wire, challenges, reactions, mine] = await Promise.all([
      sb.rpc("ff_playoff_outlook", { p_league_id: LEAGUE_ID }),
      recap
        ? sb.from("transactions").select("kind").eq("league_id", LEAGUE_ID).eq("week", recap.week)
        : Promise.resolve({ data: [], error: null }),
      sb.from("challenges").select("id,title,status,winner_id,resolved_at,stake_amount_cents")
        .eq("league_id", LEAGUE_ID).not("resolved_at", "is", null),
      recap?.message_id
        ? sb.rpc("ff_reactions_for", { p_source: "message", p_target: recap.message_id })
        : Promise.resolve({ data: [], error: null }),
      recap && team
        ? sb.rpc("ff_personal_recap_line", { p_league_id: LEAGUE_ID, p_week: recap.week, p_team_id: team.id })
        : Promise.resolve({ data: null, error: null }),
    ]);
    const failure = outlook.error ?? wire.error ?? challenges.error ?? reactions.error ?? mine.error;
    if (failure) throw failure;

    return {
      recap, weeks: rows.map((r) => r.week),
      outlook: (outlook.data as Outlook) ?? null,
      wire: (wire.data ?? []) as { kind: string }[],
      challenges: (challenges.data ?? []) as Data["challenges"],
      reactions: (reactions.data ?? []) as Reaction[],
      mine: (mine.data as RecapLine | null) ?? null,
    };
  }, [week, team]);

  const { data, status, refetch } = useLive<Data>(fetcher, {
    tables: ["league_recaps", "reactions", "matchups"], channel: "recap", pollMs: 60000, enabled: ready,
  });

  const nameOf = useCallback((id: string | null) => {
    const seat = teams.find((t) => t.owner_id === id);
    return firstName(seat?.manager_name) ?? seat?.name ?? "Somebody";
  }, [teams]);

  const view = useMemo(() => {
    if (!data?.recap) return null;
    return {
      outlook: data.outlook ? recapWeekOutlook(data.outlook, data.recap.week) : null,
      wire: wireCounts(data.wire),
      settled: settledThisWeek(data.challenges, data.recap.created_at, nameOf),
    };
  }, [data, nameOf]);

  const react = useCallback(async (emoji: string) => {
    if (!data?.recap?.message_id) return;
    setReacting(true);
    const { error } = await supabaseBrowser().rpc("ff_react", {
      p_league_id: LEAGUE_ID, p_source: "message", p_target_id: data.recap.message_id, p_emoji: emoji,
    });
    setReacting(false);
    if (error) toast("error", error.message);
    await refetch();
  }, [data, refetch, toast]);

  const share = useCallback(async () => {
    if (!data?.recap) return;
    const origin = typeof location !== "undefined" && location.origin.startsWith("http") ? location.origin : SITE_URL;
    const text = recapShareText(data.recap, origin);
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast("ok", "Copied. Paste it in the chat.");
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast("error", "Couldn't open the share sheet.");
    }
  }, [data, toast]);

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        {!data ? (
          <div className="card"><SkeletonRows n={8} /></div>
        ) : (
          <RecapPage
            recap={data.recap} weeks={data.weeks}
            outlook={view?.outlook ?? null} myTeamId={team?.id} crestOf={crestOf}
            mine={data.mine} reactions={data.reactions} busy={reacting}
            onReact={data.recap?.message_id ? react : undefined} onShare={share}
            wire={view?.wire ?? []} settled={view?.settled ?? []}
          />
        )}
      </main>
    </>
  );
}
