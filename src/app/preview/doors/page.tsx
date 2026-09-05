"use client";

/**
 * Fixture harness for the entrance. The real doors only open once, on the way
 * out of /login or /join, which is a hard thing to look at twice — this plays
 * them on demand against a stand-in for the room behind them. Not linked from
 * anywhere.
 */

import { useState } from "react";
import { DOOR_TOTAL, enterThroughDoors } from "@/components/Doors";

export default function Page() {
  const [entries, setEntries] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function play() {
    setBusy(true);
    // Stands in for the router.push the auth screens hand over: it runs while
    // the screen is white, and what it changes is revealed by the smoke.
    enterThroughDoors(() => setEntries((list) => [new Date().toLocaleTimeString(), ...list]));
    window.setTimeout(() => setBusy(false), DOOR_TOTAL);
  }

  return (
    <main className="page" data-width="narrow">
      <section className="card">
        <div className="card__head">
          <div>
            <div className="eyebrow" style={{ color: "var(--gold)" }}>Fixture</div>
            <h1 style={{ margin: "5px 0 0", fontFamily: "var(--serif)" }}>The doors</h1>
          </div>
        </div>
        <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
          <p className="prose" style={{ margin: 0 }}>
            What a manager sees between hitting <em>Sign in</em> and landing at their
            table: the house closes, the leaves swing out into white smoke, and the
            page changes underneath while the screen is still white.
          </p>
          <div>
            <button className="btn" data-v="primary" onClick={play} disabled={busy}>
              {busy ? "Opening…" : "Open the doors"}
            </button>
          </div>
          <div>
            <span className="eyebrow">Handed over</span>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
              {entries.length === 0
                ? <li style={{ color: "var(--dim)" }}>Nothing yet.</li>
                : entries.map((at, i) => (
                    <li key={`${at}-${i}`} data-testid="door-entry" style={{ fontFamily: "var(--mono)", fontSize: "var(--t-small)" }}>
                      Walked in at {at}
                    </li>
                  ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
