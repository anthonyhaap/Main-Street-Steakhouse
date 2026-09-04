"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, Crown, Dices, Landmark, Link2, ListChecks, Mail, Save, Scale, ScrollText, Send, Timer,
} from "lucide-react";
import { HistoryImport } from "@/components/admin/HistoryImport";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { Draft, League, ScoringRuleSet, Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { crestUrl } from "@/lib/crest";
import { Seal, SkeletonRows, useToast } from "@/components/ui";
import { LeagueRules, ScoringEditor, compact, type SaveFn, type SaveScoring } from "@/components/admin/RulesEditors";

type Admin = {
  league: League;
  draft: Draft;
  teams: Team[];
  week: number;
  rules: ScoringRuleSet[];
  scheduled: number;
};

export default function AdminPage() {
  const { ready, user, reload } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(async (): Promise<Admin> => {
    const supabase = supabaseBrowser();
    const [l, d, t, w, r, m] = await Promise.all([
      supabase.from("leagues").select("*").eq("id", LEAGUE_ID).single(),
      supabase.from("drafts").select("*").eq("id", DRAFT_ID).single(),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      supabase.rpc("ff_current_week"),
      supabase.from("league_scoring_rules")
        .select("id,effective_from_week,note,created_at")
        .eq("league_id", LEAGUE_ID).order("effective_from_week"),
      supabase.from("matchups").select("id", { count: "exact", head: true }).eq("league_id", LEAGUE_ID),
    ]);
    return {
      league: l.data as League,
      draft: d.data as Draft,
      teams: (t.data ?? []) as Team[],
      week: Math.max(1, Number(w.data ?? 1) || 1),
      rules: (r.data ?? []) as ScoringRuleSet[],
      scheduled: m.count ?? 0,
    };
  }, []);

  const { data, status, refetch } = useLive<Admin>(fetcher, {
    tables: ["teams", "drafts", "leagues", "league_scoring_rules"],
    channel: "admin",
    pollMs: 0,
    enabled: ready,
  });

  const refresh = useCallback(async () => {
    await refetch();
    await reload();
  }, [refetch, reload]);

  const call = useCallback<SaveFn>(
    async (fn, args, ok) => {
      setBusy(true);
      const { error } = await supabaseBrowser().rpc(fn, args);
      setBusy(false);
      if (error) toast("error", error.message);
      else toast("ok", ok);
      await refresh();
      return !error;
    },
    [refresh, toast],
  );

  /**
   * The Weekly Special, by hand.
   *
   * The cron writes it at nine every morning for the newest finished week, so
   * this exists for the week the cron missed — a delayed correction, a night
   * the scheduler was down — and for the commissioner who wants to see it land
   * rather than trust that it will. It reports what actually happened, because
   * the interesting answer here is "already written", which is not an error.
   */
  const [recapWeek, setRecapWeek] = useState<number | null>(null);
  const postRecap = useCallback(async (week: number) => {
    setBusy(true);
    const { data: out, error } = await supabaseBrowser()
      .rpc("ff_publish_recap", { p_league_id: LEAGUE_ID, p_week: week });
    setBusy(false);
    if (error) return toast("error", error.message);
    const r = out as { posted?: boolean; reason?: string } | null;
    if (r?.posted) toast("ok", `Week ${week} is in the clubhouse.`);
    else toast("info", `Nothing posted — ${r?.reason ?? "no result"}.`);
  }, [toast]);

  // Two steps on purpose. The rule set is versioned by week and every week is
  // already priced with the rules in force for it; the rescore rewrites the
  // matchup totals so the standings agree now rather than after the next cron.
  const week = data?.week ?? 1;
  const saveScoring = useCallback<SaveScoring>(
    async (rules, from, note) => {
      const sb = supabaseBrowser();
      const set = await sb.rpc("ff_set_scoring_rules", {
        p_league_id: LEAGUE_ID, p_rules: rules, p_effective_from_week: from, p_note: note,
      });
      if (set.error) {
        toast("error", set.error.message);
        return false;
      }
      const re = await sb.rpc("ff_rescore_weeks", { p_league_id: LEAGUE_ID, p_from_week: from });
      if (re.error) toast("error", `Rules saved, but rescoring failed: ${re.error.message}`);
      else if (from > week) toast("ok", `Scoring saved. Takes effect in week ${from}.`);
      else if (from === week) toast("ok", `Scoring saved. Week ${week} rescored.`);
      else toast("ok", `Scoring saved. Weeks ${from}–${week} rescored.`);
      await refresh();
      return !re.error;
    },
    [refresh, toast, week],
  );

  if (!ready || !data) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card"><SkeletonRows n={6} /></div>
        </main>
      </>
    );
  }

  const claimed = !!data.league.commissioner_id;
  const iAmCommish = data.league.commissioner_id === user?.id;
  const linked = data.teams.filter((t) => t.owner_id).length;
  const named = data.teams.filter((t) => t.manager_name).length;

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="narrow">
        {!claimed && (
          <section className="card" data-accent="gold">
            <div className="card__head"><h2>Claim the league</h2><Crown size={17} color="var(--gold)" /></div>
            <div className="card__body">
              <p className="prose" style={{ marginTop: 0 }}>
                Nobody owns this league yet, so commissioner actions are locked for everyone.
                Claiming it is one-time and can&apos;t be undone from the app.
              </p>
              <button className="btn" data-v="primary" disabled={busy}
                onClick={() => call("ff_claim_commissioner", { p_league_id: LEAGUE_ID }, "You're the commissioner.")}>
                <Crown size={14} /> Claim commissioner
              </button>
            </div>
          </section>
        )}

        {claimed && !iAmCommish && (
          <section className="card">
            <div className="empty">This league already has a commissioner.</div>
          </section>
        )}

        {iAmCommish && (
          <>
            <section className="card">
              <div className="card__head">
                <h2>The Weekly Special</h2>
                <ScrollText size={17} color="var(--gold)" />
              </div>
              <div className="card__body">
                <p className="prose" style={{ marginTop: 0, fontSize: "var(--t-small)" }}>
                  The house writes up each week the morning after it finishes and posts it
                  to the clubhouse — every result, the high and the low, the widest margin,
                  the closest game, and the bench decision that cost somebody the game.
                  Posting the same week twice does nothing, so this is safe to press.
                </p>
                <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginTop: "var(--s4)", alignItems: "center" }}>
                  <label className="eyebrow" htmlFor="recap-week">Week</label>
                  <input
                    id="recap-week"
                    className="field num"
                    type="number"
                    min={1}
                    max={20}
                    style={{ width: 90 }}
                    value={recapWeek ?? Math.max(1, data.week - 1)}
                    onChange={(e) => setRecapWeek(Number(e.target.value) || 1)}
                  />
                  <button className="btn" disabled={busy}
                    onClick={() => postRecap(recapWeek ?? Math.max(1, data.week - 1))}>
                    Post the recap
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2>Managers</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>
                    {named} of {data.teams.length} named · {linked} signed in
                  </div>
                </div>
                <Mail size={17} color="var(--gold)" />
              </div>
              <div className="note" data-kind="info">
                Team name and the manager&apos;s real name show up across the league. The email is
                only used here: save it, then send the invite. They get a link, pick a password,
                and they&apos;re in.
              </div>
              <div className="rows">
                {data.teams.map((t) => (
                  <TeamRow key={t.id} team={t} busy={busy} onSave={call} />
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2>League rules</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>Editable all season</div>
                </div>
                <Scale size={17} color="var(--gold)" />
              </div>
              {/* Keyed on the saved values so a successful save resets the form. */}
              <LeagueRules
                key={`${data.league.name}|${JSON.stringify(data.league.settings)}|${JSON.stringify(data.league.roster_slots)}`}
                league={data.league}
                leagueId={LEAGUE_ID}
                teamCount={data.teams.length}
                scheduled={data.scheduled}
                busy={busy}
                onSave={call}
              />
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2>Scoring</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>
                    {data.rules.length} rule set{data.rules.length === 1 ? "" : "s"} on record · week {data.week}
                  </div>
                </div>
                <ScrollText size={17} color="var(--gold)" />
              </div>
              <ScoringEditor
                key={`${data.rules.length}|${JSON.stringify(data.league.scoring_rules)}`}
                league={data.league}
                week={data.week}
                rules={data.rules}
                onSave={saveScoring}
              />
            </section>

            <section className="card">
              <div className="card__head"><h2>Draft settings</h2><Timer size={17} color="var(--gold)" /></div>
              <DraftSettings draft={data.draft} busy={busy} onSave={call} />
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2>Draft order</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>
                    {data.draft.status === "setup" ? "Reorder by hand, or randomize it" : "Locked — the draft has started"}
                  </div>
                </div>
                <Dices size={17} color="var(--gold)" />
              </div>
              {/* Keyed on the standing order, same trick as the forms below: a
                  successful save (or someone else's randomize) resets the list
                  from the new server state instead of fighting local edits. */}
              <DraftOrder
                key={data.teams.map((t) => `${t.id}:${t.draft_slot ?? ""}`).join("|")}
                teams={data.teams} busy={busy} disabled={data.draft.status !== "setup"} onSave={call}
              />
            </section>

            <section className="card">
              <div className="card__head"><h2>After the draft</h2><ListChecks size={17} color="var(--gold)" /></div>
              <div className="card__body">
                <p className="prose" style={{ marginTop: 0, fontSize: "var(--t-small)" }}>
                  Run these once the board is full. Seeding builds week-1 rosters from the draft
                  results; the schedule generates the head-to-head season.
                </p>
                <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginTop: "var(--s4)" }}>
                  <button className="btn" disabled={busy}
                    onClick={() => call("ff_seed_rosters", { p_league_id: LEAGUE_ID, p_week: 1 }, "Week 1 rosters seeded.")}>
                    Seed week 1 rosters
                  </button>
                  <button className="btn" disabled={busy}
                    onClick={() => call("ff_generate_schedule", { p_league_id: LEAGUE_ID }, "Season schedule generated.")}>
                    Generate schedule
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <div>
                  <h2>The wall</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>Seasons before this app, 2016 onward</div>
                </div>
                <Landmark size={17} color="var(--gold)" />
              </div>
              <HistoryImport />
            </section>
          </>
        )}
      </main>
    </>
  );
}

