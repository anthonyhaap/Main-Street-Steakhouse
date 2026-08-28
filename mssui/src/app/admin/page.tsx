"use client";

import { useCallback, useState } from "react";
import {
  Crown, Dices, Link2, ListChecks, Mail, Save, Send, Timer,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { Draft, League, Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { Seal, SkeletonRows, useToast } from "@/components/ui";

type Admin = { league: League; draft: Draft; teams: Team[] };

export default function AdminPage() {
  const { ready, user, reload } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(async (): Promise<Admin> => {
    const supabase = supabaseBrowser();
    const [l, d, t] = await Promise.all([
      supabase.from("leagues").select("*").eq("id", LEAGUE_ID).single(),
      supabase.from("drafts").select("*").eq("id", DRAFT_ID).single(),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
    ]);
    return { league: l.data as League, draft: d.data as Draft, teams: (t.data ?? []) as Team[] };
  }, []);

  const { data, status, refetch } = useLive<Admin>(fetcher, {
    tables: ["teams", "drafts", "leagues"],
    channel: "admin",
    pollMs: 0,
    enabled: ready,
  });

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>, ok: string) => {
      setBusy(true);
      const { error } = await supabaseBrowser().rpc(fn, args);
      setBusy(false);
      if (error) toast("error", error.message);
      else toast("ok", ok);
      await refetch();
      await reload();
    },
    [refetch, reload, toast],
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
  const withEmail = data.teams.filter((t) => t.owner_email).length;

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
                <div>
                  <h2>Managers</h2>
                  <div className="eyebrow" style={{ marginTop: 5 }}>
                    {withEmail} of {data.teams.length} with emails · {linked} signed in
                  </div>
                </div>
                <Mail size={17} color="var(--gold)" />
              </div>
              <div className="note" data-kind="info">
                Add an email, save it, then send the invite. They get a link, pick a password,
                and they&apos;re in — nothing for them to copy or paste.
              </div>
              <div className="rows">
                {data.teams.map((t) => (
                  <TeamRow key={t.id} team={t} busy={busy} onSave={call} />
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card__head"><h2>Draft settings</h2><Timer size={17} color="var(--gold)" /></div>
              <DraftSettings draft={data.draft} busy={busy} onSave={call} />
              <div style={{ padding: "0 var(--s5) var(--s5)" }}>
                <button className="btn" disabled={busy || data.draft.status !== "setup"}
                  title={data.draft.status !== "setup" ? "Only before the draft starts" : ""}
                  onClick={() => call("ff_randomize_draft_order", { p_league_id: LEAGUE_ID }, "Draft order randomized.")}>
                  <Dices size={14} /> Randomize draft order
                </button>
              </div>
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
          </>
        )}
      </main>
    </>
  );
}

function TeamRow({
  team, busy, onSave,
}: {
  team: Team; busy: boolean;
  onSave: (fn: string, args: Record<string, unknown>, ok: string) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [email, setEmail] = useState(team.owner_email ?? "");
  const [sending, setSending] = useState(false);

  const dirty = name !== team.name || email !== (team.owner_email ?? "");
  const savedEmail = (team.owner_email ?? "").length > 0;

  async function save() {
    if (name !== team.name) {
      await onSave("ff_update_team", { p_team_id: team.id, p_name: name, p_draft_slot: team.draft_slot }, `Renamed to ${name}.`);
    }
    if (email !== (team.owner_email ?? "")) {
      await onSave("ff_invite_manager", { p_team_id: team.id, p_email: email }, `Saved ${email}.`);
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
      <Seal name={name || "?"} size={28} />

      <div style={{ display: "grid", gap: 7, flex: "1 1 260px", minWidth: 200 }}>
        <input className="field" style={{ minHeight: 36, padding: "8px 11px" }}
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" aria-label="Team name" />
        <input className="field" style={{ minHeight: 36, padding: "8px 11px" }}
          value={email} onChange={(e) => setEmail(e.target.value)} type="email"
          placeholder="manager@email.com" aria-label="Manager email" />
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
            dirty ? "Save the email first"
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

function DraftSettings({
  draft, busy, onSave,
}: {
  draft: Draft; busy: boolean;
  onSave: (fn: string, args: Record<string, unknown>, ok: string) => Promise<void>;
}) {
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
