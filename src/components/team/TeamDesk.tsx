"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Eye, Pencil, Wand2 } from "lucide-react";
import { buildInsights, myNews } from "@/lib/nfl/insights";
import { injuriesByPlayer } from "@/lib/nfl/wire";
import { buildLineup, slotOk } from "@/lib/nfl/lineup";
import type { MatchupCurve } from "@/lib/nfl/matchup";
import type { GameWeather } from "@/lib/nfl/venues";
import type { HubPlayer, TeamHub, Wire } from "@/lib/nfl/types";
import { Seal, TeamLink, useCountUp } from "@/components/ui";
import { PlayerRow, SwapOptions, SwapSheet, useNarrow, type SwapOption } from "@/components/team/Lineup";
import { DeskHeader, DeskScore, DeskTabs } from "@/components/team/MobileDesk";
import { Coach } from "@/components/team/Coach";
import { InsightBoard, NewsWire, TeamStats } from "@/components/team/Rail";
import { Notifications } from "@/components/team/Notifications";
import { RosterMoves } from "@/components/team/Moves";

export { slotOk };

export type MoveTarget = { slot: string; player: HubPlayer | null };

/**
 * The manager's desk: everything /team draws, given a hub payload and a wire.
 *
 * It owns no data of its own — the live page hands it Supabase state and the
 * fixture harness at /preview/team hands it a canned week — which is the point:
 * the layout can be looked at, and looked at on a wide screen, without a
 * session, a draft or a live Sunday.
 *
 * Opening a player is a link, not state: /player/[id] is a location you can
 * share and come back from. Moving a player is not — that goes back out to
 * whoever owns the roster.
 *
 * The crests come in as URLs rather than being looked up here, for the same
 * reason: the fixture has no session to look them up in.
 *
 * `readOnly` is the same desk drawn for a visitor — any manager in the league
 * can open any other manager's team. Everything that *reads* stays: the
 * lineup, the form, the wire against that roster, even the coach's opinion of
 * it. Everything that *writes* goes: no move buttons, no edit, no "set this
 * lineup", and no notification settings, which are per person rather than per
 * team. The database already lets any member read any team's hub, so this is
 * a matter of what the page offers, not what it is allowed.
 */
