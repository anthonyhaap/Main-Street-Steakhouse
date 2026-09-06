"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "./supabase/client";

/**
 * Web Push, from the browser's side.
 *
 * The awkward part of this API is that "can I ask?" has four answers, not two:
 * the browser may not support push at all, the page may not be on HTTPS or a
 * standalone install (iOS refuses otherwise), permission may already be
 * granted, or it may be permanently denied — and a denied permission cannot be
 * asked for again from script. Each one needs a different sentence on screen,
 * so the hook reports which it is rather than a boolean.
 */

export type PushState =
  | "unsupported"   // no service worker or no PushManager
  | "ios-needs-install" // Safari on iOS only allows this from the home screen
  | "denied"        // the browser will not ask again
  | "off"           // can ask, not subscribed
  | "on";           // subscribed on this device

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** VAPID keys travel base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const b64 = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : "";

export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // iOS supports push, but only once the app is on the home screen — worth
      // saying, because it is a step the manager can actually take.
      const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (window.navigator as { standalone?: boolean }).standalone === true;
      setState(iOS && !standalone ? "ios-needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") { setState("denied"); return; }

    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => { void read(); }, [read]);

  const enable = useCallback(async () => {
    setError(null);
    if (!KEY) {
      setError("Notifications aren't configured for this league yet — no VAPID key is set.");
      return;
    }
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(KEY) as BufferSource,
      });
      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };

      const { error: rpcError } = await supabaseBrowser().rpc("ff_save_push_subscription", {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh ?? b64(sub.getKey("p256dh")),
        p_auth: json.keys?.auth ?? b64(sub.getKey("auth")),
        p_user_agent: navigator.userAgent,
      });
      if (rpcError) {
        // Registered with the push service but not with us: unsubscribe rather
        // than leave an endpoint nothing will ever send to.
        await sub.unsubscribe().catch(() => {});
        throw new Error(rpcError.message);
      }
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn notifications on.");
      await read();
    } finally {
      setBusy(false);
    }
  }, [read]);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Ours first: if the browser forgets the subscription but the row
        // survives, the drain keeps pushing at an endpoint nobody reads.
        await supabaseBrowser().rpc("ff_forget_push_subscription", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn notifications off.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable, refresh: read };
}
