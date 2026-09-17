"use client";

import { useEffect, useState } from "react";
import { Bell, Expand, MoreVertical, Share, Smartphone, SquarePlus } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { platformOf, useInstallPrompt, useStandalone, type Platform } from "@/lib/install";

/**
 * How to put the league on a phone.
 *
 * There is no App Store listing and there will not be one: the site already
 * installs from the browser, which is the only route that costs nothing, and
 * a private twelve-manager league gains nothing from a store but a fee. What
 * a manager needs is the two taps, which the first-visit nudge showed once
 * and then, having been dismissed, never again. This page is the way back,
 * behind More.
 *
 * Public, like the previews: it reads nothing and a manager may want it
 * before signing in.
 */
export default function InstallPage() {
  const standalone = useStandalone();
  const { prompt, install } = useInstallPrompt();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [done, setDone] = useState(false);

  // The platform is read after mount so the server and the browser render the
  // same page; until then every platform's steps show in a neutral order.
  useEffect(() => {
    const id = setTimeout(() => setPlatform(platformOf()), 0);
    return () => clearTimeout(id);
  }, []);

  const order: Platform[] = platform === "android" ? ["android", "ios", "other"] : ["ios", "android", "other"];

  return (
    <>
      <TopBar />
      <main className="page">
        <header className="bets__head">
          <div>
            <div className="eyebrow" data-tone="gold">On your phone</div>
            <h1 className="display bets__h1">Install the app</h1>
            <p className="prose">
              No app store, nothing to pay. The league installs from the browser you are already in,
              and opens from your home screen like anything else on it.
            </p>
          </div>
        </header>

        {standalone && (
          <div className="note" data-kind="ok" style={{ marginBottom: "var(--s4)" }}>
            <strong>You&apos;re in the app.</strong> This is the installed version, full screen, from the home screen.
          </div>
        )}

        <div className="grid-auto">
          {order.map((p) => (
            <section key={p} className="card install" data-accent={p === platform ? "gold" : undefined} aria-label={LABEL[p]}>
              <div className="card__head">
                <h2>{LABEL[p]}</h2>
                {p === platform && <span className="badge" data-tone="ok">This phone</span>}
              </div>
              <div className="card__body">
                {p === "ios" && (
                  <ol className="install__steps">
                    <li>Open the league in <b>Safari</b>. Other browsers on an iPhone can&apos;t install it.</li>
                    <li>Tap <Share size={14} aria-label="Share" /> <b>Share</b> at the bottom of the screen.</li>
                    <li>Scroll the sheet and tap <SquarePlus size={14} aria-hidden /> <b>Add to Home Screen</b>, then <b>Add</b>.</li>
                  </ol>
                )}
                {p === "android" && (
                  <>
                    {prompt && !done ? (
                      <div style={{ marginBottom: "var(--s3)" }}>
                        <button className="btn" data-v="primary" onClick={() => void install().then((r) => setDone(r === "accepted"))}>
                          <Smartphone size={14} />Add to Home Screen
                        </button>
                      </div>
                    ) : done ? (
                      <div className="note" data-kind="ok" style={{ marginBottom: "var(--s3)" }}>Added. Look for the crest on your home screen.</div>
                    ) : null}
                    <ol className="install__steps">
                      <li>Open the league in <b>Chrome</b>.</li>
                      <li>Tap <MoreVertical size={14} aria-label="Menu" /> the menu in the corner.</li>
                      <li>Tap <b>Add to Home screen</b> (some phones say <b>Install app</b>), then <b>Add</b>.</li>
                    </ol>
                  </>
                )}
                {p === "other" && (
                  <ol className="install__steps">
                    <li>Open this page on your phone — that is where the app belongs.</li>
                    <li>On a laptop, Chrome and Edge show an install icon at the right end of the address bar.</li>
                  </ol>
                )}
              </div>
            </section>
          ))}
        </div>

        <section className="card" style={{ marginTop: "var(--s4)" }} aria-label="Why install">
          <div className="card__head"><h2>What you get</h2></div>
          <div className="card__body install__why">
            <p><Bell size={15} /> <b>Notifications.</b> Trades, waivers, bets and the Weekly Special reach your phone — on an iPhone, only from the home screen.</p>
            <p><Expand size={15} /> <b>The whole screen.</b> No address bar, no tabs; the card fills the phone and the tab bar sits above the thumb.</p>
            <p><Smartphone size={15} /> <b>A crest on the home screen.</b> One tap, and it opens on tonight&apos;s table.</p>
          </div>
        </section>
      </main>
    </>
  );
}

const LABEL: Record<Platform, string> = { ios: "iPhone", android: "Android", other: "Everything else" };
