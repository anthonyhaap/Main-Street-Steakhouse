"use client";

/**
 * What the game center knows about the league, on screen.
 *
 *   Storylines      the sentences the league's own data supports, live
 *   What do I need? your gap, who is left to close it, and what they score for
 *   Manager status  a card for every manager — the mood, the number, the path
 *   Tune            the commissioner's dials on the excitement score
 *
 * Everything here is a picture of `@/lib/sunday`: the words and the numbers
 * are worked out there, purely, so the preview and the live page agree.
 */

import { useState } from "react";
import { fmt1, who, type ScoreCard } from "@/lib/scoreboard";
import {
  WEIGHT_DIALS, gameFor, lastName, managerStatuses, pathToWin,
  type NflGame, type Phase, type Story, type SundayBoard,
} from "@/lib/sunday";
import { MoodChip } from "./bits";

/* ------------------------------------------------------------ storylines -- */

export function Storylines({ stories, onOpen, limit = 5 }: {
  stories: Story[]; onOpen: (matchupId: string) => void; limit?: number;
}) {
  if (stories.length === 0) return null;
  return (
    <section className="sun-sec" data-panel="stories" aria-label="Sunday storylines">
      <div className="sun-sec__head"><h2>📰 Sunday storylines</h2></div>
      <ul className="sun-stories">
        {stories.slice(0, limit).map((s) => (
          <li key={s.id}>
            <button type="button" className="sun-story" onClick={() => onOpen(s.matchupId)}>
              <span aria-hidden className="sun-story__e">{s.emoji}</span>
              <span>{s.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------- what do I need? -- */

/**
 * Your path to victory, for the one table that is yours. Only while it is
 * being played: before kickoff the answer is "your projection", and after the
 * whistle there is nothing left to need.
 */
export function WhatDoINeed({ board, nfl, onOpen }: {
  board: SundayBoard; nfl: NflGame[]; onOpen: (matchupId: string) => void;
}) {
  const card = board.matchups.find((c) => c.home.mine || c.away.mine);
  if (!card) return null;
  const key = card.home.mine ? "home" : "away";
  const path = pathToWin(card, key, board.intel?.rules ?? {});
  if (!path) return null;
  const them = key === "home" ? card.away : card.home;

  return (
    <section className="sun-sec sun-need" data-panel="need" aria-label="What do I need?">
      <div className="sun-sec__head">
        <h2>🎯 What do I need?</h2>
        <button type="button" className="sun-linkish" onClick={() => onOpen(card.id)}>v {who(them)}</button>
      </div>
      {path.need !== null ? (
        <p className="sun-need__lede">
          About <b>{fmt1(path.need)}</b> more to pass {who(them)}&apos;s projected {fmt1(path.oppProjected)}
          {path.tds !== null && path.tds > 0 && <> — roughly {path.tds === 1 ? "one touchdown" : `${fmt1(path.tds)} touchdowns`}&apos; worth</>}.
        </p>
      ) : (
        <p className="sun-need__lede">
          On course: projected <b>{fmt1(path.projected)}</b> to {who(them)}&apos;s {fmt1(path.oppProjected)}. Hold on.
        </p>
      )}
      {path.players.length > 0 ? (
        <ul className="sun-need__list">
          {path.players.map(({ p, units }) => {
            const g = gameFor(nfl, p.nfl_team);
            const when = p.game_status === "in" ? (p.game_detail ?? g?.detail ?? "Live") : "Yet to play";
            return (
              <li key={p.player_id}>
                <span className="sun-need__who"><b>{p.full_name}</b> <span>{p.position} · {when}</span></span>
                {units.length > 0 && (
                  <span className="sun-need__units">
                    {units.map((u) => <span key={u.label}>{u.label} <b>+{fmt1(u.pts)}</b></span>)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sun-need__note">Nobody left to play — it is down to {who(them)}&apos;s men falling short.</p>
      )}
      {path.need !== null && path.oppLeft > 0 && (
        <p className="sun-need__note">
          {who(them)} still has {path.oppLeft} to play, so this is the gap to a projection, not a guarantee.
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------- manager status -- */

export function ManagerStatusBoard({ board, phase, onOpen }: {
  board: SundayBoard; phase: Phase; onOpen: (matchupId: string) => void;
}) {
  if (phase === "pre") return null;
  const list = managerStatuses(board);
  if (list.length === 0) return null;
  return (
    <section className="sun-sec" data-panel="room" aria-label="Manager status">
      <div className="sun-sec__head"><h2>🧑‍🍳 Manager status</h2><span>Entertainment labels, not odds</span></div>
      <div className="sun-room">
        {list.map((s) => (
          <button key={`${s.card.id}:${s.key}`} type="button" className="sun-mgr" data-mine={s.side.mine}
            data-mood={s.mood?.key} onClick={() => onOpen(s.card.id)}>
            <span className="sun-mgr__top">
              <b>{who(s.side)}{s.side.mine ? " · You" : ""}</b>
              <MoodChip mood={s.mood} />
            </span>
            <span className="sun-mgr__pts">{fmt1(s.side.points)}</span>
            <span className="sun-mgr__line">
              {s.left.length > 0
                ? <>Projected {fmt1(s.projected)} · {s.left.length} to play</>
                : <>Done for the day</>}
            </span>
            {s.need !== null && <span className="sun-mgr__line">Needs about <b>{fmt1(s.need)}</b> more</span>}
            {s.left.length > 0 && s.left.length <= 3 && (
              <span className="sun-mgr__left">{s.left.map((p) => lastName(p.full_name)).join(", ")}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ why this one -- */

/** "Why this table": the reasons the excitement score counted, in words. */
export function WhyFeatured({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return <p className="sun-why">Featured for: {reasons.join(" · ")}</p>;
}

/* ------------------------------------------------------------------ tune -- */

/**
 * The commissioner's dials. Each number is sent as typed; the server holds the
 * bounds and refuses anything outside them, and the page shows what it said.
 */
export function TuneExcitement({ weights, onSave }: {
  weights: Record<string, number>;
  onSave: (changes: Record<string, number | null>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    const changes: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(draft)) changes[k] = v.trim() === "" ? null : Number(v);
    setBusy(true);
    setNote(null);
    try {
      await onSave(changes);
      setDraft({});
      setNote("Saved. The featured table and the feed use it from the next look.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sun-sec" data-panel="tune" aria-label="Tune the game center">
      <details className="sun-tune">
        <summary>⚙️ Tune what counts as exciting <span>Commissioner</span></summary>
        <p className="sun-need__note">
          These weights pick the featured table, order the RedZone and decide what reaches the ticker. Leave a box
          empty to go back to the default.
        </p>
        <div className="sun-tune__grid">
          {WEIGHT_DIALS.map((d) => (
            <label key={d.key} className="sun-tune__row">
              <span><b>{d.label}</b><span>{d.hint}</span></span>
              <input
                type="number" inputMode="numeric" min={d.lo} max={d.hi} step={1}
                aria-label={d.label}
                value={draft[d.key] ?? String(weights[d.key] ?? "")}
                onChange={(e) => setDraft((x) => ({ ...x, [d.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="sun-tune__foot">
          {note && <span role="status">{note}</span>}
          <button type="button" className="sun-btn" data-v="gold" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save weights"}
          </button>
        </div>
      </details>
    </section>
  );
}

/** For the featured panel: the storylines about one table. */
export function storiesFor(stories: Story[], card: ScoreCard | null, n = 2): Story[] {
  return card ? stories.filter((s) => s.matchupId === card.id).slice(0, n) : [];
}
