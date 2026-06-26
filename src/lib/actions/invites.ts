"use server";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInviteEmail } from "@/lib/email";

export type ActionResult = { error: string } | { ok: string } | undefined;

const INVITE_TTL_DAYS = 7;

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

const createInviteSchema = z.object({
  leagueId: z.string().uuid(),
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(["owner", "viewer"]).default("owner"),
  teamId: z.string().uuid().optional(),
  newTeamName: z.string().trim().max(60).optional(),
});

/**
 * Commissioner action. Creates a pending, tokenized invite (optionally tied to
 * a team) and emails the recipient an accept link. RLS ensures only the
 * league's commissioner can insert the invite.
 */
export async function createInvite(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createInviteSchema.safeParse({
    leagueId: formData.get("leagueId"),
    email: formData.get("email"),
    role: formData.get("role") || "owner",
    teamId: (formData.get("teamId") as string) || undefined,
    newTeamName: (formData.get("newTeamName") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  const { leagueId, email, role } = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("name")
    .eq("id", leagueId)
    .single();
  if (!league) {
    return { error: "League not found or you are not its commissioner." };
  }

  let teamId = parsed.data.teamId ?? null;

  // Optionally create a new team slot for this owner.
  if (!teamId && parsed.data.newTeamName) {
    const { data: team, error: teamErr } = await supabase
      .from("fantasy_teams")
      .insert({ league_id: leagueId, name: parsed.data.newTeamName })
      .select("id")
      .single();
    if (teamErr) {
      return { error: "Could not create the team. The name may already exist." };
    }
    teamId = team.id;
  }

  // Replace any previous pending invite for this email/league.
  await supabase
    .from("league_invites")
    .update({ status: "revoked" })
    .eq("league_id", leagueId)
    .ilike("email", email)
    .eq("status", "pending");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

  const { error: inviteErr } = await supabase.from("league_invites").insert({
    league_id: leagueId,
    email,
    role,
    team_id: teamId,
    token,
    status: "pending",
    expires_at: expiresAt,
    invited_by: user.id,
  });
  if (inviteErr) {
    return { error: inviteErr.message };
  }

  // Resolve the inviter's display name and team name for the email body.
  const { data: inviter } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  let teamName: string | null = null;
  if (teamId) {
    const { data: team } = await supabase
      .from("fantasy_teams")
      .select("name")
      .eq("id", teamId)
      .single();
    teamName = team?.name ?? null;
  }

  const acceptUrl = `${siteUrl()}/accept-invite?token=${token}`;
  try {
    const result = await sendInviteEmail({
      to: email,
      leagueName: league.name,
      inviterName: inviter?.username ?? "Your commissioner",
      teamName,
      acceptUrl,
    });
    revalidatePath(`/leagues/${leagueId}/invite`);
    return {
      ok: result.delivered
        ? `Invite sent to ${email}.`
        : `Invite created. Email delivery is not configured — share this link: ${acceptUrl}`,
    };
  } catch (e) {
    return { error: `Invite saved but email failed: ${(e as Error).message}` };
  }
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("inviteId"));
  const leagueId = String(formData.get("leagueId"));
  const supabase = createClient();
  await supabase
    .from("league_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending");
  revalidatePath(`/leagues/${leagueId}/invite`);
}

// ---------------------------------------------------------------------------
// Invite acceptance
// ---------------------------------------------------------------------------

export interface InvitePreview {
  valid: boolean;
  reason?: string;
  email?: string;
  leagueName?: string;
  teamName?: string | null;
  role?: string;
}

/** Loads an invite by token for display on the accept page (service role). */
export async function loadInvite(token: string): Promise<InvitePreview> {
  if (!token) return { valid: false, reason: "Missing invite token." };
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("league_invites")
    .select("id, email, role, status, expires_at, league_id, team_id")
    .eq("token", token)
    .maybeSingle();

  if (!invite) return { valid: false, reason: "This invite link is invalid." };
  if (invite.status === "accepted")
    return { valid: false, reason: "This invite has already been accepted." };
  if (invite.status === "revoked")
    return { valid: false, reason: "This invite has been revoked." };
  if (new Date(invite.expires_at) < new Date()) {
    await admin.from("league_invites").update({ status: "expired" }).eq("id", invite.id);
    return { valid: false, reason: "This invite has expired." };
  }

  const { data: league } = await admin
    .from("leagues")
    .select("name")
    .eq("id", invite.league_id)
    .single();

  let teamName: string | null = null;
  if (invite.team_id) {
    const { data: team } = await admin
      .from("fantasy_teams")
      .select("name")
      .eq("id", invite.team_id)
      .single();
    teamName = team?.name ?? null;
  }

  return {
    valid: true,
    email: invite.email,
    role: invite.role,
    leagueName: league?.name,
    teamName,
  };
}

const acceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only")
    .optional(),
});

