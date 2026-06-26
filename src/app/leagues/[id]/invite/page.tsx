import { Navbar } from "@/components/Navbar";
import { LeagueNav } from "@/components/LeagueNav";
import { requireCommissioner } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { revokeInvite } from "@/lib/actions/invites";
import type { FantasyTeam, LeagueInvite } from "@/lib/types";
import { InviteForm } from "./InviteForm";

export default async function InvitePage({ params }: { params: { id: string } }) {
  const ctx = await requireCommissioner(params.id);
  const supabase = createClient();

  const [{ data: teamsData }, { data: invitesData }] = await Promise.all([
    supabase
      .from("fantasy_teams")
      .select("*")
      .eq("league_id", params.id)
      .is("owner_id", null)
      .order("name"),
    supabase
      .from("league_invites")
      .select("*")
      .eq("league_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  const openTeams = (teamsData ?? []) as FantasyTeam[];
  const invites = (invitesData ?? []) as LeagueInvite[];

  return (
    <div className="min-h-screen">
      <Navbar username={ctx.profile.username} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold">{ctx.league.name}</h1>
        <LeagueNav leagueId={params.id} isCommissioner active="Invite Owners" />

        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Invite an owner</h2>
            <div className="card">
              <InviteForm leagueId={params.id} openTeams={openTeams} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              We email a secure, single-use link. Owners set their own password — we never
              email passwords.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Invitations</h2>
            {invites.length === 0 ? (
              <p className="text-sm text-slate-500">No invites yet.</p>
            ) : (
              <ul className="space-y-2">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="card flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{inv.email}</p>
                      <p className="text-xs text-slate-400">
                        {inv.role} · expires{" "}
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={inv.status} />
                      {inv.status === "pending" && (
                        <form action={revokeInvite}>
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <input type="hidden" name="leagueId" value={params.id} />
                          <button type="submit" className="btn-danger px-2 py-1 text-xs">
                            Revoke
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    accepted: "bg-turf-100 text-turf-700",
    expired: "bg-slate-100 text-slate-500",
    revoked: "bg-red-100 text-red-600",
  };
  return <span className={`badge ${styles[status] ?? ""}`}>{status}</span>;
}
