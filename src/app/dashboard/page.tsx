import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { RoleBadge } from "@/components/RoleBadge";
import { requireProfile } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { League, MemberRole } from "@/lib/types";

interface MembershipRow {
  role: MemberRole;
  leagues: League;
}

export default async function DashboardPage() {
  const { profile } = await requireProfile();
  const supabase = createClient();

  // RLS scopes this to leagues the user is a member of.
  const { data } = await supabase
    .from("league_members")
    .select("role, leagues(*)")
    .order("created_at", { ascending: false });

  const memberships = ((data ?? []) as unknown as MembershipRow[]).filter((m) => m.leagues);

  return (
    <div className="min-h-screen">
      <Navbar username={profile.username} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Your leagues</h1>
            <p className="text-sm text-slate-500">
              Welcome back, @{profile.username}.
            </p>
          </div>
          <Link href="/leagues/new" className="btn-primary">
            + Create league
          </Link>
        </div>

        {memberships.length === 0 ? (
          <div className="card text-center text-slate-600">
            <p className="mb-4">
              You&apos;re not in any leagues yet. Create one to get started, or accept an
              invite from a commissioner.
            </p>
            <Link href="/leagues/new" className="btn-primary inline-flex">
              Create your first league
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {memberships.map((m) => (
              <Link
                key={m.leagues.id}
                href={`/leagues/${m.leagues.id}`}
                className="card transition hover:border-turf-500 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-lg font-semibold">{m.leagues.name}</h2>
                  <RoleBadge role={m.role} />
                </div>
                {m.leagues.season && (
                  <p className="mt-1 text-xs text-slate-400">Season {m.leagues.season}</p>
                )}
                {m.leagues.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                    {m.leagues.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
