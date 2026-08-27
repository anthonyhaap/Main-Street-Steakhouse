/**
 * The invite email. Written as a table-based layout with inline styles because
 * that is the only thing every mail client agrees on — Gmail strips <style>
 * blocks, Outlook ignores flexbox, and dark-mode clients invert naive colours.
 * The palette is the league's, held down with explicit background colours so
 * it survives Gmail's dark theme.
 */
export function inviteEmail(opts: {
  teamName: string;
  leagueName: string;
  email: string;
  joinUrl: string;
  draftNote?: string;
}) {
  const { teamName, leagueName, email, joinUrl, draftNote } = opts;

  const text = [
    `You've been given ${teamName} in ${leagueName}.`,
    "",
    "Set up your account:",
    joinUrl,
    "",
    `Sign in with: ${email}`,
    "Pick any password you like — nothing else gets emailed to you.",
    draftNote ? `\n${draftNote}` : "",
  ].join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="dark"><title>${esc(leagueName)}</title></head>
<body style="margin:0;padding:0;background:#0a0908;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0908;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:520px;background:#121110;border:1px solid rgba(242,237,227,0.12);border-radius:6px;">

    <tr><td style="padding:34px 34px 0 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:38px;height:38px;border:1px solid #8a6f1c;color:#c9a227;
                   font:400 14px Georgia,serif;text-align:center;vertical-align:middle;">MSS</td>
        <td style="padding-left:12px;font:600 10px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                   letter-spacing:2.4px;text-transform:uppercase;color:#f2ede3;line-height:1.4;">
          Main&nbsp;Street<br>Steakhouse
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 34px 0 34px;">
      <div style="font:600 10px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                  letter-spacing:3px;text-transform:uppercase;color:#c9a227;">
        You're in
      </div>
      <h1 style="margin:14px 0 0 0;font:400 30px/1.1 Georgia,'Times New Roman',serif;
                 color:#f2ede3;letter-spacing:-0.5px;">
        ${esc(teamName)}
      </h1>
      <p style="margin:14px 0 0 0;font:400 15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#a49a8a;">
        You've been given a team in <strong style="color:#f2ede3;font-weight:600;">${esc(leagueName)}</strong>.
        Set your password once and you're in — the draft room, your roster, live scoring, all of it.
      </p>
    </td></tr>

    <tr><td style="padding:26px 34px 0 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:#c9a227;border-radius:3px;">
          <a href="${esc(joinUrl)}"
             style="display:inline-block;padding:14px 26px;color:#14100a;text-decoration:none;
                    font:600 11px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                    letter-spacing:2px;text-transform:uppercase;">
            Set up my account
          </a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:22px 34px 0 34px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#191715;border-radius:4px;">
        <tr><td style="padding:14px 16px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#a49a8a;">
          Sign in with <strong style="color:#f2ede3;font-weight:600;">${esc(email)}</strong><br>
          <span style="color:#6f685c;">Choose any password you like. Nothing else gets emailed to you.</span>
        </td></tr>
      </table>
    </td></tr>

    ${draftNote ? `<tr><td style="padding:18px 34px 0 34px;">
      <p style="margin:0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#c9a227;">
        ${esc(draftNote)}
      </p></td></tr>` : ""}

    <tr><td style="padding:26px 34px 30px 34px;">
      <div style="border-top:1px solid rgba(242,237,227,0.1);padding-top:16px;
                  font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#4a453d;">
        If the button doesn't work, paste this into your browser:<br>
        <span style="color:#6f685c;word-break:break-all;">${esc(joinUrl)}</span>
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
