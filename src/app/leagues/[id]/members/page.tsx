import { Navbar } from "@/components/Navbar";
import { LeagueNav } from "@/components/LeagueNav";
import { RoleBadge } from "@/components/RoleBadge";
import { requireLeagueAccess } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { removeMember, updateMemberRole } from "@/lib/actions/leagues";
import type { MemberRole, Profile } from "@/lib/types";

interface MemberRow {
  user_id: string;
  role: MemberRole;
  team_id: string | null;
  created_at: string;
  profiles: Pick<Profile, "username" | "full_name"> | null;
  fantasy_teams: { name: string } | null;
}

export default async function MembersPage({ params }: { params: { id: string } }) {
  const ctx = await requireLeagueAccess(params.id);
  const supabase = createClient();

  const { data } = await supabase
    .from("league_members")
    .select("user_id, role, team_id, created_at, profiles(username, full_name), fantasy_teams(name)")
    .eq("league_id", params.id)
    .order("created_at");

  const members = (data ?? []) as unknown as MemberRow[];
  const canManage = ctx.isCommissioner;

  return (
    <div className="min-h-screen">
      <Navbar username={ctx.profile.username} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold">{ctx.league.name}</h1>
        <LeagueNav leagueId={params.id} isCommissioner={ctx.isCommissioner} active="Members" />

        <h2 className="mb-3 text-lg font-semibold">League members</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Role</th>
                {canManage && <th className="px-4 py-3 text-right">Manage</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => {
                const isSelf = m.user_id === ctx.userId;
                return (
                  <tr key={m.user_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">@{m.profiles?.username ?? "unknown"}</div>
                      {m.profiles?.full_name && (
                        <div className="text-xs text-slate-400">{m.profiles.full_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.fantasy_teams?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && !isSelf ? (
                        <form action={updateMemberRole} className="flex items-center gap-2">
                          <input type="hidden" name="leagueId" value={params.id} />
                          <input type="hidden" name="userId" value={m.user_id} />
                          <select
                            name="role"
                            defaultValue={m.role}
                            className="input max-w-[8rem] py-1"
                          >
                            <option value="commissioner">commissioner</option>
                            <option value="owner">owner</option>
                            <option value="viewer">viewer</option>
                          </select>
                          <button type="submit" className="btn-secondary px-2 py-1 text-xs">
                            Save
                          </button>
                        </form>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        {!isSelf ? (
                          <form action={removeMember}>
                            <input type="hidden" name="leagueId" value={params.id} />
                            <input type="hidden" name="userId" value={m.user_id} />
                            <button type="submit" className="btn-danger px-2 py-1 text-xs">
                              Remove
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-400">You</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!canManage && (
          <p className="mt-3 text-xs text-slate-400">
            Only the commissioner can change roles or remove members.
          </p>
        )}
      </main>
    </div>
  );
}
