import nodemailer from "nodemailer";

/**
 * One send function, two possible transports, chosen by whichever credentials
 * exist. The commissioner should never have to care which one is wired up.
 *
 *   RESEND_API_KEY                          -> Resend HTTP API   (preferred)
 *   SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS -> any SMTP server   (fallback)
 *
 * These are server-only env vars read at request time. They are NOT
 * NEXT_PUBLIC_*, so nothing is baked into the client bundle and rotating a
 * credential does not require a rebuild.
 */

export type MailResult =
  | { ok: true; via: "resend" | "smtp" }
  | { ok: false; reason: string; unconfigured?: boolean };

const FROM =
  process.env.MAIL_FROM ?? "Main Street Steakhouse League <onboarding@resend.dev>";

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<MailResult> {
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
      });
      if (res.ok) return { ok: true, via: "resend" };

      const body = await res.text();
      // Resend's own sandbox sender only delivers to the account owner until a
      // domain is verified. Say that in English rather than echoing raw JSON.
      if (/only send testing emails|your own email address/i.test(body)) {
        return {
          ok: false,
          reason:
            "Resend is still in sandbox mode: it will only deliver to the address that owns the Resend account. Verify a domain in Resend and set MAIL_FROM to an address on it, or configure SMTP instead.",
        };
      }
      return { ok: false, reason: `Resend rejected the message (${res.status}): ${body.slice(0, 300)}` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "Resend request failed" };
    }
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const port = Number(SMTP_PORT ?? 465);
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transport.sendMail({ from: FROM, to, subject, html, text });
      return { ok: true, via: "smtp" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "SMTP send failed";
      if (/535|BadCredentials|Username and Password not accepted/i.test(msg)) {
        return {
          ok: false,
          reason:
            "The mail server rejected the username/password. For Gmail this must be an App Password (Google Account → Security → App passwords), not your normal password.",
        };
      }
      return { ok: false, reason: msg };
    }
  }

  return {
    ok: false,
    unconfigured: true,
    reason:
      "No mail credentials are configured. Add RESEND_API_KEY, or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS, in the Vercel project's environment variables.",
  };
}
