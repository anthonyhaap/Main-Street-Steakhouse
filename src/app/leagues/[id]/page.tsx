import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { LeagueNav } from "@/components/LeagueNav";
import { RoleBadge } from "@/components/RoleBadge";
import { requireLeagueAccess } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FantasyTeam, MemberRole, Profile } from "@/lib/types";

interface MemberRow {
  user_id: string;
  role: MemberRole;
  team_id: string | null;
  profiles: Pick<Profile, "username"> | null;
}

export default async function LeagueDashboard({ params }: { params: { id: string } }) {
  const ctx = await requireLeagueAccess(params.id);
  const supabase = createClient();

  const [{ data: teamsData }, { data: membersData }] = await Promise.all([
    supabase.from("fantasy_teams").select("*").eq("league_id", params.id).order("name"),
    supabase
      .from("league_members")
      .select("user_id, role, team_id, profiles(username)")
      .eq("league_id", params.id),
  ]);

  const teams = (teamsData ?? []) as FantasyTeam[];
  const members = (membersData ?? []) as unknown as MemberRow[];
  const ownerByTeam = new Map<string, string>();
  members.forEach((m) => {
    if (m.team_id && m.profiles) ownerByTeam.set(m.team_id, m.profiles.username);
  });

  const claimed = teams.filter((t) => t.owner_id).length;

  return (
    <div className="min-h-screen">
      <Navbar username={ctx.profile.username} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:underline">
          ← All leagues
        </Link>
        <div className="mb-4 mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{ctx.league.name}</h1>
            {ctx.league.season && (
              <p className="text-sm text-slate-400">Season {ctx.league.season}</p>
            )}
          </div>
          <RoleBadge role={ctx.member.role} />
        </div>

        <LeagueNav leagueId={params.id} isCommissioner={ctx.isCommissioner} active="Overview" />

        {ctx.league.description && (
          <p className="mb-6 text-slate-600">{ctx.league.description}</p>
        )}

        <div className="mb-6 grid grid-cols-3 gap-4">
          <Stat label="Teams" value={teams.length} />
          <Stat label="Claimed" value={`${claimed}/${teams.length}`} />
          <Stat label="Members" value={members.length} />
        </div>

        <h2 className="mb-3 text-lg font-semibold">Teams</h2>
        {teams.length === 0 ? (
          <p className="text-sm text-slate-500">No teams yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => {
              const owner = ownerByTeam.get(team.id);
              return (
                <div key={team.id} className="card flex items-center justify-between py-4">
                  <div>
                    <p className="font-semibold">{team.name}</p>
                    <p className="text-sm text-slate-500">
                      {owner ? `@${owner}` : "Unclaimed"}
                    </p>
                  </div>
                  {!owner && (
                    <span className="badge bg-slate-100 text-slate-500">Open</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {ctx.isCommissioner && (
          <div className="mt-8 flex gap-3">
            <Link href={`/leagues/${params.id}/invite`} className="btn-primary">
              Invite owners
            </Link>
            <Link href={`/leagues/${params.id}/teams`} className="btn-secondary">
              Assign teams
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card py-4 text-center">
      <p className="text-2xl font-bold text-turf-600">{value}</p>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
