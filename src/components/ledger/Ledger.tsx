"use client";

import { ArrowLeftRight, Gavel, PenLine } from "lucide-react";
import type { LedgerEntry, LedgerItem } from "@/lib/types";

/**
 * The ledger, as a manager reads it.
 *
 * Three systems now move players — add/drop, waivers and trades — and each one
 * writes the same two-sided rows to `transactions`. Until this screen there was
 * no way to see any of it: a roster changed and the record that explained why
 * was invisible. So this is deliberately one list rather than three, because
 * the database has always treated it as one thing.
 *
 * Presentation only, so the fixture at /preview/ledger can hold it still.
 */

/** The teams an entry touches, in the order they should be named. */
function teamsOf(e: LedgerEntry): string[] {
  const seen: string[] = [];
  for (const i of e.items) {
    for (const t of [i.to_team, i.from_team]) {
      if (t && !seen.includes(t)) seen.push(t);
    }
  }
  return seen;
}

const arriving = (items: LedgerItem[], team: string) => items.filter((i) => i.to_team === team);
const leaving = (items: LedgerItem[], team: string) => items.filter((i) => i.from_team === team);

/** "RB · MIA", or just the position when the club is unknown. */
const tag = (i: LedgerItem) => (i.nfl_team ? `${i.position} · ${i.nfl_team}` : i.position);

const KIND: Record<LedgerEntry["kind"], { label: string; Icon: typeof PenLine }> = {
  add: { label: "Signing", Icon: PenLine },
  drop: { label: "Release", Icon: PenLine },
  add_drop: { label: "Signing", Icon: PenLine },
  waiver: { label: "Waiver", Icon: Gavel },
  trade: { label: "Trade", Icon: ArrowLeftRight },
};

/** The day heading. Today and yesterday are named rather than dated, because
 *  that is how somebody catching up actually reads a list like this. */
export function dayOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const at = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Players({ items }: { items: LedgerItem[] }) {
  return (
    <>
      {items.map((i, n) => (
        <span key={i.player_id}>
          {n > 0 && ", "}
          <strong>{i.player}</strong> <span className="eyebrow">{tag(i)}</span>
        </span>
      ))}
    </>
  );
}

/**
 * One entry, written as a sentence.
 *
 * A trade is the only shape that needs both halves shown, because it is the
 * only one where two teams each give something up. Everything else has one
 * team acting, and the pool on the other side of it.
 */
function Entry({ e }: { e: LedgerEntry }) {
  const { label, Icon } = KIND[e.kind] ?? KIND.add;
  const teams = teamsOf(e);

  return (
    <div className="row" data-kind={e.kind}>
      <div className="row__main">
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <Icon size={13} style={{ color: "var(--faint)", flexShrink: 0 }} />
          <span className="eyebrow">{label}</span>
          <span className="eyebrow" style={{ color: "var(--faint)" }}>
            Week {e.week} · {at(e.created_at)}
          </span>
        </div>

        {e.kind === "trade" ? (
          <div style={{ display: "grid", gap: 3 }}>
            {teams.map((t) => {
              const got = arriving(e.items, t);
              if (got.length === 0) return null;
              return (
                <div key={t} style={{ lineHeight: 1.5 }}>
                  <strong>{t}</strong> get <Players items={got} />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ lineHeight: 1.5 }}>
            {teams[0] ? <strong>{teams[0]}</strong> : "Somebody"}{" "}
            {(() => {
              const t = teams[0] ?? "";
              const got = arriving(e.items, t);
              const gone = leaving(e.items, t);
              return (
                <>
                  {got.length > 0 && (
                    <>
                      {e.kind === "waiver" ? "won " : "signed "}
                      <Players items={got} />
                      {e.kind === "waiver" && " on waivers"}
                    </>
                  )}
                  {got.length > 0 && gone.length > 0 && ", and released "}
                  {got.length === 0 && gone.length > 0 && "released "}
                  {gone.length > 0 && <Players items={gone} />}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

export type LedgerFilter = "all" | "signings" | "waiver" | "trade";

const MATCHES: Record<LedgerFilter, (e: LedgerEntry) => boolean> = {
  all: () => true,
  signings: (e) => e.kind === "add" || e.kind === "drop" || e.kind === "add_drop",
  waiver: (e) => e.kind === "waiver",
  trade: (e) => e.kind === "trade",
};

export function Ledger({
  entries, filter, team, teams, onFilter, onTeam,
}: {
  entries: LedgerEntry[];
  filter: LedgerFilter;
  team: string;
  teams: string[];
  onFilter: (f: LedgerFilter) => void;
  onTeam: (t: string) => void;
}) {
  const shown = entries.filter(
    (e) => MATCHES[filter](e) && (team === "" || teamsOf(e).includes(team)),
  );

  // Grouped by day, newest first. ff_transactions already returns them in `ord`
  // order, so this only has to notice where the day changes.
  const days: { day: string; entries: LedgerEntry[] }[] = [];
  for (const e of shown) {
    const day = dayOf(e.created_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else days.push({ day, entries: [e] });
  }

  return (
    <>
      <div className="card">
        <div className="card__head">
          <h2>The ledger</h2>
          <span className="eyebrow">
            <span className="num">{shown.length}</span> {shown.length === 1 ? "move" : "moves"}
          </span>
        </div>
        <div className="card__body" style={{ display: "grid", gap: 10 }}>
          <div className="segmented" role="group" aria-label="Filter by kind">
            {([
              ["all", "All"], ["signings", "Signings"], ["waiver", "Waivers"], ["trade", "Trades"],
            ] as [LedgerFilter, string][]).map(([k, label]) => (
              <button
                key={k}
                className="segmented__opt"
                data-on={filter === k}
                aria-pressed={filter === k}
                onClick={() => onFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="eyebrow" style={{ display: "grid", gap: 5 }}>
            Team
            <select className="field" value={team} onChange={(e) => onTeam(e.target.value)}>
              <option value="">Every team</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </div>

      {days.length === 0 && (
        <div className="card">
          <div className="empty">
            {entries.length === 0
              ? "Nothing has moved yet. Signings, waiver claims and trades all end up here."
              : "No moves match that. Try another filter."}
          </div>
        </div>
      )}

      {days.map(({ day, entries: onDay }) => (
        <div className="card" key={day}>
          <div className="card__head">
            <h2>{day}</h2>
            <span className="eyebrow"><span className="num">{onDay.length}</span></span>
          </div>
          <div className="rows">
            {onDay.map((e) => <Entry key={e.id} e={e} />)}
          </div>
        </div>
      ))}
    </>
  );
}
