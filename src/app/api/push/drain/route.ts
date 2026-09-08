import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/config";
import { ApnsSession, apnsConfig } from "@/lib/apns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deliver what the league owes.
 *
 * Everything that decides WHAT to send lives in the database — triggers write
 * notification_outbox inside the transaction that caused them, so a push
 * service being down can never roll back a trade. This route is only the part
 * that has to be outside Postgres: it holds the VAPID private key, signs, and
 * posts.
 *
 * It is safe to call repeatedly and safe to call twice at once. ff_push_batch
 * claims its rows with `for update skip locked`, so two overlapping drains take
 * different work; an unfinished claim expires after five minutes and comes back
 * rather than being lost.
 *
 * Authorised by CRON_SECRET, which Vercel Cron sends as a bearer token. Without
 * that env var set the route refuses everything rather than defaulting open —
 * an unauthenticated drain is a way to make the league's phones buzz.
 *
 * Two kinds of device. A browser is a Web Push endpoint, signed with the VAPID
 * key. The iPhone app is an Apple device token, posted to Apple with the key
 * from src/lib/apns.ts. A message goes to every device its manager has, and
 * counts as delivered when one of them takes it.
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:commissioner@steakhouse.football";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

type Device =
  | { platform: "web"; endpoint: string; p256dh: string; auth: string }
  | { platform: "ios"; endpoint: string; p256dh: null; auth: null };
type Message = { id: string; title: string; body: string; url: string; kind: string; devices: Device[] };

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so this route cannot authorise anybody." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    return NextResponse.json(
      { error: "VAPID keys are not configured. Run `npm run vapid` and set them." },
      { status: 503 },
    );
  }
  if (!SERVICE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set; the drain cannot read the outbox." },
      { status: 503 },
    );
  }

  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("ff_push_batch", { p_limit: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const messages = (data ?? []) as Message[];
  if (messages.length === 0) return NextResponse.json({ ok: true, sent: 0, owed: 0 });

  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const gone: string[] = [];

  // Opened only if an iPhone is owed something, and once for the whole batch.
  // Missing APNs keys are not fatal: the browsers still get theirs, and the
  // iPhone's failure is written on the outbox row where it can be read.
  const apnsCfg = apnsConfig();
  const wantsApns = messages.some((m) => m.devices.some((d) => d.platform === "ios"));
  const apns = wantsApns && apnsCfg ? new ApnsSession(apnsCfg) : null;

  await Promise.all(messages.map(async (m) => {
    const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, kind: m.kind });

    const results = await Promise.all(m.devices.map(async (d) => {
      if (d.platform === "ios") {
        if (!apns) return { ok: false as const, why: "APNS_TEAM_ID, APNS_KEY_ID and APNS_PRIVATE_KEY are not all set" };
        const verdict = await apns.send(d.endpoint, m);
        if (verdict.ok) return { ok: true as const };
        // Apple saying the app is gone from that phone is as final as a 410
        // from a push service: forget the token rather than retry it for ever.
        if (verdict.gone) { gone.push(d.endpoint); return { ok: true as const }; }
        return { ok: false as const, why: verdict.why };
      }
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          payload,
        );
        return { ok: true as const };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 is the push service saying this endpoint is finished. It has
        // no second life — the browser issues a new one — so the row goes.
        if (status === 404 || status === 410) {
          gone.push(d.endpoint);
          return { ok: true as const };
        }
        return { ok: false as const, why: `${status ?? "?"} ${(e as Error).message}` };
      }
    }));

    const bad = results.filter((r) => !r.ok) as { ok: false; why: string }[];
    // Delivered if it reached at least one live device, or if every device it
    // had turned out to be gone. Retrying a message whose only endpoints are
    // dead would keep it in the queue for ever.
    if (bad.length < results.length || results.length === 0) sent.push(m.id);
    else failed.push({ id: m.id, error: bad[0].why });
  }));

  apns?.close();

  const { error: settleError } = await supabase.rpc("ff_push_settle", {
    p_sent: sent,
    p_failed: failed,
    p_gone: gone,
  });
  if (settleError) {
    // The pushes went out; only the bookkeeping failed. Say so rather than
    // reporting success — the claims expire in five minutes and these will be
    // retried, which is a real (if bounded) chance of a duplicate.
    return NextResponse.json(
      { error: `sent ${sent.length} but could not record it: ${settleError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, sent: sent.length, failed: failed.length, gone: gone.length });
}