/* -------------------------------------------------------------- managers -- */

function TeamRow({ team, busy, onSave }: { team: Team; busy: boolean; onSave: SaveFn }) {
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [manager, setManager] = useState(team.manager_name ?? "");
  const [email, setEmail] = useState(team.owner_email ?? "");
  const [sending, setSending] = useState(false);

  const namesDirty = name !== team.name || manager !== (team.manager_name ?? "");
  const emailDirty = email !== (team.owner_email ?? "");
  const dirty = namesDirty || emailDirty;
  const savedEmail = (team.owner_email ?? "").length > 0;

  async function save() {
    if (!name.trim()) return toast("error", "The team needs a name.");
    if (namesDirty) {
      const ok = await onSave(
        "ff_update_team",
        { p_team_id: team.id, p_name: name.trim(), p_manager_name: manager.trim() },
        manager.trim() ? `Saved ${name.trim()} · ${manager.trim()}.` : `Saved ${name.trim()}.`,
      );
      if (!ok) return;
    }
    if (emailDirty) {
      await onSave("ff_invite_manager", { p_team_id: team.id, p_email: email }, email ? `Saved ${email}.` : "Email cleared.");
    }
  }

  async function sendInvite() {
    setSending(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("ok", `Invite sent to ${json.sentTo}.`);
      } else {
        toast("error", json.error ?? "Couldn't send the invite.");
        // Never leave the commissioner stuck: hand over the link instead.
        if (json.joinUrl) {
          try {
            await navigator.clipboard.writeText(json.joinUrl);
            toast("info", "Invite link copied to your clipboard instead.");
          } catch { /* clipboard denied — the error toast already explains */ }
        }
      }
    } catch {
      toast("error", "Network error sending the invite.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="row" style={{ flexWrap: "wrap", rowGap: 10, alignItems: "center" }}>
      <span className="num eyebrow" style={{ width: 22 }}>{team.draft_slot}</span>
      <Seal name={name || "?"} src={crestUrl(team.logo_path)} size={28} />

      <div style={{ display: "grid", gap: 7, flex: "1 1 280px", minWidth: 200 }}>
        <div style={{ display: "grid", gap: 7, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <input className="field" style={compact}
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" aria-label="Team name" />
          <input className="field" style={compact}
            value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Manager's name" aria-label="Manager name"
            autoComplete="off" />
        </div>
        <input className="field" style={compact}
          value={email} onChange={(e) => setEmail(e.target.value)} type="email"
          placeholder="manager@email.com — invites only" aria-label="Manager email" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: "auto" }}>
        <span className="eyebrow" style={{ color: team.owner_id ? "var(--win)" : "var(--faint)", width: 52, textAlign: "right" }}>
          {team.owner_id ? "Joined" : savedEmail ? "Invited" : "—"}
        </span>

        <button className="btn" data-size="icon" onClick={save} disabled={busy || !dirty} title="Save changes">
          <Save size={14} />
        </button>

        <button
          className="btn"
          data-v={team.owner_id ? undefined : "primary"}
          data-size="sm"
          onClick={sendInvite}
          disabled={sending || dirty || !savedEmail}
          title={
            dirty ? "Save first"
              : !savedEmail ? "Add an email first"
              : team.owner_id ? "Already joined — resend anyway" : "Email this manager their invite"
          }
        >
          {sending ? <Link2 size={14} /> : <Send size={14} />}
          {sending ? "Sending" : team.owner_id ? "Resend" : "Invite"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- draft -- */

function DraftSettings({ draft, busy, onSave }: { draft: Draft; busy: boolean; onSave: SaveFn }) {
  const [rounds, setRounds] = useState(draft.rounds);
  const [seconds, setSeconds] = useState(draft.pick_seconds);
  const dirty = rounds !== draft.rounds || seconds !== draft.pick_seconds;

  return (
    <div style={{ display: "flex", gap: "var(--s4)", flexWrap: "wrap", alignItems: "flex-end", padding: "var(--s5)" }}>
      <label style={{ display: "grid", gap: 7 }}>
        <span className="eyebrow">Rounds</span>
        <input className="field num" type="number" min={1} max={30} style={{ width: 110 }}
          value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
      </label>
      <label style={{ display: "grid", gap: 7 }}>
        <span className="eyebrow">Seconds per pick</span>
        <input className="field num" type="number" min={15} max={600} step={15} style={{ width: 140 }}
          value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
      </label>
      <button className="btn" disabled={busy || !dirty}
        onClick={() => onSave("ff_update_draft", { p_draft_id: draft.id, p_rounds: rounds, p_pick_seconds: seconds }, "Draft settings saved.")}>
        <Save size={14} /> Save
      </button>
    </div>
  );
}

/**
 * The order teams pick in, either by hand or by dice.
 *
 * Reordering happens locally — nothing is written until "Save order" — so a
 * commissioner can shuffle a few teams around without three round trips.
 * Randomizing skips the local list entirely and goes straight to the RPC,
 * since there is nothing to preview about a random draw.
 */
function DraftOrder({ teams, busy, disabled, onSave }: { teams: Team[]; busy: boolean; disabled: boolean; onSave: SaveFn }) {
  const sorted = useMemo(
    () => [...teams].sort((a, b) => (a.draft_slot ?? 999) - (b.draft_slot ?? 999) || a.name.localeCompare(b.name)),
    [teams],
  );
  const [order, setOrder] = useState(sorted);

  const dirty = order.some((t, i) => t.id !== sorted[i]?.id);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  return (
    <>
      <div className="rows">
        {order.map((t, i) => (
          <div className="row" key={t.id}>
            <span className="num eyebrow" style={{ width: 22 }}>{i + 1}</span>
            <Seal name={t.name} src={crestUrl(t.logo_path)} size={26} />
            <span style={{
              flex: 1, minWidth: 0, fontWeight: 600, fontSize: "var(--t-small)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {t.name}
            </span>
            <button className="btn" data-v="ghost" data-size="icon" onClick={() => move(i, -1)}
              disabled={disabled || i === 0} aria-label="Move up"><ChevronUp size={14} /></button>
            <button className="btn" data-v="ghost" data-size="icon" onClick={() => move(i, 1)}
              disabled={disabled || i === order.length - 1} aria-label="Move down"><ChevronDown size={14} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", padding: "var(--s5)" }}>
        <button className="btn" data-v="primary" disabled={busy || disabled || !dirty}
          title={disabled ? "Only before the draft starts" : undefined}
          onClick={() => onSave("ff_set_draft_order", { p_league_id: LEAGUE_ID, p_team_ids: order.map((t) => t.id) }, "Draft order saved.")}>
          <Save size={14} /> Save order
        </button>
        <button className="btn" disabled={busy || disabled}
          title={disabled ? "Only before the draft starts" : undefined}
          onClick={() => onSave("ff_randomize_draft_order", { p_league_id: LEAGUE_ID }, "Draft order randomized.")}>
          <Dices size={14} /> Randomize instead
        </button>
      </div>
    </>
  );
}
