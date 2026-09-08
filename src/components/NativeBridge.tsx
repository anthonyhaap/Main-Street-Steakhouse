"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import {
  isNativeApp, NATIVE_PUSH_OFF, NATIVE_PUSH_TOKEN, nativePushPermission, registerNativePush,
} from "@/lib/native";

/**
 * What the iPhone app needs the page to do that Safari never asked of it.
 *
 * Three things, all listeners, all only inside the frame:
 *
 *   a league link tapped in Messages opens the app — the frame hands the URL
 *   here and the page goes to it, so the sign-in link lands the session in
 *   the app and not in Safari;
 *
 *   a notification tapped opens the screen it was about, exactly as the
 *   service worker does for a browser;
 *
 *   on every launch with permission already granted, the phone's token is
 *   asked for again and saved again. Apple rotates tokens without saying
 *   so, and a phone that changed hands is rebound to whoever is signed in
 *   now. Skipped if the manager turned this device off.
 *
 * Renders nothing. Mounted once, in the root layout, above the router.
 */
export function NativeBridge() {
  const router = useRouter();
  const { user, ready } = useSession();

  useEffect(() => {
    if (!isNativeApp()) return;
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];

    const go = (target: string) => {
      try {
        const url = new URL(target, location.origin);
        if (url.origin !== location.origin) return;
        router.push(url.pathname + url.search + url.hash);
      } catch { /* not a URL we can open */ }
    };

    void import("@capacitor/app").then(({ App }) => {
      handles.push(App.addListener("appUrlOpen", ({ url }) => go(url)));
    });
    void import("@capacitor/push-notifications").then(({ PushNotifications }) => {
      handles.push(PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
        const url = (a.notification.data as { url?: string } | undefined)?.url;
        if (url) go(url);
      }));
    });

    return () => { handles.forEach((h) => void h.then((x) => x.remove())); };
  }, [router]);

  useEffect(() => {
    if (!isNativeApp() || !ready || !user) return;
    let off = false;
    try { off = !!localStorage.getItem(NATIVE_PUSH_OFF); } catch { /* ignore */ }
    if (off) return;

    void (async () => {
      if ((await nativePushPermission()) !== "granted") return;
      try {
        const token = await registerNativePush();
        const { error } = await supabaseBrowser().rpc("ff_save_native_push_token", {
          p_platform: "ios", p_token: token, p_user_agent: navigator.userAgent,
        });
        if (!error) { try { localStorage.setItem(NATIVE_PUSH_TOKEN, token); } catch { /* ignore */ } }
      } catch { /* a launch is not the place to complain; the settings card will */ }
    })();
  }, [ready, user]);

  return null;
}
