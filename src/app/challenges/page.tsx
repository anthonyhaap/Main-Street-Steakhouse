"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleDollarSign, Copy, ExternalLink, LockKeyhole, Plus, Settings2, ShieldCheck, Swords, X } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Challenge, LeagueProfile, Matchup } from "@/lib/types";

type ChallengeData = { challenges: Challenge[]; profiles: LeagueProfile[]; matchups: Matchup[] };

export default function ChallengesPage() {
  const { ready, user, teams, team, isCommissioner } = useSession();
  const [dialog, setDialog] = useState<"challenge" | "profile" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useCallback(async (): Promise<ChallengeData> => {
    const [challenges, profiles, matchups] = await Promise.all([
      supabaseBrowser().from("challenges").select("*").eq("league_id", LEAGUE_ID).order("created_at", { ascending: false }),
      supabaseBrowser().from("profiles").select("id,display_name,settlement_provider,settlement_handle,settlement_opt_in_at"),
      supabaseBrowser().from("matchups").select("*").eq("league_id", LEAGUE_ID).order("week"),
    ]);
    const failure = challenges.error ?? profiles.error ?? matchups.error;
    if (failure) throw failure;
    return { challenges: (challenges.data ?? []) as Challenge[], profiles: (profiles.data ?? []) as LeagueProfile[], matchups: (matchups.data ?? []) as Matchup[] };
  }, []);
  const { data, status, refetch } = useLive(fetcher, { tables: ["challenges", "profiles"], channel: "league-challenges", pollMs: 30000, enabled: ready });
  const myProfile = data?.profiles.find((profile) => profile.id === user?.id);
  const nameOf = (id: string | null) => teams.find((item) => item.owner_id === id)?.name ?? data?.profiles.find((item) => item.id === id)?.display_name ?? "League manager";
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setError(null);
    const { error: actionError } = await fn();
    setBusy(false);
    if (actionError) return setError(actionError.message);
    await refetch();
  };
  const respond = (id: string, response: "accepted" | "declined") => run(() => supabaseBrowser().rpc("ff_respond_challenge", { p_challenge_id: id, p_response: response }));
  const markPaid = (id: string) => {
    const reference = window.prompt("Optional: add the Venmo note or confirmation reference. Do not paste bank details.") ?? "";
    return run(() => supabaseBrowser().rpc("ff_mark_challenge_paid", { p_challenge_id: id, p_reference: reference }));
  };
  const dispute = (id: string) => {
    const reason = window.prompt("Briefly explain what needs commissioner review:");
    if (reason) void run(() => supabaseBrowser().rpc("ff_dispute_challenge", { p_challenge_id: id, p_reason: reason }));
  };
  const resolve = (id: string, winnerId: string) => run(() => supabaseBrowser().rpc("ff_resolve_challenge", { p_challenge_id: id, p_winner_id: winnerId, p_evidence: "Commissioner verified the recorded league result." }));

  return <><TopBar status={status}/><main className="page" data-width="mid">
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--s4)", marginBottom: "var(--s5)", flexWrap: "wrap" }}>
      <div><div className="eyebrow" data-tone="gold">HEAD TO HEAD</div><h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>Call your shot.</h1><p className="prose">Lock the terms. Let official scores settle the argument.</p></div>
      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}><button className="btn" onClick={() => setDialog("profile")}><Settings2 size={14}/>{myProfile?.settlement_handle ? `@${myProfile.settlement_handle}` : "Settlement setup"}</button><button className="btn" data-v="primary" onClick={() => setDialog("challenge")}><Plus size={14}/>New challenge</button></div>
    </header>
    <div className="card" data-accent="gold" style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)", marginBottom: "var(--s4)" }}><LockKeyhole size={18} color="var(--gold)" style={{ flexShrink: 0 }}/><p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--t-small)" }}><strong style={{ color: "var(--cream)" }}>External settlement only.</strong> We record mutual consent, results and confirmations. We never connect to, debit or hold funds from Venmo or any payment account.</p></div>
    {error && <p role="alert" style={{ color: "var(--lose)" }}>{error}</p>}
    {!data ? <div className="card"><SkeletonRows n={5}/></div> : <div className="grid-auto">{data.challenges.length === 0 && <div className="card"><div className="empty">No challenges yet.<br/>Be the first to call your shot.</div></div>}{data.challenges.map((item) => <ChallengeCard key={item.id} item={item} userId={user?.id ?? null} busy={busy} isCommissioner={isCommissioner} profiles={data.profiles} nameOf={nameOf} onRespond={respond} onMarkPaid={markPaid} onConfirm={(id) => run(() => supabaseBrowser().rpc("ff_confirm_challenge_received", { p_challenge_id: id }))} onDispute={dispute} onResolve={resolve}/>)}</div>}
    {dialog === "challenge" && data && <ChallengeDialog matchups={data.matchups} close={() => setDialog(null)} done={async () => { setDialog(null); await refetch(); }}/>}
    {dialog === "profile" && <ProfileDialog initial={myProfile} displayName={team?.manager_name ?? team?.name ?? "League manager"} close={() => setDialog(null)} done={async () => { setDialog(null); await refetch(); }}/>}
  </main></>;
}

