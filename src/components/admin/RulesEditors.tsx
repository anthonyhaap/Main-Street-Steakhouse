"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { League, LeagueSettings, ScoringRuleSet } from "@/lib/types";
import { useToast } from "@/components/ui";

/**
 * The commissioner's rule editors. Pure UI: every write goes back through the
 * callbacks so the same components render from a fixture on the preview page
 * and from the league on /admin.
 */

export type SaveFn = (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;

export const compact: React.CSSProperties = { minHeight: 38, padding: "8px 11px" };

export function Field({ label, hint, style, children }: {
  label: string; hint?: React.ReactNode; style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 7, alignContent: "start", ...style }}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span style={{ fontSize: "var(--t-micro)", color: "var(--dim)", lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

/* ---------------------------------------------------------- league rules -- */

const SLOT_NAMES = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BN"];
const WAIVER_TYPES: [string, string][] = [
  ["rolling_priority", "Rolling priority"],
  ["reverse_standings", "Reverse standings, weekly"],
  ["faab", "FAAB bidding"],
];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const num = (v: unknown, d: number) =>
  v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Single elimination: 6 teams with 2 byes is three rounds, 4 teams is two. */
export const playoffRounds = (teams: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))));

export function LeagueRules({ league, teamCount, scheduled, busy, onSave, leagueId }: {
  league: League;
  teamCount: number;
  /** Matchups already generated; changing the season length won't touch them. */
  scheduled: number;
  busy: boolean;
  onSave: SaveFn;
  leagueId: string;
}) {
  const toast = useToast();
  const s = (league.settings ?? {}) as LeagueSettings;

  const [name, setName] = useState(league.name);
  const [weeks, setWeeks] = useState(num(s.regular_season_weeks, 14));
  const [playoffTeams, setPlayoffTeams] = useState(num(s.playoff_teams, 6));
  const [byes, setByes] = useState(num(s.playoff_byes, 0));
  const [deadline, setDeadline] = useState(num(s.trade_deadline_week, Math.max(1, num(s.regular_season_weeks, 14) - 2)));
  const [waiver, setWaiver] = useState(s.waiver_type ?? "rolling_priority");
  const [waiverDay, setWaiverDay] = useState(s.waiver_run_day ?? "wednesday");
  const [keepers, setKeepers] = useState(!!s.keepers);
  const [slots, setSlots] = useState((league.roster_slots ?? []).join(", "));

  const parsedSlots = useMemo(
    () => slots.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
    [slots],
  );
  const badSlots = parsedSlots.filter((x) => !SLOT_NAMES.includes(x));
  const starters = parsedSlots.filter((x) => x !== "BN").length;

  const rounds = playoffRounds(playoffTeams);
  const playoffWeeks = Array.from({ length: rounds }, (_, i) => weeks + 1 + i);

  const next: LeagueSettings = {
    regular_season_weeks: weeks,
    playoff_teams: playoffTeams,
    playoff_byes: byes,
    playoff_weeks: playoffWeeks,
    trade_deadline_week: deadline,
    waiver_type: waiver,
    waiver_run_day: waiverDay,
    keepers,
  };

  const settingsDirty = (Object.keys(next) as (keyof LeagueSettings)[])
    .some((k) => JSON.stringify(next[k]) !== JSON.stringify(s[k]));
  const slotsDirty = JSON.stringify(parsedSlots) !== JSON.stringify(league.roster_slots ?? []);
  const dirty = name !== league.name || settingsDirty || slotsDirty;

  const problem =
    !name.trim() ? "The league needs a name."
    : !Number.isInteger(weeks) || weeks < 1 || weeks > 17 ? "The regular season runs 1 to 17 weeks."
    : !Number.isInteger(playoffTeams) || playoffTeams < 2 || playoffTeams > teamCount ? `Playoff teams must be between 2 and ${teamCount}.`
    : !Number.isInteger(byes) || byes < 0 || byes >= playoffTeams ? "Byes have to be fewer than playoff teams."
    : weeks + rounds > 18 ? `A ${rounds}-round playoff after week ${weeks} runs past week 18.`
    : !Number.isInteger(deadline) || deadline < 1 || deadline > weeks ? "The trade deadline has to fall inside the regular season."
    : parsedSlots.length === 0 ? "The roster needs at least one slot."
    : badSlots.length ? `Unknown roster slot: ${badSlots.join(", ")}. Use ${SLOT_NAMES.join(", ")}.`
    : null;

  function reset() {
    setName(league.name);
    setWeeks(num(s.regular_season_weeks, 14));
    setPlayoffTeams(num(s.playoff_teams, 6));
    setByes(num(s.playoff_byes, 0));
    setDeadline(num(s.trade_deadline_week, Math.max(1, num(s.regular_season_weeks, 14) - 2)));
    setWaiver(s.waiver_type ?? "rolling_priority");
    setWaiverDay(s.waiver_run_day ?? "wednesday");
    setKeepers(!!s.keepers);
    setSlots((league.roster_slots ?? []).join(", "));
  }

  async function save() {
    if (problem) return toast("error", problem);
    await onSave("ff_update_league", {
      p_league_id: leagueId,
      p_name: name.trim(),
      p_roster_slots: slotsDirty ? parsedSlots : null,
      p_settings: next,
    }, "League rules saved.");
  }

  const int = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.value === "" ? NaN : Number(e.target.value));

  return (
    <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
      <Field label="League name">
        <input className="field" style={compact} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div style={{ display: "grid", gap: "var(--s4)", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Field label="Regular season" hint={`Weeks 1–${Number.isNaN(weeks) ? "?" : weeks}`}>
          <input className="field num" style={compact} type="number" min={1} max={17}
            value={Number.isNaN(weeks) ? "" : weeks} onChange={int(setWeeks)} />
        </Field>
        <Field label="Playoff teams" hint={`${rounds} round${rounds === 1 ? "" : "s"} · weeks ${playoffWeeks.join(", ")}`}>
          <input className="field num" style={compact} type="number" min={2} max={teamCount}
            value={Number.isNaN(playoffTeams) ? "" : playoffTeams} onChange={int(setPlayoffTeams)} />
        </Field>
        <Field label="First-round byes" hint="Top seeds that skip round one">
          <input className="field num" style={compact} type="number" min={0} max={Math.max(0, playoffTeams - 1)}
            value={Number.isNaN(byes) ? "" : byes} onChange={int(setByes)} />
        </Field>
        <Field label="Trade deadline" hint="Last week trades go through">
          <input className="field num" style={compact} type="number" min={1} max={Number.isNaN(weeks) ? 17 : weeks}
            value={Number.isNaN(deadline) ? "" : deadline} onChange={int(setDeadline)} />
        </Field>
      </div>

      <div style={{ display: "grid", gap: "var(--s4)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Field label="Waivers">
          <select className="field" style={compact} value={waiver} onChange={(e) => setWaiver(e.target.value)}>
            {WAIVER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!WAIVER_TYPES.some(([v]) => v === waiver) && <option value={waiver}>{waiver}</option>}
          </select>
        </Field>
        <Field label="Waivers run">
          <select className="field" style={compact} value={waiverDay} onChange={(e) => setWaiverDay(e.target.value)}>
            {DAYS.map((d) => <option key={d} value={d}>{cap(d)}</option>)}
            {!DAYS.includes(waiverDay) && <option value={waiverDay}>{cap(waiverDay)}</option>}
          </select>
        </Field>
        <Field label="Keepers">
          <label className="field" style={{ ...compact, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={keepers} onChange={(e) => setKeepers(e.target.checked)} />
            <span style={{ fontSize: "var(--t-small)" }}>{keepers ? "Keeper league" : "Redraft every year"}</span>
          </label>
        </Field>
      </div>

      <Field
        label="Roster slots"
        hint={
          badSlots.length
            ? `Unknown: ${badSlots.join(", ")}`
            : `${parsedSlots.length} slots · ${starters} starters, ${parsedSlots.length - starters} bench. Lineups set from now on use these.`
        }
      >
        <input className="field" style={{ ...compact, fontFamily: "var(--mono, monospace)", fontSize: "var(--t-small)" }}
          value={slots} onChange={(e) => setSlots(e.target.value)} spellCheck={false} autoComplete="off" />
      </Field>

      {scheduled > 0 && weeks !== num(s.regular_season_weeks, 14) && (
        <div className="note" data-kind="info" style={{ borderRadius: "var(--r-sm)", borderBottom: 0 }}>
          The schedule is already generated. Changing the season length doesn&apos;t regenerate
          it; run <b>Generate schedule</b> below if you mean to, which wipes results.
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" data-v="primary" disabled={busy || !dirty} onClick={save}>
          <Save size={14} /> Save rules
        </button>
        <button className="btn" data-v="ghost" disabled={!dirty} onClick={reset}>
          <RotateCcw size={14} /> Reset
        </button>
        {dirty && problem && (
          <span style={{ fontSize: "var(--t-micro)", color: "var(--lose)" }}>{problem}</span>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- scoring -- */

const RULE_GROUPS: { title: string; rules: [string, string][] }[] = [
  { title: "Passing", rules: [
    ["pass_yd", "Per passing yard"], ["pass_td", "Passing TD"],
    ["pass_int", "Interception thrown"], ["pass_2pt", "2-pt pass"],
  ] },
  { title: "Rushing", rules: [
    ["rush_yd", "Per rushing yard"], ["rush_td", "Rushing TD"], ["rush_2pt", "2-pt rush"],
  ] },
  { title: "Receiving", rules: [
    ["rec", "Reception"], ["rec_yd", "Per receiving yard"], ["rec_td", "Receiving TD"], ["rec_2pt", "2-pt catch"],
  ] },
  { title: "Turnovers & returns", rules: [
    ["fum_lost", "Fumble lost"], ["st_td", "Return TD"], ["st_fum_rec", "Special-teams fumble recovery"],
  ] },
  { title: "Kicking", rules: [
    ["fg_0_39", "FG 0–39"], ["fg_40_49", "FG 40–49"], ["fg_50_plus", "FG 50+"],
    ["fg_miss", "FG missed"], ["xp_made", "XP made"], ["xp_miss", "XP missed"],
  ] },
  { title: "Defense", rules: [
    ["dst_sack", "Sack"], ["dst_int", "Interception"], ["dst_fum_rec", "Fumble recovery"],
    ["dst_forced_fumble", "Forced fumble"], ["dst_safety", "Safety"], ["dst_td", "Defensive TD"],
    ["dst_blocked_kick", "Blocked kick"],
  ] },
  { title: "Points allowed", rules: [
    ["dst_pa_0", "Shutout"], ["dst_pa_1_6", "1–6"], ["dst_pa_7_13", "7–13"], ["dst_pa_14_20", "14–20"],
    ["dst_pa_21_27", "21–27"], ["dst_pa_28_34", "28–34"], ["dst_pa_35_plus", "35+"],
  ] },
];

export type SaveScoring = (rules: Record<string, number>, fromWeek: number, note: string | null) => Promise<boolean>;

export function ScoringEditor({ league, week, rules, onSave }: {
  league: League;
  /** The current NFL week; the default effective week and the rescore bound. */
  week: number;
  rules: ScoringRuleSet[];
  onSave: SaveScoring;
}) {
  const toast = useToast();
  const current = useMemo(() => league.scoring_rules ?? {}, [league.scoring_rules]);
  const known = useMemo(() => new Set(RULE_GROUPS.flatMap((g) => g.rules.map(([k]) => k))), []);
  const extras = useMemo(() => Object.keys(current).filter((k) => !known.has(k)).sort(), [current, known]);

  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of RULE_GROUPS) for (const [k] of g.rules) out[k] = String(current[k] ?? 0);
    for (const k of extras) out[k] = String(current[k]);
    return out;
  }, [current, extras]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [from, setFrom] = useState(Math.min(18, Math.max(1, week)));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const changed = Object.keys(values).filter((k) => Number(values[k]) !== Number(current[k] ?? 0));
  const invalid = Object.entries(values).filter(([, v]) => v.trim() === "" || !Number.isFinite(Number(v)));
  const dirty = changed.length > 0;

  async function save() {
    if (invalid.length) return toast("error", "Every rule needs a number.");
    const out: Record<string, number> = {};
    for (const k of Object.keys(values)) out[k] = Number(values[k]);
    setSaving(true);
    try {
      await onSave(out, from, note.trim() || null);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const groups = extras.length
    ? [...RULE_GROUPS, { title: "Other", rules: extras.map((k): [string, string] => [k, k]) }]
    : RULE_GROUPS;

  return (
    <>
      <div className="note" data-kind="info">
        Points per event. Changes are versioned by week: pick the week they start and every
        earlier week keeps the rules it was played under. Choose week 1 to rescore the whole season.
      </div>

      <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div className="eyebrow" data-tone="gold" style={{ marginBottom: "var(--s3)" }}>{g.title}</div>
            <div style={{ display: "grid", gap: "var(--s3)", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {g.rules.map(([k, label]) => {
                const edited = Number(values[k]) !== Number(current[k] ?? 0);
                return (
                  <label key={k} style={{ display: "grid", gap: 5 }}>
                    <span style={{ fontSize: "var(--t-micro)", fontWeight: 600, color: edited ? "var(--gold)" : "var(--dim)", lineHeight: 1.3 }}>
                      {label}
                    </span>
                    <input className="field num" type="number" step="any" inputMode="decimal"
                      style={{ ...compact, borderColor: edited ? "var(--gold-lit)" : undefined }}
                      value={values[k]} onChange={set(k)} aria-label={label} />
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{
          display: "flex", gap: "var(--s4)", flexWrap: "wrap", alignItems: "flex-end",
          borderTop: "1px solid var(--rule)", paddingTop: "var(--s5)",
        }}>
          <Field label="Effective from week">
            <select className="field" style={{ ...compact, width: 120 }} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>{w}{w === week ? " (now)" : ""}</option>
              ))}
            </select>
          </Field>
          <Field label="Note" style={{ flex: "1 1 220px" }}>
            <input className="field" style={compact} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Why it changed — kept with the rule set" maxLength={200} />
          </Field>
          <div style={{ display: "flex", gap: "var(--s2)" }}>
            <button className="btn" data-v="primary" disabled={saving || !dirty || invalid.length > 0} onClick={save}>
              <Save size={14} /> {saving ? "Saving" : "Save scoring"}
            </button>
            <button className="btn" data-v="ghost" disabled={saving || !dirty} onClick={() => setValues(initial)}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>

        <span className="eyebrow">
          {changed.length} rule{changed.length === 1 ? "" : "s"} changed ·{" "}
          {from > week ? `applies from week ${from}`
            : from === week ? `week ${week} gets rescored`
            : `weeks ${from}–${week} get rescored`}
        </span>
      </div>

      {rules.length > 0 && (
        <div className="rows" style={{ borderTop: "1px solid var(--rule)" }}>
          {rules.map((r) => (
            <div className="row" key={r.id} style={{ fontSize: "var(--t-small)" }}>
              <span className="eyebrow" style={{ width: 72 }}>Week {r.effective_from_week}+</span>
              <span style={{ flex: 1, minWidth: 0, color: r.note ? "var(--cream)" : "var(--dim)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.note || "No note"}
              </span>
              <span className="num" style={{ fontSize: "var(--t-micro)", color: "var(--dim)" }}>
                {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
