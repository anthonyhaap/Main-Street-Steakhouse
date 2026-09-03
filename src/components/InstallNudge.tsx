"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";

const KEY = "mss-install-nudge";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Add to Home Screen", once, on a phone.
 *
 * On an iPhone this is the difference between a website and the league app:
 * standalone mode drops Safari's chrome and the card fills the screen. Safari
 * has no install prompt, so the nudge shows the two taps. Android does have
 * one, and the button calls it.
 *
 * Shows on the first mobile visit only, never in the installed app, and a
 * dismissal sticks.
 */
export function InstallNudge() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(KEY); } catch { /* ignore */ }
    if (standalone || !mobile || dismissed) return;

    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // After the curtain, not under it.
    const id = setTimeout(() => {
      setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
      setShow(true);
    }, 2200);
    return () => { clearTimeout(id); window.removeEventListener("beforeinstallprompt", onPrompt); };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    dismiss();
  };

  return (
    <aside className="nudge" role="note">
      <div className="nudge__body">
        <span className="eyebrow" data-tone="gold">Put it on your home screen</span>
        {ios ? (
          <p>
            Tap <Share size={13} aria-label="Share" /> below, then <b>Add to Home Screen</b>{" "}
            <SquarePlus size={13} aria-hidden />. No address bar, no tabs — just the league.
          </p>
        ) : prompt ? (
          <p>One tap and it opens like an app — full screen, from the home screen.</p>
        ) : (
          <p>Open the browser menu and choose <b>Add to Home screen</b>. It opens full screen, like an app.</p>
        )}
        {prompt && (
          <button className="btn" data-v="primary" data-size="sm" onClick={install}>Add to Home Screen</button>
        )}
      </div>
      <button className="nudge__close" onClick={dismiss} aria-label="Not now"><X size={16} /></button>
    </aside>
  );
}