function ChallengeCard({ item, userId, busy, isCommissioner, profiles, nameOf, onRespond, onMarkPaid, onConfirm, onDispute, onResolve }: { item: Challenge; userId: string | null; busy: boolean; isCommissioner: boolean; profiles: LeagueProfile[]; nameOf: (id: string | null) => string; onRespond: (id: string, response: "accepted" | "declined") => void; onMarkPaid: (id: string) => void; onConfirm: (id: string) => void; onDispute: (id: string) => void; onResolve: (id: string, winner: string) => void }) {
  const loserId = item.winner_id === item.challenger_id ? item.opponent_id : item.challenger_id;
  const winnerProfile = profiles.find((profile) => profile.id === item.winner_id);
  const amount = item.stake_amount_cents == null ? null : `$${(item.stake_amount_cents / 100).toFixed(2)}`;
  const overdue = item.settlement_due_at && new Date(item.settlement_due_at) < new Date() && !["settled", "voided"].includes(item.status);
  const paymentUrl = winnerProfile?.settlement_provider === "venmo" && winnerProfile.settlement_handle ? `https://venmo.com/u/${encodeURIComponent(winnerProfile.settlement_handle)}` : null;
  const copySummary = async () => navigator.clipboard.writeText(`${amount ?? item.stake_label} — ${item.title} — pay ${nameOf(item.winner_id)} externally`);
  return <article className="card" data-accent={["accepted", "resolved", "payment_pending"].includes(item.status) ? "gold" : undefined}>
    <div className="card__head"><span className="badge">{item.status.replace("_", " ")}</span>{overdue ? <span className="badge" style={{ color: "var(--lose)" }}>OVERDUE</span> : <CircleDollarSign size={16} color="var(--gold)"/>}</div>
    <div className="card__body"><div className="eyebrow">{nameOf(item.challenger_id)} vs {nameOf(item.opponent_id)}</div><h2 style={{ fontFamily: "var(--serif)", margin: "var(--s2) 0" }}>{item.title}</h2><p style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>{item.terms}</p>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--rule)", paddingTop: "var(--s3)", marginTop: "var(--s4)" }}><span className="eyebrow">Stakes</span><strong>{amount ?? item.stake_label}</strong></div>
      {item.winner_id && <p style={{ marginBottom: 0 }}><ShieldCheck size={15} style={{ verticalAlign: "text-bottom", marginRight: 6 }} color="var(--win)"/><strong>{nameOf(item.winner_id)}</strong> won.</p>}
      {item.status === "proposed" && item.opponent_id === userId && <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s4)", flexWrap: "wrap" }}><button className="btn" data-v="primary" disabled={busy} onClick={() => onRespond(item.id, "accepted")}><Check size={14}/>Accept & lock</button><button className="btn" disabled={busy} onClick={() => onRespond(item.id, "declined")}><X size={14}/>Decline</button></div>}
      {isCommissioner && ["accepted", "disputed"].includes(item.status) && <div style={{ marginTop: "var(--s4)" }}><div className="eyebrow" style={{ marginBottom: 8 }}>Commissioner resolution</div><div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}><button className="btn" disabled={busy} onClick={() => onResolve(item.id, item.challenger_id)}>Award {nameOf(item.challenger_id)}</button><button className="btn" disabled={busy} onClick={() => onResolve(item.id, item.opponent_id)}>Award {nameOf(item.opponent_id)}</button></div></div>}
      {item.status === "resolved" && userId === loserId && <div style={{ display: "grid", gap: "var(--s2)", marginTop: "var(--s4)" }}>{paymentUrl && <a className="btn" data-v="primary" href={paymentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>Open winner&apos;s Venmo</a>}<button className="btn" onClick={() => void copySummary()}><Copy size={14}/>Copy settlement details</button><button className="btn" disabled={busy} onClick={() => onMarkPaid(item.id)}><Check size={14}/>I paid externally</button></div>}
      {item.status === "payment_pending" && userId === item.winner_id && <button className="btn" data-v="primary" style={{ marginTop: "var(--s4)" }} disabled={busy} onClick={() => onConfirm(item.id)}><ShieldCheck size={14}/>Confirm received</button>}
      {["resolved", "payment_pending"].includes(item.status) && userId && [item.challenger_id, item.opponent_id].includes(userId) && <button className="btn" data-v="ghost" style={{ marginTop: "var(--s2)" }} onClick={() => onDispute(item.id)}><AlertTriangle size={14}/>Request review</button>}
      {item.dispute_reason && <p style={{ color: "var(--lose)", fontSize: "var(--t-small)" }}>Review requested: {item.dispute_reason}</p>}
    </div>
  </article>;
}

