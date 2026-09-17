"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Share, SquarePlus, X } from "lucide-react";
import { isStandalone, platformOf, useInstallPrompt } from "@/lib/install";

const KEY = "mss-install-nudge";

/**
 * "Add to Home Screen", once, on a phone.
 *
 * On an iPhone this is the difference between a website and the league app:
 * standalone mode drops Safari's chrome and the card fills the screen. Safari
 * has no install prompt, so the nudge shows the two taps. Android does have
 * one, and the button calls it.
 *
 * Shows on the first mobile visit only, never in the installed app, and a
 * dismissal sticks — /install, behind More, is the way back.
 */
export function InstallNudge() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const { prompt, install } = useInstallPrompt();

  useEffect(() => {
    const mobile = platformOf() !== "other";
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(KEY); } catch { /* ignore */ }
    if (isStandalone() || !mobile || dismissed) return;

    // After the curtain, not under it.
    const id = setTimeout(() => {
      setIos(platformOf() === "ios");
      setShow(true);
    }, 2200);
    return () => clearTimeout(id);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
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
        <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
          {prompt && (
            <button className="btn" data-v="primary" data-size="sm" onClick={() => void install().then(dismiss)}>Add to Home Screen</button>
          )}
          <Link className="btn" data-v="ghost" data-size="sm" href="/install" onClick={dismiss}>Show me how</Link>
        </div>
      </div>
      <button className="nudge__close" onClick={dismiss} aria-label="Not now"><X size={16} /></button>
    </aside>
  );
}
