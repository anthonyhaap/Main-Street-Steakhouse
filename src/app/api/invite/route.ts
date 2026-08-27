import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/invite-template";
import { LEAGUE_ID } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Send one manager their invite.
 *
 * Authorisation is done here, server-side, from the caller's session cookie —
 * not from anything the browser claims. Only the league's commissioner can
 * cause mail to be sent, so this cannot be turned into a spam relay by someone
 * holding the publishable key.
 */
export async function POST(request: NextRequest) {
  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const teamId = body.teamId;
  if (!teamId) return NextResponse.json({ error: "Missing teamId." }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: league } = await supabase
    .from("leagues")
    .select("id,name,commissioner_id")
    .eq("id", LEAGUE_ID)
    .maybeSingle();

  if (!league || league.commissioner_id !== user.id) {
    return NextResponse.json({ error: "Commissioner only." }, { status: 403 });
  }

  const { data: team } = await supabase
    .from("teams")
    .select("id,name,owner_email,draft_slot")
    .eq("id", teamId)
    .eq("league_id", LEAGUE_ID)
    .maybeSingle();

  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  if (!team.owner_email) {
    return NextResponse.json({ error: "Add an email for this team first." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const joinUrl = `${origin}/join?email=${encodeURIComponent(team.owner_email)}`;

  const { html, text } = inviteEmail({
    teamName: team.name,
    leagueName: league.name,
    email: team.owner_email,
    joinUrl,
    draftNote: team.draft_slot ? `You're drafting from slot ${team.draft_slot}.` : undefined,
  });

  const result = await sendMail(
    team.owner_email,
    `${team.name} — your ${league.name} invite`,
    html,
    text,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, unconfigured: result.unconfigured ?? false, joinUrl },
      { status: result.unconfigured ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, via: result.via, sentTo: team.owner_email });
}
