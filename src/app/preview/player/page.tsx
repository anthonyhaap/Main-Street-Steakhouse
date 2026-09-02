"use client";

/**
 * Fixture harness for the player page. Not linked from anywhere.
 *
 * Unlike the team fixture, nothing here is invented: this is a verbatim
 * snapshot of what `ff_player_card` returned for one player on 1 September
 * 2026 — the real bio, the real 2025 game log scored under our rules, the real
 * injury report and the real projections. It is a snapshot rather than a live
 * call so the layout can be inspected without a session, and it will go stale;
 * that is the trade, and the banner says so.
 */

import { TopBar } from "@/components/Shell";
import { PlayerPage } from "@/components/player/PlayerPage";
import { CARD } from "./fixture";

export default function PlayerPreviewPage() {
  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> A verbatim snapshot of one real{" "}
        <code>ff_player_card</code> response, kept static so the layout renders
        without a session. The live page reads the same shape from the database.
      </div>
      <PlayerPage card={CARD} />
    </>
  );
}
