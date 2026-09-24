"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { Plus, Settings2, ShieldCheck, Swords, X } from "lucide-react";
import { TeamLogo } from "@/components/nfl";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { ChallengeCard, useTargetChallenge, type ChallengeActions } from "@/components/challenges/ChallengeCard";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { SPREAD_GAME_COLUMNS, isOpen, lineText, marketLine, otherTeam, spreadText, validLine, type SpreadGame } from "@/lib/spread";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Challenge, LeagueProfile, Matchup } from "@/lib/types";

/**
 * Head to head.
 *
 * A bet is a row in `challenges`, and every change to it is an RPC: the browser
 * only ever reads. What this page adds to the card is the session — who you
 * are decides which of the card's buttons you see — and the four dialogs a bet
 * needs: the shot itself, your Venmo handle, the note on a payment, and the
 * reason for a review. `window.prompt` used to do the last two, and a prompt
 * is a thing the installed app on a phone does not reliably show.
 *
 * A bet is decided one of three ways: your own fantasy matchup, the
 * commissioner, or an NFL game against the spread — any two managers, any
 * game still to kick off, ESPN's line to start from. The spread bet's terms
 * are written by the database from the game, not typed.
 *
 * A push lands at `/challenges#<id>`; `useTargetChallenge` scrolls to that
 * card and lights it for a moment.
 */

type ChallengeData = { challenges: Challenge[]; profiles: LeagueProfile[]; matchups: Matchup[]; games: SpreadGame[] };

const firstName = (s: string | null | undefined) => s?.trim().split(/\s+/)[0] || null;

