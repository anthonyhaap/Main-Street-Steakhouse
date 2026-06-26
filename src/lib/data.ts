import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { League, LeagueMember, Profile } from "@/lib/types";

/** Returns the signed-in user's profile, or redirects to login. */
export async function requireProfile(): Promise<{ userId: string; profile: Profile }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // Signed in but no profile yet — finish account setup is out of scope here.
  if (!profile) redirect("/login");

  return { userId: user.id, profile };
}

export interface LeagueContext {
  userId: string;
  profile: Profile;
  league: League;
  member: LeagueMember;
  isCommissioner: boolean;
}

/**
 * Loads a league the current user belongs to. RLS guarantees a user can only
 * read leagues/members they're part of, so a missing row means no access.
 */
export async function requireLeagueAccess(leagueId: string): Promise<LeagueContext> {
  const { userId, profile } = await requireProfile();
  const supabase = createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) notFound();

  const { data: member } = await supabase
    .from("league_members")
    .select("*")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) notFound();

  return {
    userId,
    profile,
    league,
    member,
    isCommissioner: member.role === "commissioner",
  };
}

/** Same as requireLeagueAccess but redirects non-commissioners to the league. */
export async function requireCommissioner(leagueId: string): Promise<LeagueContext> {
  const ctx = await requireLeagueAccess(leagueId);
  if (!ctx.isCommissioner) redirect(`/leagues/${leagueId}`);
  return ctx;
}
