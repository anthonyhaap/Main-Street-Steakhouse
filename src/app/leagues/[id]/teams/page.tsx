import { Navbar } from "@/components/Navbar";
import { LeagueNav } from "@/components/LeagueNav";
import { requireCommissioner } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { createTeam, deleteTeam } from "@/lib/actions/teams";
import type { FantasyTeam, MemberRole, Profile } from "@/lib/types";
import { AssignTeamForm } from "./AssignTeamForm";

interface MemberRow {
  user_id: string;
  role: MemberRole;
  profiles: Pick<Profile, "username"> | null;
}

export default async function TeamsPage({ params }: { params: { id: string } }) {
  const ctx = await requireCommissioner(params.id);
  const supabase = createClient();

  const [{ data: teamsData }, { data: membersData }] = await Promise.all([
    supabase.from("fantasy_teams").select("*").eq("league_id", params.id).order("name"),
    supabase
      .from("league_members")
      .select("user_id, role, profiles(username)")
      .eq("league_id", params.id),
  ]);

  const teams = (teamsData ?? []) as FantasyTeam[];
  const members = (membersData ?? []) as unknown as MemberRow[];
  const owners = members.map((m) => ({
    userId: m.user_id,
    username: m.profiles?.username ?? "unknown",
  }));

  return (
    <div className="min-h-screen">
      <Navbar username={ctx.profile.username} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold">{ctx.league.name}</h1>
        <LeagueNav leagueId={params.id} isCommissioner active="Assign Teams" />

        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-lg font-semibold">Teams &amp; owners</h2>
          <form action={createTeam} className="flex gap-2">
            <input type="hidden" name="leagueId" value={params.id} />
            <input
              name="name"
              placeholder="New team name"
              required
              maxLength={60}
              className="input max-w-[12rem] py-1"
            />
            <button type="submit" className="btn-secondary whitespace-nowrap px-3 py-1">
              + Add
            </button>
          </form>
        </div>

        {teams.length === 0 ? (
          <p className="text-sm text-slate-500">No teams yet. Add one above.</p>
        ) : (
          <ul className="space-y-3">
            {teams.map((team) => (
              <li
                key={team.id}
                className="card flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="font-semibold">{team.name}</p>
                  <p className="text-xs text-slate-400">
                    {team.owner_id
                      ? `Owned by @${
                          owners.find((o) => o.userId === team.owner_id)?.username ?? "unknown"
                        }`
                      : "Unassigned"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <AssignTeamForm
                    leagueId={params.id}
                    teamId={team.id}
                    currentOwnerId={team.owner_id}
                    owners={owners}
                  />
                  <form action={deleteTeam}>
                    <input type="hidden" name="leagueId" value={params.id} />
                    <input type="hidden" name="teamId" value={team.id} />
                    <button type="submit" className="btn-danger px-2 py-2 text-xs">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-slate-400">
          Assigning a team here sets its owner directly. Owners you invite by email are
          assigned automatically when they accept.
        </p>
      </main>
    </div>
  );
}
