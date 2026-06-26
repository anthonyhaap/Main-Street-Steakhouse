"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string } | undefined;

/** Commissioner creates an empty team slot. */
export async function createTeam(formData: FormData): Promise<void> {
  const leagueId = String(formData.get("leagueId"));
  const name = String(formData.get("name") || "").trim();
  if (!name) return;

  const supabase = createClient();
  await supabase.from("fantasy_teams").insert({ league_id: leagueId, name });
  revalidatePath(`/leagues/${leagueId}/teams`);
}

/** Commissioner deletes a team slot. */
export async function deleteTeam(formData: FormData): Promise<void> {
  const leagueId = String(formData.get("leagueId"));
  const teamId = String(formData.get("teamId"));

  const supabase = createClient();
  // Detach the membership pointer, then delete the team.
  await supabase.from("league_members").update({ team_id: null }).eq("team_id", teamId);
  await supabase.from("fantasy_teams").delete().eq("id", teamId);
  revalidatePath(`/leagues/${leagueId}/teams`);
}

const assignSchema = z.object({
  leagueId: z.string().uuid(),
  teamId: z.string().uuid(),
  // empty string means "unassign"
  userId: z.string().uuid().or(z.literal("")),
});

/**
 * Commissioner assigns (or clears) a team's owner, keeping the owning member's
 * team pointer in sync.
 */
export async function assignTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = assignSchema.safeParse({
    leagueId: formData.get("leagueId"),
    teamId: formData.get("teamId"),
    userId: formData.get("userId") ?? "",
  });
  if (!parsed.success) {
    return { error: "Invalid assignment." };
  }
  const { leagueId, teamId, userId } = parsed.data;
  const supabase = createClient();

  // Clear this team's current owner pointer and any prior member→team link.
  await supabase
    .from("league_members")
    .update({ team_id: null })
    .eq("league_id", leagueId)
    .eq("team_id", teamId);

  if (userId === "") {
    await supabase.from("fantasy_teams").update({ owner_id: null }).eq("id", teamId);
    revalidatePath(`/leagues/${leagueId}/teams`);
    return undefined;
  }

  // Free whatever team the target member currently holds (one team per owner).
  const { data: held } = await supabase
    .from("league_members")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (held?.team_id) {
    await supabase.from("fantasy_teams").update({ owner_id: null }).eq("id", held.team_id);
  }

  const { error: teamErr } = await supabase
    .from("fantasy_teams")
    .update({ owner_id: userId })
    .eq("id", teamId);
  if (teamErr) {
    return { error: "Could not assign the team." };
  }

  await supabase
    .from("league_members")
    .update({ team_id: teamId })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  revalidatePath(`/leagues/${leagueId}/teams`);
  return undefined;
}

const renameSchema = z.object({
  leagueId: z.string().uuid(),
  teamId: z.string().uuid(),
  name: z.string().trim().min(1, "Team name is required").max(60),
});

/**
 * Renames a team. RLS allows the league commissioner or the team's own owner —
 * powering both the Assign Teams page and the My Team page.
 */
export async function renameTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = renameSchema.safeParse({
    leagueId: formData.get("leagueId"),
    teamId: formData.get("teamId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("fantasy_teams")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.teamId);
  if (error) {
    return { error: "Could not rename the team." };
  }

  revalidatePath(`/leagues/${parsed.data.leagueId}/my-team`);
  revalidatePath(`/leagues/${parsed.data.leagueId}/teams`);
  return undefined;
}
