"use client";

/**
 * Fixture harness for the commissioner's rule editors. Renders them from a
 * static league so the layout can be inspected without being signed in as the
 * commissioner. Saves only raise a toast. Not linked from anywhere.
 */

import { Scale, ScrollText } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { useToast } from "@/components/ui";
import { LeagueRules, ScoringEditor } from "@/components/admin/RulesEditors";
import type { League, ScoringRuleSet } from "@/lib/types";

const league: League = {
  id: "L",
  name: "Main Street Steakhouse",
  season: 2026,
  team_count: 12,
  commissioner_id: "u0",
  roster_slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN", "BN", "BN", "BN"],
  scoring_rules: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    fum_lost: -2, st_td: 6, st_fum_rec: 1,
    fg_0_39: 3, fg_40_49: 4, fg_50_plus: 5, fg_miss: 0, xp_made: 1, xp_miss: 0,
    dst_sack: 1, dst_int: 2, dst_fum_rec: 2, dst_forced_fumble: 1, dst_safety: 2, dst_td: 6, dst_blocked_kick: 2,
    dst_pa_0: 10, dst_pa_1_6: 7, dst_pa_7_13: 4, dst_pa_14_20: 1, dst_pa_21_27: 0, dst_pa_28_34: -1, dst_pa_35_plus: -4,
  },
  settings: {
    regular_season_weeks: 14, playoff_teams: 6, playoff_byes: 2, playoff_weeks: [15, 16, 17],
    trade_deadline_week: 12, waiver_type: "rolling_priority", waiver_run_day: "wednesday", keepers: false,
  },
};

const rules: ScoringRuleSet[] = [
  { id: "r1", effective_from_week: 1, note: null, created_at: new Date(Date.now() - 4.1e9).toISOString() },
  { id: "r2", effective_from_week: 5, note: "Half-point per reception for tight ends was voted down; back to full PPR.", created_at: new Date(Date.now() - 1.2e9).toISOString() },
];

export default function Preview() {
  const toast = useToast();
  return (
    <>
      <TopBar status="live" />
      <main className="page" data-width="narrow">
        <section className="card">
          <div className="card__head">
            <div>
              <h2>League rules</h2>
              <div className="eyebrow" style={{ marginTop: 5 }}>Editable all season</div>
            </div>
            <Scale size={17} color="var(--gold)" />
          </div>
          <LeagueRules
            league={league} teamCount={12} scheduled={84} busy={false} leagueId="L"
            onSave={async (_fn, _args, ok) => { toast("ok", `Preview only — ${ok}`); return true; }}
          />
        </section>

        <section className="card">
          <div className="card__head">
            <div>
              <h2>Scoring</h2>
              <div className="eyebrow" style={{ marginTop: 5 }}>2 rule sets on record · week 7</div>
            </div>
            <ScrollText size={17} color="var(--gold)" />
          </div>
          <ScoringEditor
            league={league} week={7} rules={rules}
            onSave={async (_rules, from) => { toast("ok", `Preview only — would apply from week ${from}.`); return true; }}
          />
        </section>
      </main>
    </>
  );
}
