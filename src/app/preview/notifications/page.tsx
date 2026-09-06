"use client";

/**
 * Fixture harness for the notifications card. Reads no database and touches no
 * push service.
 *
 * The real card depends on four things a test cannot arrange — a session, a
 * granted permission, a registered service worker and a push endpoint — and the
 * states worth reading are precisely the ones you cannot reach on demand. A
 * blocked permission and an iPhone that has not been installed to the home
 * screen are both dead ends the manager has to be talked out of, and both are
 * only ever seen by the person they are happening to. So they are all here.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { NotificationsCard, type Prefs } from "@/components/team/Notifications";
import type { PushState } from "@/lib/push";

const STATES: PushState[] = ["off", "on", "denied", "ios-needs-install", "unsupported"];

export default function PreviewNotifications() {
  const [state, setState] = useState<PushState>("off");
  const [prefs, setPrefs] = useState<Prefs>({ trades: true, waivers: true, devices: 2 });

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <h2>Preview: notifications</h2>
          </div>
          <div className="card__body">
            <div className="segmented" role="group" aria-label="Push state">
              {STATES.map((s) => (
                <button
                  key={s}
                  className="segmented__opt"
                  data-on={state === s}
                  onClick={() => setState(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <NotificationsCard
          state={state}
          busy={false}
          error={null}
          prefs={state === "unsupported" ? null : prefs}
          saving={false}
          onEnable={() => setState("on")}
          onDisable={() => setState("off")}
          onSet={(next) => setPrefs({ ...prefs, ...next })}
        />
      </main>
    </>
  );
}
