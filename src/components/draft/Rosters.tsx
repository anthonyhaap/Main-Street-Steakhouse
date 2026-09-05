"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { Seal } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import { byeStacks, fillRoster, projectedTotal, rosterNeeds, snakeSlot, upcomingPicksFor } from "@/lib/draft";
import type { BoardPick, PoolPlayer, Team } from "@/lib/types";

const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN", "BN", "BN", "BN"];

/**
 * Every team's roster, mid-draft.
 *
 * This is the read the room was missing entirely. A draft is eleven other
 * people building teams in front of you, and the only thing the board could
 * tell you about any of them was a 50px cell in a column you had to scroll
 * sideways to find. Whether the manager picking two spots ahead of you still
 * needs a tight end decides whether you take yours now — so: pick a team, see
 * what they have, what they still need, which byes they've stacked, and when
 * they pick again.
 */
export function Rosters({
  teams, picks, myTeamId, slots, poolById, teamCount, rounds, currentPick, onOpen,
}: {
  teams: Team[];
  picks: BoardPick[];
  myTeamId: string | null;
  /** The league's roster slots; falls back to a standard lineup. */
  slots?: string[];
  poolById?: Map<string, PoolPlayer>;
  teamCount: number;
  rounds: number;
  currentPick: number;
  onOpen?: (playerId: string) => void;
}) {
  const shape = slots?.length ? slots : DEFAULT_SLOTS;
  const ordered = useMemo(
    () => [...teams].sort((a, b) => (a.draft_slot ?? 99) - (b.draft_slot ?? 99)),
    [teams],
  );

  // Your own team first — it's the one you check between every pick — and only
  // until you choose otherwise.
  const [selected, setSelected] = useState<string | null>(null);
  const active = ordered.find((t) => t.id === (selected ?? myTeamId)) ?? ordered[0];

  // Keep the chosen crest in view in the strip; only after a choice, so the
  // first paint never yanks the room around.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(`rost-tab-${selected}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const theirs = useMemo(
    () => (active ? picks.filter((p) => p.team_id === active.id) : []),
    [picks, active],
  );
  const roster = useMemo(() => fillRoster(shape, theirs), [shape, theirs]);
  const needs = useMemo(() => rosterNeeds(shape, theirs), [shape, theirs]);
  const byeOf = (id: string) => poolById?.get(id)?.bye_week ?? null;
  const stacks = useMemo(() => byeStacks(shape, theirs, byeOf), [shape, theirs, poolById]); // eslint-disable-line react-hooks/exhaustive-deps
  const projected = useMemo(
    () => projectedTotal(theirs, (id) => poolById?.get(id)?.proj_total ?? null),
    [theirs, poolById],
  );
  const onClockSlot = snakeSlot(currentPick, teamCount);
  const nextPicks = active?.draft_slot
    ? upcomingPicksFor(active.draft_slot, currentPick, rounds, teamCount)
    : [];

  if (!active) return <div className="card"><div className="empty">No teams in this draft yet.</div></div>;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="rost__pick" role="tablist" aria-label="Teams">
        {ordered.map((t) => (
          <button key={t.id} id={`rost-tab-${t.id}`} role="tab" className="rost__team"
            aria-selected={t.id === active.id}
            data-on={t.id === active.id}
            data-onclock={t.draft_slot === onClockSlot || undefined}
            onClick={() => setSelected(t.id)}
            title={t.draft_slot === onClockSlot ? `${t.name} — on the clock` : t.name}>
            <Seal name={t.name} src={crestUrl(t.logo_path)} mine={t.id === myTeamId} size={30} />
            <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.id === myTeamId ? "You" : t.name}
            </span>
          </button>
        ))}
      </div>

      <div className="scroll rows" style={{ flex: 1, minHeight: 0 }}>
        {roster.map(({ slot, pick }, i) => {
          const bye = pick ? byeOf(pick.player_id) : null;
          const clash = bye != null && stacks.some((s) => s.week === bye);
          return (
            <div className="row" key={i} data-mine={pick && active.id === myTeamId ? "true" : undefined}
              style={{ opacity: pick ? 1 : 0.62 }}>
              <span className="pos rost__slot" data-p={slot}>{slot}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {pick ? (
                  <PlayerBadge
                    id={pick.player_id}
                    name={pick.player_name}
                    position={pick.position}
                    team={pick.nfl_team}
                    espnId={pick.espn_id}
                    size={30}
                    onOpen={onOpen}
                    sub={
                      <>
                        <span>{pick.nfl_team ?? "FA"}</span>
                        <span className="num">R{pick.round}</span>
                        {bye ? (
                          <span style={clash ? { color: "var(--warn)", fontWeight: 700 } : undefined}
                            title={clash ? `Shares week ${bye} bye with another starter` : undefined}>
                            bye {bye}
                          </span>
                        ) : null}
                        {pick.is_autopick && <span>auto</span>}
                      </>
                    }
                  />
                ) : (
                  <span style={{ fontSize: "var(--t-small)", color: "var(--faint)", fontStyle: "italic" }}>Open</span>
                )}
              </div>
              {pick && poolById?.get(pick.player_id)?.proj_total != null && (
                <span className="pool__proj">
                  <b className="num">{Number(poolById.get(pick.player_id)!.proj_total).toFixed(0)}</b>
                  <span>proj</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="rost__foot">
        <span className="eyebrow">
          <span className="num">{theirs.length}</span> of <span className="num">{shape.length}</span> filled
        </span>
        {projected != null && (
          <span className="eyebrow" title="Season projection of everyone drafted, under this league's rules">
            proj <span className="num" style={{ color: "var(--gold)" }}>{projected.toFixed(0)}</span>
          </span>
        )}
        {nextPicks.length > 0 && (
          <span className="eyebrow" title="Their next picks">
            picks at <span className="num">{nextPicks.join(" · ")}</span>
          </span>
        )}
        {needs.length > 0 && (
          <span className="eyebrow" style={{ color: "var(--muted)" }}>
            needs {needs.slice(0, 6).join(" · ")}{needs.length > 6 ? ` +${needs.length - 6}` : ""}
          </span>
        )}
        {stacks.length > 0 && (
          <span className="badge" data-tone="warn" title="Starters sharing a bye week">
            bye clash · {stacks.map((s) => `wk ${s.week} ×${s.count}`).join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