export default function ChallengesPage() {
  const { ready, user, teams, team, isCommissioner } = useSession();
  const [dialog, setDialog] = useState<
    | { kind: "challenge" } | { kind: "profile" } | { kind: "paid"; id: string } | { kind: "review"; id: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<ChallengeData> => {
    const [challenges, profiles, matchups, upcoming] = await Promise.all([
      supabaseBrowser().from("challenges").select("*").eq("league_id", LEAGUE_ID).order("created_at", { ascending: false }),
      supabaseBrowser().from("profiles").select("id,display_name,settlement_provider,settlement_handle,settlement_opt_in_at"),
      supabaseBrowser().from("matchups").select("*").eq("league_id", LEAGUE_ID).order("week"),
      // The games a spread bet can still be made on: not yet kicked off.
      supabaseBrowser().from("nfl_games").select(SPREAD_GAME_COLUMNS).eq("status", "pre")
        .gt("kickoff_at", new Date().toISOString()).order("kickoff_at").limit(48),
    ]);
    const failure = challenges.error ?? profiles.error ?? matchups.error ?? upcoming.error;
    if (failure) throw failure;
    const games = (upcoming.data ?? []) as SpreadGame[];
    // And the games the bets already on the desk are about, live or final.
    const wanted = [...new Set((challenges.data ?? []).map((c) => c.nfl_game_id as string | null).filter(Boolean))]
      .filter((id) => !games.some((g) => g.id === id)) as string[];
    if (wanted.length) {
      const bet = await supabaseBrowser().from("nfl_games").select(SPREAD_GAME_COLUMNS).in("id", wanted);
      if (bet.error) throw bet.error;
      games.push(...((bet.data ?? []) as SpreadGame[]));
    }
    return {
      challenges: (challenges.data ?? []) as Challenge[],
      profiles: (profiles.data ?? []) as LeagueProfile[],
      matchups: (matchups.data ?? []) as Matchup[],
      games,
    };
  }, []);
  const { data, status, refetch } = useLive(fetcher, {
    tables: ["challenges", "profiles", "nfl_games"], channel: "league-challenges", pollMs: 30000, enabled: ready,
  });
  const target = useTargetChallenge(!!data);

  const myProfile = data?.profiles.find((profile) => profile.id === user?.id);
  const nameOf = useCallback((id: string | null) => {
    const seat = teams.find((item) => item.owner_id === id);
    return firstName(seat?.manager_name) ?? seat?.name
      ?? firstName(data?.profiles.find((item) => item.id === id)?.display_name) ?? "Somebody";
  }, [teams, data?.profiles]);
  const weekOf = useCallback((matchupId: string | null) =>
    data?.matchups.find((m) => m.id === matchupId)?.week ?? null, [data?.matchups]);
  const gameOf = useCallback((gameId: string | null) =>
    data?.games.find((g) => g.id === gameId) ?? null, [data?.games]);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setError(null);
    const { error: actionError } = await fn();
    setBusy(false);
    if (actionError) { setError(actionError.message); return false; }
    await refetch();
    return true;
  };

  const actions: ChallengeActions = useMemo(() => ({
    onRespond: (id, response) => void run(() => supabaseBrowser().rpc("ff_respond_challenge", { p_challenge_id: id, p_response: response })),
    onMarkPaid: (id) => setDialog({ kind: "paid", id }),
    onConfirm: (id) => void run(() => supabaseBrowser().rpc("ff_confirm_challenge_received", { p_challenge_id: id })),
    onDispute: (id) => setDialog({ kind: "review", id }),
    onResolve: (id, winnerId) => void run(() => supabaseBrowser().rpc("ff_resolve_challenge", {
      p_challenge_id: id, p_winner_id: winnerId, p_evidence: "Commissioner verified the recorded league result.",
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [refetch]);

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <header className="bets__head">
          <div>
            <div className="eyebrow" data-tone="gold">Head to head</div>
            <h1 className="display bets__h1">Call your shot.</h1>
            <p className="prose">Lock the terms. The week settles the argument, and the slip comes to your phone.</p>
          </div>
          <div className="bets__tools">
            <button className="btn" onClick={() => setDialog({ kind: "profile" })}>
              <Settings2 size={14} />{myProfile?.settlement_handle ? `@${myProfile.settlement_handle}` : "Venmo handle"}
            </button>
            <button className="btn" data-v="primary" onClick={() => setDialog({ kind: "challenge" })}>
              <Plus size={14} />New challenge
            </button>
          </div>
        </header>

        <div className="note" data-kind="info" style={{ marginBottom: "var(--s4)" }}>
          <strong>The house never touches the money.</strong> It records who agreed to what, who won, and who
          said they paid. The Venmo button opens a payment already written out; you still press send.
        </div>

        {error && <div className="note" data-kind="error" role="alert">{error}</div>}

        {!data ? (
          <div className="card"><SkeletonRows n={5} /></div>
        ) : (
          <div className="grid-auto">
            {data.challenges.length === 0 && (
              <div className="card"><div className="empty">No challenges yet.<br />Be the first to call your shot.</div></div>
            )}
            {data.challenges.map((item) => (
              <ChallengeCard
                key={item.id} item={item} userId={user?.id ?? null} busy={busy} isCommissioner={isCommissioner}
                profiles={data.profiles} nameOf={nameOf} weekOf={weekOf} gameOf={gameOf} target={target === item.id} actions={actions}
              />
            ))}
          </div>
        )}

        {dialog?.kind === "challenge" && data && (
          <ChallengeDialog matchups={data.matchups} games={data.games} close={() => setDialog(null)} done={async () => { setDialog(null); await refetch(); }} />
        )}
        {dialog?.kind === "profile" && (
          <ProfileDialog
            initial={myProfile} displayName={team?.manager_name ?? team?.name ?? "League manager"}
            close={() => setDialog(null)} done={async () => { setDialog(null); await refetch(); }}
          />
        )}
        {dialog?.kind === "paid" && (
          <PaidDialog
            busy={busy} close={() => setDialog(null)}
            submit={async (reference) => {
              const ok = await run(() => supabaseBrowser().rpc("ff_mark_challenge_paid", { p_challenge_id: dialog.id, p_reference: reference }));
              if (ok) setDialog(null);
            }}
          />
        )}
        {dialog?.kind === "review" && (
          <ReviewDialog
            busy={busy} close={() => setDialog(null)}
            submit={async (reason) => {
              const ok = await run(() => supabaseBrowser().rpc("ff_dispute_challenge", { p_challenge_id: dialog.id, p_reason: reason }));
              if (ok) setDialog(null);
            }}
          />
        )}
      </main>
    </>
  );
}

/* --------------------------------------------------------------- dialogs -- */

function PaidDialog({ busy, close, submit }: { busy: boolean; close: () => void; submit: (reference: string) => Promise<void> }) {
  const [reference, setReference] = useState("");
  return (
    <Modal title="I paid" eyebrow="Settle up" close={close}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(reference); }} style={{ display: "grid", gap: "var(--s4)" }}>
        <p className="prose">Optional: the note you put on the Venmo payment, so the other side can find it. No bank details.</p>
        <Field label="Reference">
          <input className="field" maxLength={160} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Venmo note or confirmation" />
        </Field>
        <button className="btn" data-v="primary" disabled={busy}><ShieldCheck size={14} />{busy ? "Saving…" : "Mark it paid"}</button>
      </form>
    </Modal>
  );
}

function ReviewDialog({ busy, close, submit }: { busy: boolean; close: () => void; submit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Ask the commissioner" eyebrow="Request review" close={close}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(reason); }} style={{ display: "grid", gap: "var(--s4)" }}>
        <p className="prose">Say what needs a second look. The commissioner sees this and rules on the bet.</p>
        <Field label="What happened">
          <textarea className="field" required minLength={3} maxLength={500} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The payment never arrived…" />
        </Field>
        <button className="btn" data-v="primary" disabled={busy || reason.trim().length < 3}>{busy ? "Sending…" : "Send for review"}</button>
      </form>
    </Modal>
  );
}

function ProfileDialog({ initial, displayName, close, done }: { initial?: LeagueProfile; displayName: string; close: () => void; done: () => Promise<void> }) {
  const [handle, setHandle] = useState(initial?.settlement_handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const { error: saveError } = await supabaseBrowser().rpc("ff_save_settlement_profile", { p_display_name: displayName, p_provider: "venmo", p_handle: handle });
    setBusy(false);
    if (saveError) return setError(saveError.message);
    await done();
  }

  return (
    <Modal title="Your Venmo" eyebrow="Settlement" close={close}>
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--s4)" }}>
        <p className="prose">Just your public Venmo username. It goes on the slip the other manager gets; it is never used to reach your account.</p>
        <Field label="Venmo username">
          <input className="field" required maxLength={64} value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="username (without @)" />
        </Field>
        <label style={{ display: "flex", gap: 10, color: "var(--muted)", fontSize: "var(--t-small)" }}>
          <input type="checkbox" required />I understand every payment is voluntary and made in Venmo, not here.
        </label>
        {error && <div className="note" data-kind="error" role="alert">{error}</div>}
        <button className="btn" data-v="primary" disabled={busy}><ShieldCheck size={14} />{busy ? "Saving…" : "Save"}</button>
      </form>
    </Modal>
  );
}

