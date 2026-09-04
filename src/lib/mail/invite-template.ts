/**
 * The invite email. Table-based layout with inline styles because that is the
 * only thing every mail client agrees on — Gmail strips <style> blocks, Outlook
 * ignores flexbox, and dark-mode clients invert naive colours. The palette is
 * the league's, held down with explicit background colours so it survives
 * Gmail's dark theme.
 *
 * The logo is a remote image, which many clients block by default, so it
 * carries real alt text and the league name is repeated in the copy — the mail
 * still reads as the league with every image turned off.
 */
export function inviteEmail(opts: {
  teamName: string;
  /** Greets the manager by name when the commissioner has entered one. */
  managerName?: string;
  leagueName: string;
  email: string;
  joinUrl: string;
  draftNote?: string;
  logoUrl?: string;
}) {
  const { teamName, managerName, leagueName, email, joinUrl, draftNote } = opts;
  const logoUrl = opts.logoUrl ?? "https://steakhouse.football/logo-full.png";
  const first = managerName?.trim().split(/\s+/)[0];

  const text = [
    ...(first ? [`${first},`, ""] : []),
    `You've been given ${teamName} in ${leagueName}.`,
    "",
    "Set up your account:",
    joinUrl,
    "",
    `Sign in with: ${email}`,
    "Pick any password you like — nothing else gets emailed to you.",
    draftNote ? `\n${draftNote}` : "",
    "",
    "Main Street Steakhouse · Est. 2016 · Members Only",
  ].join("\n");

  const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const SERIF = "Georgia,'Times New Roman',serif";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(leagueName)}</title></head>
<body style="margin:0;padding:0;background:#fbf8f2;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Your team in ${esc(leagueName)} is waiting — set a password and you're in.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf8f2;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:540px;background:#ffffff;border:1px solid rgba(27,24,20,0.10);border-radius:12px;">

    <tr><td style="height:4px;background:#6a0b20;font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td align="center" style="padding:32px 34px 0 34px;">
      <img src="${esc(logoUrl)}" width="150" alt="Main Street Steakhouse — Est. 2016"
           style="display:block;width:150px;max-width:60%;height:auto;border:0;">
    </td></tr>

    <tr><td align="center" style="padding:22px 34px 0 34px;">
      <div style="font:700 10px ${SANS};letter-spacing:3px;text-transform:uppercase;color:#a6791a;">
        ${first ? `${esc(first)}, a seat is yours` : "A seat is yours"}
      </div>
      <h1 style="margin:12px 0 0 0;font:400 32px/1.1 ${SERIF};color:#6a0b20;letter-spacing:-0.5px;">
        ${esc(teamName)}
      </h1>
    </td></tr>

    <tr><td style="padding:16px 34px 0 34px;">
      <p style="margin:0;font:400 15px/1.65 ${SANS};color:#5c554b;text-align:center;">
        You've been given a team in <strong style="color:#191614;font-weight:600;">${esc(leagueName)}</strong>.
        Set your password once and you're in — the draft room, your roster, live scoring, all of it.
      </p>
    </td></tr>

    <tr><td align="center" style="padding:26px 34px 0 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#6a0b20" style="background:#6a0b20;border-radius:999px;mso-padding-alt:15px 30px;">
          <a href="${esc(joinUrl)}" target="_blank" rel="noopener noreferrer"
             style="display:block;padding:15px 30px;color:#fdf7ee;text-decoration:none;
                    font:700 11px ${SANS};letter-spacing:2px;text-transform:uppercase;">
            Join the league
          </a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:24px 34px 0 34px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f6f1e6;border-radius:8px;">
        <tr><td style="padding:14px 16px;font:400 13px/1.6 ${SANS};color:#5c554b;">
          Sign in with <strong style="color:#191614;font-weight:600;">${esc(email)}</strong><br>
          <span style="color:#877e71;">Choose any password you like. Nothing else gets emailed to you.</span>
        </td></tr>
      </table>
    </td></tr>

    ${draftNote ? `<tr><td style="padding:16px 34px 0 34px;">
      <p style="margin:0;font:600 13px/1.6 ${SANS};color:#a6791a;text-align:center;">
        ${esc(draftNote)}
      </p></td></tr>` : ""}

    <tr><td style="padding:26px 34px 30px 34px;">
      <div style="border-top:1px solid rgba(27,24,20,0.10);padding-top:16px;
                  font:400 11px/1.6 ${SANS};color:#b5ac9c;">
        If the button doesn't work, paste this into your browser:<br>
        <a href="${esc(joinUrl)}" target="_blank" rel="noopener noreferrer"
           style="color:#6a0b20;text-decoration:underline;word-break:break-all;">${esc(joinUrl)}</a>
      </div>
      <div style="padding-top:14px;font:700 9px ${SANS};letter-spacing:2px;
                  text-transform:uppercase;color:#b5ac9c;text-align:center;">
        Main Street Steakhouse &middot; Est. 2016 &middot; Members Only
      </div>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  return { html, text };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
