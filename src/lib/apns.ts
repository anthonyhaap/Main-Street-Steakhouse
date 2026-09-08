import { connect, constants, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { APP_ID } from "./config";

/**
 * Apple Push Notification service, from the drain's side.
 *
 * Web Push does not reach a web view, so the iPhone app registers a device
 * token with Apple instead of an endpoint with a push service, and the drain
 * posts to Apple for it. This is that post: one HTTP/2 connection per drain,
 * a token-signed JWT that Apple accepts for an hour, and the same verdicts the
 * Web Push path gives — delivered, try later, or this device is gone.
 *
 * No library. Apple's API is one request shape, Node's http2 speaks it, and
 * the one non-obvious part — ES256 wants the raw r‖s signature rather than
 * DER — is a single option on crypto.sign.
 *
 * Configured by:
 *   APNS_TEAM_ID       the ten characters on the developer account
 *   APNS_KEY_ID        the id of the .p8 key made under Certificates › Keys
 *   APNS_PRIVATE_KEY   the .p8 contents; "\n" escapes are unescaped, so it
 *                      survives a one-line environment variable
 *   APNS_ENVIRONMENT   "production" (TestFlight, the store) or "sandbox"
 *                      (a build Xcode put on a phone). Production by default.
 */

const { HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH, HTTP2_HEADER_STATUS } = constants;

export type ApnsConfig = { teamId: string; keyId: string; privateKey: string; host: string };

export function apnsConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) return null;
  const sandbox = process.env.APNS_ENVIRONMENT?.trim().toLowerCase() === "sandbox";
  return {
    teamId, keyId, privateKey,
    host: sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
  };
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A provider token. Apple wants it fresher than an hour and older than twenty minutes. */
export function apnsToken(cfg: ApnsConfig, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(cfg.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${b64url(signature)}`;
}

export type ApnsVerdict =
  | { ok: true }
  | { ok: false; gone: true; why: string }   // 410, or a token Apple says is bad: forget the device
  | { ok: false; gone: false; why: string }; // anything else: try again on the next drain

export type ApnsMessage = { title: string; body: string; url: string; kind: string };

/**
 * One connection for the whole drain. Apple counts connections, not requests,
 * and a drain that opened one per device would be throttled in a week where
 * every claim settles at once.
 */
export class ApnsSession {
  private session: ClientHttp2Session;
  private token: string;

  constructor(private cfg: ApnsConfig) {
    this.session = connect(cfg.host);
    this.token = apnsToken(cfg);
  }

  send(deviceToken: string, m: ApnsMessage): Promise<ApnsVerdict> {
    const body = JSON.stringify({
      aps: {
        alert: { title: m.title, body: m.body },
        sound: "default",
        "thread-id": m.kind,
      },
      url: m.url,
      kind: m.kind,
    });

    return new Promise((resolve) => {
      const req = this.session.request({
        [HTTP2_HEADER_METHOD]: "POST",
        [HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
        authorization: `bearer ${this.token}`,
        "apns-topic": APP_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        // One notification per kind replaces the last, as the service worker
        // does with `tag`: six waiver results are one banner, not six.
        "apns-collapse-id": m.kind,
        "content-type": "application/json",
      });

      let status = 0;
      const chunks: Buffer[] = [];
      req.on("response", (headers) => { status = Number(headers[HTTP2_HEADER_STATUS] ?? 0); });
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("error", (e: Error) => resolve({ ok: false, gone: false, why: `apns ${e.message}` }));
      req.on("end", () => {
        if (status === 200) { resolve({ ok: true }); return; }
        let reason = "";
        try { reason = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: string }).reason ?? ""; }
        catch { /* Apple always sends JSON on failure; an empty reason is fine */ }
        // 410 is "Unregistered": the app was deleted. BadDeviceToken and
        // DeviceTokenNotForTopic are a token that will never work for this
        // app — a sandbox token sent to production, most often — and retrying
        // it every minute for ever helps nobody.
        const gone = status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic";
        resolve({ ok: false, gone, why: `apns ${status} ${reason}`.trim() });
      });
      req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
      req.end(body);
    });
  }

  close() { this.session.close(); }
}
