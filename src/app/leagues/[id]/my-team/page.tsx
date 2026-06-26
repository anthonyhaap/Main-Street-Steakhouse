import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { LeagueNav } from "@/components/LeagueNav";
import { requireLeagueAccess } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FantasyTeam } from "@/lib/types";
import { MyTeamForm } from "./MyTeamForm";

export default async function MyTeamPage({ params }: { params: { id: string } }) {
  const ctx = await requireLeagueAccess(params.id);
  const supabase = createClient();

  // The team owned by the current user in this league.
  const { data: teamData } = await supabase
    .from("fantasy_teams")
    .select("*")
    .eq("league_id", params.id)
    .eq("owner_id", ctx.userId)
    .maybeSingle();

  const team = teamData as FantasyTeam | null;

  return (
    <div className="min-h-screen">
      <Navbar username={ctx.profile.username} />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold">{ctx.league.name}</h1>
        <LeagueNav leagueId={params.id} isCommissioner={ctx.isCommissioner} active="My Team" />

        {!team ? (
          <div className="card text-slate-600">
            <p className="font-medium">You don&apos;t own a team in this league yet.</p>
            <p className="mt-1 text-sm text-slate-500">
              {ctx.isCommissioner
                ? "Assign yourself a team from the Assign Teams page."
                : "Your commissioner will assign you a team. Check back soon."}
            </p>
            {ctx.isCommissioner && (
              <Link
                href={`/leagues/${params.id}/teams`}
                className="btn-secondary mt-4 inline-flex"
              >
                Go to Assign Teams
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card">
              <p className="text-xs uppercase tracking-wide text-slate-400">Your team</p>
              <p className="text-2xl font-bold text-turf-700">{team.name}</p>
              <p className="mt-1 text-sm text-slate-500">Managed by @{ctx.profile.username}</p>
            </div>

            <div className="card">
              <h2 className="mb-3 text-lg font-semibold">Team settings</h2>
              <MyTeamForm leagueId={params.id} teamId={team.id} currentName={team.name} />
            </div>

            <div className="card">
              <h2 className="mb-2 text-lg font-semibold">Roster</h2>
              <p className="text-sm text-slate-500">
                Your roster is empty. Drafting, waivers, and trades arrive after the invite
                and login system — this is where they&apos;ll live.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
