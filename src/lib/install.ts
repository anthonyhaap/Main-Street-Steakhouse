"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * The app, on the phone: what the browser can tell us about whether it is
 * installed, and the one install prompt it offers.
 *
 * Shared by the first-visit nudge on Tonight's Table, the row in the More
 * sheet and /install, so the three agree about what "installed" means.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type Platform = "ios" | "android" | "other";

export function platformOf(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Running from the home screen, in the app's own window. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const subscribeStandalone = (cb: () => void) => {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** `isStandalone`, as a hook: false on the server, true only in the installed app. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
}

/**
 * Android's install prompt, when the browser offers one. Chrome fires
 * `beforeinstallprompt` once the site qualifies; the event is kept so a
 * button can call it later, which is the only way a script may show it.
 */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "none"> => {
    if (!prompt) return "none";
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setPrompt(null);
    return outcome;
  }, [prompt]);

  return { prompt, install };
}