function ChallengeDialog({ matchups, games, close, done }: { matchups: Matchup[]; games: SpreadGame[]; close: () => void; done: () => Promise<void> }) {
  const { user, teams } = useSession();
  const [opponent, setOpponent] = useState("");
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"custom" | "weekly_matchup_winner" | "nfl_spread">("weekly_matchup_winner");
  const [matchup, setMatchup] = useState("");
  const [gameId, setGameId] = useState("");
  const [side, setSide] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = teams.filter((item) => item.owner_id && item.owner_id !== user?.id);
  const eligibleMatchups = useMemo(() => {
    const mine = teams.find((item) => item.owner_id === user?.id);
    const theirs = teams.find((item) => item.id === opponent);
    return matchups.filter((item) => mine && theirs
      && [item.home_team_id, item.away_team_id].includes(mine.id)
      && [item.home_team_id, item.away_team_id].includes(theirs.id));
  }, [matchups, opponent, teams, user?.id]);

  // Spread bets: only games still to kick off, soonest first.
  const openGames = useMemo(() => games.filter((g) => isOpen(g)).sort((x, y) =>
    (x.kickoff_at ?? "").localeCompare(y.kickoff_at ?? "")), [games]);
  const game = openGames.find((g) => g.id === gameId) ?? null;
  const lineNumber = line.trim() === "" ? NaN : Number(line);
  const spreadReady = !!game && !!side && validLine(lineNumber);
  const opponentName = choices.find((item) => item.id === opponent)?.manager_name?.trim().split(/\s+/)[0] ?? "They";

  // Choosing a side starts from ESPN's line on it; the challenger can shade it.
  function pickSide(team: string) {
    setSide(team);
    const market = game ? marketLine(game, team) : null;
    setLine(market == null ? "" : String(market));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const opponentTeam = choices.find((item) => item.id === opponent);
    const cents = amount ? Math.round(Number(amount) * 100) : null;
    const { error: createError } = kind === "nfl_spread"
      ? await supabaseBrowser().rpc("ff_create_spread_challenge", {
          p_league_id: LEAGUE_ID, p_opponent_id: opponentTeam?.owner_id, p_game_id: gameId,
          p_team: side, p_line: lineNumber, p_stake_amount_cents: cents,
        })
      : await supabaseBrowser().rpc("ff_create_challenge", {
          p_league_id: LEAGUE_ID, p_opponent_id: opponentTeam?.owner_id, p_title: title, p_terms: terms,
          p_stake_label: cents ? "External settlement" : "Bragging rights", p_proposition_type: kind,
          p_stake_amount_cents: cents, p_matchup_id: kind === "weekly_matchup_winner" ? matchup : null,
        });
    setBusy(false);
    if (createError) return setError(createError.message);
    await done();
  }

  return (
    <Modal title="Call your shot" eyebrow="New challenge" close={close}>
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--s4)" }}>
        <Field label="Opponent">
          <select className="field" required value={opponent} onChange={(event) => { setOpponent(event.target.value); setMatchup(""); }}>
            <option value="">Choose a manager</option>
            {choices.map((item) => <option value={item.id} key={item.id}>{item.manager_name ?? item.name}</option>)}
          </select>
        </Field>
        <Field label="Decided by">
          <select className="field" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="weekly_matchup_winner">The week&apos;s result, automatically</option>
            <option value="nfl_spread">An NFL game, against the spread</option>
            <option value="custom">The commissioner</option>
          </select>
        </Field>
        {kind === "weekly_matchup_winner" && (
          <Field label="Matchup">
            <select className="field" required value={matchup} onChange={(event) => setMatchup(event.target.value)}>
              <option value="">{opponent ? (eligibleMatchups.length ? "Choose the week" : "You don\u2019t play them this season") : "Choose an opponent first"}</option>
              {eligibleMatchups.map((item) => <option key={item.id} value={item.id}>Week {item.week}</option>)}
            </select>
          </Field>
        )}
        {kind === "nfl_spread" && (
          <>
            <Field label="Game">
              <select className="field" required value={gameId} onChange={(event) => { setGameId(event.target.value); setSide(""); setLine(""); }}>
                <option value="">{openGames.length ? "Choose a game" : "No games left to kick off"}</option>
                {openGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    Week {g.week} · {g.away_team} at {g.home_team}
                    {g.home_spread != null ? ` · ${spreadText(g.home_team, Number(g.home_spread))}` : ""}
                    {g.kickoff_at ? ` · ${new Date(g.kickoff_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {game && (
              <div>
                <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Your side</span>
                <div className="spread-pick" role="group" aria-label="Your side">
                  {[game.away_team, game.home_team].map((team) => {
                    const market = marketLine(game, team);
                    return (
                      <button type="button" key={team} className="spread-pick__opt" aria-pressed={side === team} onClick={() => pickSide(team)}>
                        <TeamLogo abbr={team} size={22} />{team}{market != null ? ` ${lineText(market)}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {game && side && (
              <Field label={`Your line on ${side}`}>
                <input
                  className="field" inputMode="decimal" type="number" required min="-50" max="50" step="0.5"
                  value={line} onChange={(event) => setLine(event.target.value)}
                  placeholder={marketLine(game, side) == null ? "No line from ESPN yet — set one, e.g. -3.5" : undefined}
                />
              </Field>
            )}
            {spreadReady && (
              <p className="note" data-kind="info" style={{ margin: 0 }} data-testid="spread-summary">
                You take <strong>{spreadText(side, lineNumber)}</strong>. {opponentName} takes{" "}
                <strong>{spreadText(otherTeam(game!, side), -lineNumber)}</strong>. Decided by the final, overtime
                included; landing on the number is a push. Locks at kickoff.
              </p>
            )}
          </>
        )}
        {kind !== "nfl_spread" && (
          <>
            <Field label="Title">
              <input className="field" required maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Higher Week 1 score" />
            </Field>
            <Field label="Exact terms">
              <textarea className="field" required maxLength={1000} value={terms} onChange={(event) => setTerms(event.target.value)} rows={3} placeholder="Winner has the higher final fantasy score…" />
            </Field>
          </>
        )}
        <Field label="Stake in dollars (optional)">
          <input className="field" inputMode="decimal" type="number" min="1" max="500" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Leave blank for bragging rights" />
        </Field>
        {amount && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--t-small)" }}>
            Both of you need a Venmo handle saved before this can be accepted. The house never holds the money.
          </p>
        )}
        {error && <div className="note" data-kind="error" role="alert">{error}</div>}
        <button className="btn" data-v="primary" disabled={busy || !choices.length || (kind === "nfl_spread" && !spreadReady)}>
          <Swords size={14} />{busy ? "Sending…" : "Send challenge"}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, eyebrow, close, children }: { title: string; eyebrow: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="modal__panel" role="dialog" aria-label={title}>
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">{eyebrow}</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>{title}</h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={close} aria-label="Close"><X /></button>
        </div>
        <div className="card__body">{children}</div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{label}</span>{children}</label>;
}
