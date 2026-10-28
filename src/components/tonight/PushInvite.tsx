"use client";

import { Bell } from "lucide-react";
import { useOfferDismissed, usePush, type PushState } from "@/lib/push";

/**
 * Alerts, offered once on the front page.
 *
 * Until this, the only unasked-for offer was under your matchup in the Game
 * Center, on a game day — and a phone that never opened the Game Center on a
 * Sunday was never asked. The front page is the screen every manager opens.
 *
 * Shown only where a tap can actually subscribe (`off`): an iPhone in Safari
 * is told about the home screen by the install nudge beside it, and a device
 * that is already on, blocked, or unable says nothing here — the settings on
 * My Team say why. "Not now" is remembered on this device, apart from the
 * Game Center's own offer.
 */
export function PushInviteView({ state, busy, error, onEnable, onDismiss }: {
  state: PushState | null;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  if (state !== "off") return null;
  return (
    <aside className="pinvite" aria-label="Turn on alerts">
      <Bell size={16} aria-hidden />
      <div className="pinvite__body">
        <b>Turn on alerts on this device.</b>
        <span>Lead changes in your matchup, trade offers, waiver results and the Weekly Special — not every catch.</span>
        {error && <span className="pinvite__err" role="alert">{error}</span>}
        <span className="pinvite__act">
          <button type="button" className="btn" data-v="primary" data-size="sm" disabled={busy} onClick={onEnable}>
            {busy ? "…" : "Turn on"}
          </button>
          <button type="button" className="btn" data-v="ghost" data-size="sm" onClick={onDismiss}>Not now</button>
        </span>
      </div>
    </aside>
  );
}

export function PushInvite() {
  const { state, busy, error, enable } = usePush();
  const [dismissed, dismiss] = useOfferDismissed("home-push-offer-dismissed");
  if (dismissed) return null;
  return <PushInviteView state={state} busy={busy} error={error} onEnable={() => void enable()} onDismiss={dismiss} />;
}