export type AcceptResult = { error: string } | undefined;

/**
 * Accepts an invite. Validates the token server-side, then either creates a new
 * account (username + password) or signs an existing user in, provisions the
 * league membership, assigns the team, and marks the invite accepted.
 * Everything privileged runs through the service-role client after we have
 * verified the token ourselves.
 */
export async function acceptInvite(_prev: AcceptResult, formData: FormData): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    username: (formData.get("username") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  const { token, password, username } = parsed.data;

  const admin = createAdminClient();

  // Re-validate the invite at submit time.
  const { data: invite } = await admin
    .from("league_invites")
    .select("id, email, role, status, expires_at, league_id, team_id")
    .eq("token", token)
    .maybeSingle();
  if (!invite) return { error: "This invite link is invalid." };
  if (invite.status !== "pending") return { error: "This invite is no longer valid." };
  if (new Date(invite.expires_at) < new Date()) {
    await admin.from("league_invites").update({ status: "expired" }).eq("id", invite.id);
    return { error: "This invite has expired." };
  }

  const email = invite.email;
  let userId: string | null = null;

  // Try to create the account. If the email already exists, fall back to login.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created?.user) {
    userId = created.user.id;

    if (!username) {
      await admin.auth.admin.deleteUser(userId);
      return { error: "Choose a username to finish creating your account." };
    }
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (taken) {
      await admin.auth.admin.deleteUser(userId);
      return { error: "That username is already taken." };
    }
    const { error: profileErr } = await admin.from("profiles").insert({
      id: userId,
      username,
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(userId);
      return { error: "Could not create your profile. Please try again." };
    }
  } else if (createErr && /registered|exists/i.test(createErr.message)) {
    // Existing account — verify the password by signing in.
    const supabase = createClient();
    const { data: signedIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signedIn.user) {
      return {
        error:
          "An account already exists for this email. Enter your existing password to join.",
      };
    }
    userId = signedIn.user.id;
  } else {
    return { error: createErr?.message ?? "Could not create your account." };
  }

  // Provision membership, team assignment, and mark the invite accepted.
  const { error: memberErr } = await admin.from("league_members").upsert(
    {
      league_id: invite.league_id,
      user_id: userId!,
      role: invite.role,
      team_id: invite.team_id,
    },
    { onConflict: "league_id,user_id" }
  );
  if (memberErr) {
    return { error: "Could not add you to the league. Please contact your commissioner." };
  }

  if (invite.team_id) {
    await admin.from("fantasy_teams").update({ owner_id: userId }).eq("id", invite.team_id);
  }

  await admin
    .from("league_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  // Ensure the browser has a session (new users still need to be signed in).
  const supabase = createClient();
  const {
    data: { user: current },
  } = await supabase.auth.getUser();
  if (!current) {
    await supabase.auth.signInWithPassword({ email, password });
  }

  redirect(`/leagues/${invite.league_id}`);
}
