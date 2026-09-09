import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/invite-template";

export const runtime = "nodejs";

/**
 * Send somebody a seat beside a manager.
 *
 * The shape of /api/invite, with the authorisation moved into the database:
 * `ff_invite_co_owner` runs as the signed-in caller and refuses anyone but the
 * team's manager or the commissioner, so this route cannot be turned into a
 * relay by a holder of the publishable key any more than the manager's one
 * can. The token is minted there and travels only inside the mail — the
 * response carries it back to the browser only when the mail could not be
 * sent, as the link the sender can hand over by other means.
 */
export async function POST(request: NextRequest) {
  let body: { teamId?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const teamId = body.teamId;
  const email = body.email?.trim();
  if (!teamId) return NextResponse.json({ error: "Missing teamId." }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Missing email." }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase.rpc("ff_invite_co_owner", {
    p_team_id: teamId,
    p_email: email,
  });
  const invite = data as {
    token: string; email: string; team: string; league: string; manager: string | null;
  } | null;
  if (error || !invite?.token) {
    return NextResponse.json(
      { error: error?.message ?? "Could not issue an invite for that team." },
      { status: 400 },
    );
  }

  const origin = request.nextUrl.origin;
  const joinUrl = `${origin}/join?t=${encodeURIComponent(invite.token)}`;

  const { html, text } = inviteEmail({
    teamName: invite.team,
    managerName: invite.manager ?? undefined,
    leagueName: invite.league,
    email: invite.email,
    joinUrl,
    role: "co_owner",
  });

  const result = await sendMail(
    invite.email,
    `${invite.team} — a seat beside ${invite.manager?.trim().split(/\s+/)[0] ?? "the manager"} in ${invite.league}`,
    html,
    text,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, unconfigured: result.unconfigured ?? false, joinUrl },
      { status: result.unconfigured ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, via: result.via, sentTo: invite.email });
}
