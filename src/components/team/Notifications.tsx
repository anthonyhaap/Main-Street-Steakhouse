"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePush, type PushState } from "@/lib/push";
import { useToast } from "@/components/ui";

/**
 * Notifications, as a manager sets them up.
 *
 * Two separate things, deliberately shown as two: whether THIS device may be
 * pushed to, and which kinds he wants anywhere. A manager who turns his laptop
 * off should not lose the preference he set on his phone, so the switches live
 * on his account and the permission lives on the device.
 *
 * Split into a card and a container for the same reason every other screen here
 * is: the card is what /preview/notifications renders, so the sentences below
 * can be asserted without a session, a device, or a push service.
 */

export type Prefs = { trades: boolean; waivers: boolean; devices: number };

/** Each state needs its own sentence — "denied" in particular, because script
 *  cannot re-ask and the manager has to go to the browser's own settings. */
const SAYS: Record<PushState, string> = {
  unsupported: "This browser can't do notifications. Safari on a Mac and Chrome on anything will.",
  "ios-needs-install": "On an iPhone, notifications only work once the app is on your home screen: tap Share, then Add to Home Screen, and come back here.",
  "ios-app-denied": "Notifications are off for the Steakhouse app. Settings, then Notifications, then Steakhouse is the only place that can turn them back on.",
  denied: "You've blocked notifications for this site. Your browser's own site settings are the only place that can undo it.",
  off: "Off on this device.",
  on: "On for this device.",
};

export function NotificationsCard({
  state, busy, error, prefs, saving, onEnable, onDisable, onSet,
}: {
  state: PushState | null;
  busy: boolean;
  error: string | null;
  prefs: Prefs | null;
  saving: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onSet: (next: Partial<Prefs>) => void;
}) {
  const canToggle = state === "off" || state === "on";

  return (
    <div className="card">
      <div className="card__head">
        <h2>Notifications</h2>
        {prefs && prefs.devices > 0 && (
          <span className="eyebrow">
            <span className="num">{prefs.devices}</span> {prefs.devices === 1 ? "device" : "devices"}
          </span>
        )}
      </div>

      <div className="card__body" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
          {state === "on"
            ? <Bell size={15} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 2 }} />
            : <BellOff size={15} style={{ color: "var(--faint)", flexShrink: 0, marginTop: 2 }} />}
          <span className="eyebrow" style={{ lineHeight: 1.5 }}>
            {state ? SAYS[state] : "Checking…"}
          </span>
        </div>

        {canToggle && (
          <button
            className="btn"
            data-v={state === "on" ? undefined : "primary"}
            disabled={busy}
            onClick={() => (state === "on" ? onDisable() : onEnable())}
          >
            {busy ? "…" : state === "on" ? "Turn off on this device" : "Turn on for this device"}
          </button>
        )}

        {error && <div className="note" data-kind="error">{error}</div>}

        {prefs && (
          <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <span className="eyebrow">Tell me about</span>
            {([
              ["trades", "Trade offers and answers"],
              ["waivers", "Waiver results"],
            ] as ["trades" | "waivers", string][]).map(([k, label]) => (
              <label key={k} style={{ display: "flex", gap: 9, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={prefs[k]}
                  disabled={saving}
                  onChange={(e) => onSet({ [k]: e.target.checked } as Partial<Prefs>)}
                />
                <span style={{ fontSize: "var(--t-small)" }}>{label}</span>
              </label>
            ))}
            <span className="eyebrow" style={{ color: "var(--faint)", lineHeight: 1.5 }}>
              These follow your account, not this device. Nothing else pushes —
              scores, chat and the feed are all yours to look up.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function Notifications() {
  const { state, busy, error, enable, disable } = usePush();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("ff_notification_prefs");
    if (data) setPrefs(data as Prefs);
  }, []);

  useEffect(() => { void load(); }, [load, state]);

  const set = useCallback(async (next: Partial<Prefs>) => {
    if (!prefs) return;
    const merged = { ...prefs, ...next };
    setPrefs(merged);              // optimistic: a switch that lags reads as broken
    setSaving(true);
    const { data, error: rpcError } = await supabaseBrowser().rpc("ff_set_notification_prefs", {
      p_trades: merged.trades, p_waivers: merged.waivers,
    });
    setSaving(false);
    if (rpcError) {
      setPrefs(prefs);
      toast("error", rpcError.message);
    } else if (data) {
      setPrefs(data as Prefs);
    }
  }, [prefs, toast]);

  return (
    <NotificationsCard
      state={state}
      busy={busy}
      error={error}
      prefs={prefs}
      saving={saving}
      onEnable={() => void enable()}
      onDisable={() => void disable()}
      onSet={(next) => void set(next)}
    />
  );
}
