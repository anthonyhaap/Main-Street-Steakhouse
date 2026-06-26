"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string } | undefined;

const createLeagueSchema = z.object({
  name: z.string().trim().min(2, "League name is required").max(80),
  description: z.string().trim().max(500).optional(),
  season: z.string().trim().max(20).optional(),
  teams: z.array(z.string().trim().min(1).max(60)).max(32),
});

/**
 * Creates a league, makes the current user its commissioner, and creates any
 * starter team slots. RLS authorizes each step (the league creator may
 * bootstrap their commissioner membership and team slots).
 */
export async function createLeague(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teams = (formData.getAll("teams") as string[])
    .map((t) => t.trim())
    .filter(Boolean);

  const parsed = createLeagueSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    season: formData.get("season") || undefined,
    teams,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  const { name, description, season } = parsed.data;

  const { data: league, error: leagueErr } = await supabase
    .from("leagues")
    .insert({
      name,
      description: description ?? null,
      season: season ?? null,
      commissioner_id: user.id,
    })
    .select("id")
    .single();
  if (leagueErr || !league) {
    return { error: leagueErr?.message ?? "Could not create league" };
  }

  const { error: memberErr } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: user.id,
    role: "commissioner",
  });
  if (memberErr) {
    return { error: "League created but could not add you as commissioner." };
  }

  if (parsed.data.teams.length > 0) {
    const { error: teamsErr } = await supabase.from("fantasy_teams").insert(
      parsed.data.teams.map((teamName) => ({
        league_id: league.id,
        name: teamName,
      }))
    );
    if (teamsErr) {
      return { error: "League created but some teams could not be added." };
    }
  }

  redirect(`/leagues/${league.id}`);
}

const updateLeagueSchema = z.object({
  leagueId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  season: z.string().trim().max(20).optional(),
});

export async function updateLeague(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateLeagueSchema.safeParse({
    leagueId: formData.get("leagueId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    season: formData.get("season") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("leagues")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      season: parsed.data.season ?? null,
    })
    .eq("id", parsed.data.leagueId);
  if (error) {
    return { error: "Could not update league settings." };
  }

  revalidatePath(`/leagues/${parsed.data.leagueId}`);
  return undefined;
}

/** Commissioner removes a member from the league and frees their team. */
export async function removeMember(formData: FormData): Promise<void> {
  const leagueId = String(formData.get("leagueId"));
  const userId = String(formData.get("userId"));
  const supabase = createClient();

  // Free any team this member owned.
  await supabase
    .from("fantasy_teams")
    .update({ owner_id: null })
    .eq("league_id", leagueId)
    .eq("owner_id", userId);

  await supabase
    .from("league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  revalidatePath(`/leagues/${leagueId}/members`);
}

const roleSchema = z.enum(["commissioner", "owner", "viewer"]);

/** Commissioner changes a member's role. */
export async function updateMemberRole(formData: FormData): Promise<void> {
  const leagueId = String(formData.get("leagueId"));
  const userId = String(formData.get("userId"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!role.success) return;

  const supabase = createClient();
  await supabase
    .from("league_members")
    .update({ role: role.data })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  revalidatePath(`/leagues/${leagueId}/members`);
}