export function TeamDesk({
  hub, wire, moving, busy, crest = null, oppCrest = null, weather = null, matchups = null,
  readOnly = false, picker = null, settlesAt = null, currentWeek = null,
  onPickUp, onCancelMove, onDrop, onWeek, onEdit, onSetLineup,
}: {
  hub: TeamHub;
  wire: Wire | null;
  moving: HubPlayer | null;
  busy: boolean;
  /** True when this is another manager's team: draw it, but offer no writes. */
  readOnly?: boolean;
  /**
   * A control for choosing whose desk to look at, drawn in the hero next to
   * the team's record. The live page supplies a select over the league; the
   * fixture has no league and leaves it out.
   */
  picker?: ReactNode;
  /** This team's crest, from `crestUrl()`. Null falls back to the monogram. */
  crest?: string | null;
  oppCrest?: string | null;
  /** The forecast over each stadium this roster plays in, from `useWeather`. */
  weather?: Map<string, GameWeather> | null;
  /** Each man's week against his own projection curve, from `useMatchups`. */
  matchups?: MatchupCurve | null;
  /**
   * When the wire next settles, from `useWaiverDeadline`. Drawn under the hero
   * on the reader's own desk beside the doors to the transaction centre; null
   * while it is still being asked.
   */
  settlesAt?: string | null;
  /**
   * The league's week right now, from `ff_current_week`. A later `hub.week`
   * is a lineup set ahead of time, and the desk says so.
   */
  currentWeek?: number | null;
  onPickUp: (p: HubPlayer) => void;
  onCancelMove: () => void;
  onDrop: (target: MoveTarget) => void;
  onWeek: (week: number) => void;
  /** Absent on the fixture, where there is no team to edit, and on a desk
   *  that is not the reader's own. */
  onEdit?: () => void;
  /**
   * Apply a whole lineup at once — `{ player_id: slot }`, exactly what
   * `ff_set_lineup` takes. Absent on the fixture, where the coach can be read
   * but there is nothing to write to.
   */
  onSetLineup?: (assignments: Record<string, string>) => void | Promise<void>;
}) {
  const roster = hub.roster;
  const injuries = useMemo(() => injuriesByPlayer(wire), [wire]);
  const [coaching, setCoaching] = useState(false);

  const insights = useMemo(
    () => buildInsights(roster, wire?.injuries ?? [], hub.week),
    [roster, wire, hub.week],
  );

  const tagged = useMemo(() => myNews(roster, wire?.articles ?? []), [roster, wire]);

  // Priced on every render of the desk rather than on the click, so the button
  // can say what it is worth before anybody opens it. It is arithmetic over
  // fifteen players — cheaper than the sparklines beneath it.
  const plan = useMemo(
    () => buildLineup({
      roster,
      slots: hub.league.roster_slots,
      week: hub.week,
      injuries,
      hasWire: wire !== null,
      weather,
      matchups,
      insights,
    }),
    [roster, hub.league.roster_slots, hub.week, injuries, wire, weather, matchups, insights],
  );

  const starters = useMemo(() => {
    const slots = hub.league.roster_slots.filter((s) => s !== "BN");
    const pool = roster.filter((p) => p.slot !== "BN");
    const used = new Set<string>();
    return slots.map((slot, i) => {
      const hit = pool.find((p) => p.slot === slot && !used.has(p.player_id));
      if (hit) used.add(hit.player_id);
      return { key: `${slot}-${i}`, slot, player: hit ?? null };
    });
  }, [hub.league.roster_slots, roster]);

  const bench = roster.filter((p) => p.slot === "BN");

  // Everywhere the picked-up player could go. A swap is legal only if both men
  // fit their new slots, so a starter's options check the incoming player
  // against the slot being vacated as well — the drop handler itself only
  // checks the half it can see. Best projection first, since that is usually
  // the question being asked.
  const swapOptions = useMemo((): SwapOption[] => {
    if (!moving) return [];
    const from = moving.slot;
    const byProj = (a: SwapOption, b: SwapOption) =>
      (b.player?.projection ?? -1) - (a.player?.projection ?? -1);
    const fits = (s: { slot: string; player: HubPlayer | null }) =>
      s.player?.player_id !== moving.player_id
      && slotOk(s.slot, moving.position)
      && (!s.player || slotOk(from, s.player.position));

    const intoLineup = starters.filter(fits).map((s) => ({ key: s.key, slot: s.slot, player: s.player }));
    if (from === "BN") return intoLineup.sort(byProj);

    const fromBench = roster
      .filter((p) => p.slot === "BN" && slotOk(from, p.position))
      .map((p) => ({ key: p.player_id, slot: "BN", player: p }));
    return [
      ...fromBench.sort(byProj),
      ...intoLineup.sort(byProj),
      { key: "to-bench", slot: "BN", player: null },
    ];
  }, [moving, starters, roster]);

  // On a phone the options rise as a sheet (drawn once, below); on a wide
  // screen they open under the row, where both are in view.
  const narrow = useNarrow();
  const swapPanel = (p: HubPlayer | null) =>
    !narrow && moving && p && moving.player_id === p.player_id ? (
      <SwapOptions
        player={moving}
        options={swapOptions}
        busy={busy}
        onPick={(o) => onDrop({ slot: o.slot, player: o.player })}
        onCancel={onCancelMove}
      />
    ) : null;
  const toggle = (p: HubPlayer) => (moving?.player_id === p.player_id ? onCancelMove() : onPickUp(p));

  const empties = starters.filter((s) => !s.player).length;

  const mine = Number(hub.matchup?.my_points ?? hub.splits.starter_points ?? 0);
  const theirs = Number(hub.matchup?.opp_points ?? 0);
  const shownMine = useCountUp(mine);
  const shownTheirs = useCountUp(theirs);

  const rec = hub.record;
  const projected = Number(hub.splits.projected_starters ?? 0);

  // Which half of the roster is in view, for the phone's Starters / Bench
  // switch. Read off the page rather than kept in state the taps set, so a
  // thumb scroll moves the marker as surely as a tap does.
  const startersRef = useRef<HTMLElement>(null);
  const benchRef = useRef<HTMLElement>(null);
  const [onBench, setOnBench] = useState(false);
  useEffect(() => {
    const el = benchRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => setOnBench(e.boundingClientRect.top < window.innerHeight * 0.5),
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "0px 0px -40% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const jump = (el: HTMLElement | null) => {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 118;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <>
      <main className="page" data-desk="team">
        {/* ------------------------------------------------- phone header -- */}
        <DeskHeader hub={hub} crest={crest} readOnly={readOnly} picker={picker} onEdit={onEdit} />
        <DeskScore
          hub={hub}
          mine={shownMine}
          theirs={shownTheirs}
          projected={projected}
          starters={starters.map((s) => s.player)}
          currentWeek={currentWeek}
          onWeek={onWeek}
          oppCrest={oppCrest}
        />
        <DeskTabs matchupId={hub.matchup?.id ?? null} />

        {/* --------------------------------------------------------- hero -- */}
        <section className="th-hero d-only">
          <div className="th-hero__top">
            <div className="th-side">
              <Seal name={hub.team.name} src={crest} mine size={46} />
              <div style={{ minWidth: 0 }}>
                <h1>{hub.team.name}</h1>
                <div className="th-side__meta">
                  {rec && (
                    <span className="badge" data-tone="wine">
                      {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""}
                    </span>
                  )}
                  {rec && <span className="eyebrow">{ordinal(rec.rank)} of {rec.teams}</span>}
                  {readOnly && (
                    <span className="badge" data-tone="neutral" title="Another manager's team — read only">
                      <Eye size={11} /> Viewing
                    </span>
                  )}
                  {onEdit && !readOnly && (
                    <button className="btn" data-v="ghost" data-size="sm" onClick={onEdit}>
                      <Pencil size={13} /> Edit team
                    </button>
                  )}
                  {picker}
                </div>
              </div>
            </div>

            <div className="th-vs">
              <span className="th-vs__pts num" data-lead={mine >= theirs}>{shownMine.toFixed(1)}</span>
              <span className="th-vs__sep">
                Week {hub.week}{hub.matchup ? (hub.matchup.home ? " · Home" : " · Away") : ""}
              </span>
              <span className="th-vs__pts num" data-lead={theirs > mine}>
                {hub.matchup ? shownTheirs.toFixed(1) : "—"}
              </span>
            </div>

            <div className="th-side" data-align="end">
              <div style={{ minWidth: 0 }}>
                {/* The opponent is a door, not a label: their desk is one tap
                    away, the same way this one was from the standings. */}
                <h1>
                  {hub.matchup
                    ? <TeamLink id={hub.matchup.opponent.id} name={hub.matchup.opponent.name}>
                        {hub.matchup.opponent.name}
                      </TeamLink>
                    : "No opponent"}
                </h1>
                <div className="th-side__meta">
                  {hub.matchup?.opponent.record && (
                    <span className="badge" data-tone="neutral">
                      {hub.matchup.opponent.record.wins}–{hub.matchup.opponent.record.losses}
                      {hub.matchup.opponent.record.ties ? `–${hub.matchup.opponent.record.ties}` : ""}
                    </span>
                  )}
                  <span className="eyebrow">This week&apos;s opponent</span>
                </div>
              </div>
              <Seal name={hub.matchup?.opponent.name ?? "—"} src={oppCrest} size={46} />
            </div>
          </div>

          <div className="th-strip">
            <div className="th-stat">
              <b>{Number(hub.splits.starter_points).toFixed(1)}</b>
              <span>Starters this week</span>
            </div>
            <div className="th-stat">
              <b data-tone="gold">{projected > 0 ? projected.toFixed(1) : "—"}</b>
              <span>Projected</span>
            </div>
            <div className="th-stat">
              <b data-tone={empties ? "warn" : "ok"}>{starters.length - empties}/{starters.length}</b>
              <span>Slots filled</span>
            </div>
            <div className="th-stat">
              <b>{Number(rec?.points_for ?? 0).toFixed(0)}</b>
              <span>Points for</span>
            </div>
            <div className="th-stat">
              <b>{Number(rec?.points_against ?? 0).toFixed(0)}</b>
              <span>Points against</span>
            </div>
            <div className="th-stat">
              <b data-tone={insights.some((i) => i.kind === "alert") ? "warn" : "gold"}>{insights.length}</b>
              <span>Wire notes on your roster</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- roster moves -- */}
        {/* The reader's own desk only. The doors lead to *his* signings and
            claims, and the deadline matters to the man with a claim to file —
            not to somebody looking over another manager's roster. */}
        {!readOnly && <div className="d-only"><RosterMoves settlesAt={settlesAt} /></div>}

        {/* -------------------------------------------------- week picker -- */}
        {/* The phone picks its week from the score card's select. */}
        <div className="scroll d-only" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <button key={w} className="segmented__opt num" data-on={w === hub.week}
                aria-current={w === currentWeek ? "date" : undefined}
                title={w === currentWeek ? "This week" : undefined}
                style={w === currentWeek && w !== hub.week ? { textDecoration: "underline" } : undefined}
                onClick={() => onWeek(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* A week ahead is a plan, and it is easy to set one without noticing
            which week the picker is on. Say so, and say what happens to the
            weeks in between, which is the question it raises. */}
        {!readOnly && currentWeek != null && hub.week > currentWeek && (
          <div className="note" data-kind="info" role="status" style={{ borderRadius: "var(--r-sm)" }}>
            Planning week {hub.week}. Moves here apply to week {hub.week} only — this
            week&apos;s lineup is untouched. A week you don&apos;t set starts from the
            latest lineup before it.{" "}
            <button type="button" className="btn" data-v="ghost" data-size="sm"
              onClick={() => onWeek(currentWeek)}>
              Back to week {currentWeek}
            </button>
          </div>
        )}

        {/* --------------------------------------------------------- grid -- */}
        <div className="th-grid">
          <div className="th-col">
            {/* Starters / Bench, pinned under the top bar on a phone so either
                half of the roster is one tap away from anywhere in the other. */}
            <div className="mt-jump m-only" role="group" aria-label="Jump to">
              <button type="button" data-on={!onBench} onClick={() => jump(startersRef.current)}>
                Starters <span className="num">{starters.length - empties}/{starters.length}</span>
              </button>
              <button type="button" data-on={onBench} onClick={() => jump(benchRef.current)}>
                Bench <span className="num">{bench.length}</span>
              </button>
              <button type="button" className="mt-jump__coach" data-gain={plan.gain > 0.05 || undefined}
                onClick={() => setCoaching(true)} disabled={busy}>
                <Wand2 size={13} aria-hidden />
                Best lineup
                {plan.gain > 0.05 && <span className="num">+{plan.gain.toFixed(1)}</span>}
              </button>
            </div>
            <section className="card lineup" data-accent="gold" ref={startersRef}>
              <div className="card__head d-only">
                <h2>Starting lineup</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", flexWrap: "wrap" }}>
                  <span className="eyebrow">
                    <span className="num">{Number(hub.splits.starter_points).toFixed(1)}</span> points
                  </span>
                  {/* The gain is on the button rather than behind it: a manager
                      who is already right should be able to see that without
                      opening anything. */}
                  <button className="btn" data-v={plan.gain > 0.05 ? "gold" : undefined} data-size="sm"
                    onClick={() => setCoaching(true)} disabled={busy}>
                    <Wand2 size={13} />
                    Best lineup
                    {plan.gain > 0.05 && <span className="num">+{plan.gain.toFixed(1)}</span>}
                  </button>
                </div>
              </div>

              {empties > 0 && (
                <div className="note" data-kind="error">
                  {empties} starting {empties === 1 ? "slot is" : "slots are"} empty — those score zero.
                </div>
              )}
              <div>
                {starters.map((s) => (
                  <Fragment key={s.key}>
                    <PlayerRow
                      slot={s.slot}
                      player={s.player}
                      week={hub.week}
                      injury={injuries.get(s.player?.player_id ?? "") ?? null}
                      projection={s.player?.projection ?? null}
                      selected={!!moving && moving.player_id === s.player?.player_id}
                      busy={busy}
                      canMove={!readOnly}
                      onPickUp={() => s.player && toggle(s.player)}
                    />
                    {swapPanel(s.player)}
                  </Fragment>
                ))}
              </div>
            </section>

            <section className="card lineup" ref={benchRef}>
              <div className="card__head">
                <h2>Bench</h2>
                <span className="eyebrow">
                  <span className="num">{Number(hub.splits.bench_points).toFixed(1)}</span> points ·{" "}
                  <span className="num">{bench.length}</span> players
                </span>
              </div>
              <div>
                {bench.length === 0 && <div className="empty">Bench is empty.</div>}
                {bench.map((p) => (
                  <Fragment key={p.player_id}>
                    <PlayerRow
                      slot="BN"
                      player={p}
                      week={hub.week}
                      injury={injuries.get(p.player_id) ?? null}
                      projection={p.projection}
                      selected={moving?.player_id === p.player_id}
                      busy={busy}
                      canMove={!readOnly}
                      onPickUp={() => toggle(p)}
                    />
                    {swapPanel(p)}
                  </Fragment>
                ))}
              </div>
            </section>

            {/* The phone's roster tools sit under the roster they change. */}
            {!readOnly && <div className="m-only"><RosterMoves settlesAt={settlesAt} /></div>}
          </div>

          <div className="th-col">
            <InsightBoard insights={insights} wire={wire} whose={readOnly ? hub.team.name : null} />
            <TeamStats hub={hub} />
            <NewsWire mine={tagged} all={wire?.articles ?? []} wire={wire} own={!readOnly} />
            {/* Per-manager and per-device, so it belongs on his own screen
                rather than in the commissioner's league settings — and not on
                anybody else's desk. */}
            {!readOnly && <Notifications />}
          </div>
        </div>
      </main>

      {narrow && moving && (
        <SwapSheet
          player={moving}
          options={swapOptions}
          busy={busy}
          onPick={(o) => onDrop({ slot: o.slot, player: o.player })}
          onCancel={onCancelMove}
        />
      )}

      {coaching && (
        <Coach
          plan={plan}
          week={hub.week}
          busy={busy}
          weather={weather}
          own={!readOnly}
          onClose={() => setCoaching(false)}
          onApply={onSetLineup && !readOnly ? (async () => {
            const assignments: Record<string, string> = {};
            for (const m of plan.moves) assignments[m.player.player_id] = m.to;
            await onSetLineup(assignments);
            setCoaching(false);
          }) : undefined}
        />
      )}
    </>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
