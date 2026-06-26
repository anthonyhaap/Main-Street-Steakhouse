import { Resend } from "resend";

interface InviteEmailParams {
  to: string;
  leagueName: string;
  inviterName: string;
  teamName: string | null;
  acceptUrl: string;
}

/**
 * Sends a league invite email containing the secure accept link.
 *
 * Passwords are NEVER emailed — the recipient sets their own password on the
 * accept page. If RESEND_API_KEY is not configured, the accept link is logged
 * to the server console so the flow remains testable in local development.
 */
export async function sendInviteEmail(params: InviteEmailParams) {
  const { to, leagueName, inviterName, teamName, acceptUrl } = params;

  const subject = `You're invited to join ${leagueName}`;
  const teamLine = teamName
    ? `<p>You'll be managing <strong>${escapeHtml(teamName)}</strong>.</p>`
    : "";

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#166534;">🏈 ${escapeHtml(leagueName)}</h2>
      <p>${escapeHtml(inviterName)} invited you to join their fantasy football league.</p>
      ${teamLine}
      <p style="margin:24px 0;">
        <a href="${acceptUrl}"
           style="background:#16a34a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Accept your invite
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">
        Or paste this link into your browser:<br/>
        <a href="${acceptUrl}">${acceptUrl}</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;">
        This invite link is unique to you. Do not share it. It will expire soon.
      </p>
    </div>
  `;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — invite link for ${to}:\n${acceptUrl}`
    );
    return { delivered: false as const, acceptUrl };
  }

  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "Gridiron League <onboarding@resend.dev>";

  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    throw new Error(`Failed to send invite email: ${error.message}`);
  }

  return { delivered: true as const, acceptUrl };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
