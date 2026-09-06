#!/usr/bin/env node
/**
 * Generate the league's VAPID key pair.
 *
 * Run this yourself rather than having it generated for you and pasted into a
 * chat log or a commit — the private key is the credential that lets anything
 * push to your managers' phones, and a secret that has been written down
 * somewhere it did not need to be is already worth rotating.
 *
 *   npm run vapid
 *
 * Then set three variables (Vercel: Project → Settings → Environment Variables):
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY   the public half — safe in the browser bundle
 *   VAPID_PRIVATE_KEY              the private half — server only, never NEXT_PUBLIC_
 *   VAPID_SUBJECT                  mailto: address a push service can complain to
 *
 * Rotating them invalidates every existing subscription: the rows stay but the
 * push services reject them, and each manager has to switch notifications on
 * again. Worth knowing before you do it mid-season.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

process.stdout.write(
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}\n` +
  `VAPID_PRIVATE_KEY=${privateKey}\n` +
  `VAPID_SUBJECT=mailto:you@example.com\n`,
);