function ProfileDialog({ initial, displayName, close, done }: { initial?: LeagueProfile; displayName: string; close: () => void; done: () => Promise<void> }) {
  const [handle, setHandle] = useState(initial?.settlement_handle ?? ""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); const { error: saveError } = await supabaseBrowser().rpc("ff_save_settlement_profile", { p_display_name: displayName, p_provider: "venmo", p_handle: handle }); setBusy(false); if (saveError) return setError(saveError.message); await done(); }
  return <Modal title="External settlement" eyebrow="PAYMENT PREFERENCE" close={close}><form onSubmit={submit} style={{ display: "grid", gap: "var(--s4)" }}><p className="prose">Save only your public Venmo username. This is self-attested and is never used to access your account.</p><Field label="Venmo username"><input className="field" required maxLength={64} value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="username (without @)"/></Field><label style={{ display: "flex", gap: 10, color: "var(--muted)", fontSize: "var(--t-small)" }}><input type="checkbox" required/>I understand every payment is voluntary and completed outside this league website.</label>{error && <p role="alert" style={{ color: "var(--lose)" }}>{error}</p>}<button className="btn" data-v="primary" disabled={busy}><ShieldCheck size={14}/>{busy ? "Saving…" : "Save preference"}</button></form></Modal>;
}

function ChallengeDialog({ matchups, close, done }: { matchups: Matchup[]; close: () => void; done: () => Promise<void> }) {
  const { user, teams } = useSession(); const [opponent, setOpponent] = useState(""); const [title, setTitle] = useState(""); const [terms, setTerms] = useState(""); const [amount, setAmount] = useState(""); const [kind, setKind] = useState<"custom" | "weekly_matchup_winner">("custom"); const [matchup, setMatchup] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const choices = teams.filter((item) => item.owner_id && item.owner_id !== user?.id);
  const eligibleMatchups = useMemo(() => { const mine = teams.find((item) => item.owner_id === user?.id); const theirs = teams.find((item) => item.id === opponent); return matchups.filter((item) => mine && theirs && [item.home_team_id, item.away_team_id].includes(mine.id) && [item.home_team_id, item.away_team_id].includes(theirs.id)); }, [matchups, opponent, teams, user?.id]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); const opponentTeam = choices.find((item) => item.id === opponent); const cents = amount ? Math.round(Number(amount) * 100) : null; const { error: createError } = await supabaseBrowser().rpc("ff_create_challenge", { p_league_id: LEAGUE_ID, p_opponent_id: opponentTeam?.owner_id, p_title: title, p_terms: terms, p_stake_label: cents ? "External settlement" : "Bragging rights", p_proposition_type: kind, p_stake_amount_cents: cents, p_matchup_id: kind === "weekly_matchup_winner" ? matchup : null }); setBusy(false); if (createError) return setError(createError.message); await done(); }
  return <Modal title="Call your shot" eyebrow="NEW CHALLENGE" close={close}><form onSubmit={submit} style={{ display: "grid", gap: "var(--s4)" }}><Field label="Opponent"><select className="field" required value={opponent} onChange={(event) => { setOpponent(event.target.value); setMatchup(""); }}><option value="">Choose a manager</option>{choices.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Resolution"><select className="field" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="custom">Commissioner verified</option><option value="weekly_matchup_winner">Automatic weekly matchup</option></select></Field>{kind === "weekly_matchup_winner" && <Field label="Matchup"><select className="field" required value={matchup} onChange={(event) => setMatchup(event.target.value)}><option value="">Choose shared matchup</option>{eligibleMatchups.map((item) => <option key={item.id} value={item.id}>Week {item.week}</option>)}</select></Field>}<Field label="Title"><input className="field" required maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Higher Week 1 score"/></Field><Field label="Exact terms"><textarea className="field" required maxLength={1000} value={terms} onChange={(event) => setTerms(event.target.value)} rows={4} placeholder="Winner has the higher final fantasy score…"/></Field><Field label="Optional external amount (USD)"><input className="field" inputMode="decimal" type="number" min="1" max="500" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Leave blank for bragging rights"/></Field>{amount && <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--t-small)" }}>Both managers must opt in and save a settlement handle before this can be accepted. No funds enter the platform.</p>}{error && <p role="alert" style={{ color: "var(--lose)" }}>{error}</p>}<button className="btn" data-v="primary" disabled={busy || !choices.length}><Swords size={14}/>{busy ? "Sending…" : "Send challenge"}</button></form></Modal>;
}

function Modal({ title, eyebrow, close, children }: { title: string; eyebrow: string; close: () => void; children: React.ReactNode }) { return <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="modal__panel"><div className="card__head"><div><div className="eyebrow" data-tone="gold">{eyebrow}</div><h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>{title}</h2></div><button className="btn" data-v="ghost" data-size="icon" onClick={close} aria-label="Close"><X/></button></div><div className="card__body">{children}</div></section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{label}</span>{children}</label>; }
