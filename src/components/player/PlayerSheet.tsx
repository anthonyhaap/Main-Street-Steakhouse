"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { headshot, teamColor, teamLogo } from "@/lib/nfl/assets";
import { team as clubOf } from "@/lib/nfl/teams";
import type { PlayerCard } from "@/lib/nfl/types";
import { Kickoff, NflImage, fmtWhen } from "@/components/nfl";
import { SkeletonRows } from "@/components/ui";
import { ProjectionCard, SeasonCard } from "@/components/player/PlayerPage";

const SEV_TONE: Record<string, string> = {
  out: "danger", doubtful: "danger", questionable: "warn",
  probable: "ok", unknown: "neutral",
};

const feet = (inches: number | null) =>
  inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null;

/**
 * The player card, in place.
 *
 * ESPN's draft room got this right: a click on a name opens the card over the
 * room, with the pick button on it, and the clock keeps running behind. The
 * full page at /player/[id] is one link away for anyone who wants the depth
 * chart and the whole wire, but during a draft what you need is the face, the
 * projection, last season and a button — without losing your place.
 *
 * Same data as the page (`ff_player_card`), same cards drawn by the same code.
 * A fixture can be handed in as `card` so the sheet renders without a session.
 */
export function PlayerSheet({
  playerId, card: given, onClose, actions,
}: {
  playerId: string;
  card?: PlayerCard;
  onClose: () => void;
  /** Draft / queue buttons, supplied by the room that opened the sheet. */
  actions?: React.ReactNode;
}) {
  // Keyed by player so a stale card never shows under a new name while the
  // next one loads; the state is only ever written from the response.
  const [fetched, setFetched] = useState<{ id: string; card: PlayerCard | null; error: string | null } | null>(null);
  const card = given ?? (fetched?.id === playerId ? fetched.card : null);
  const error = given ? null : fetched?.id === playerId ? fetched.error : null;

  useEffect(() => {
    if (given) return;
    let live = true;
    void supabaseBrowser().rpc("ff_player_card", { p_player_id: playerId }).then(({ data, error: e }) => {
      if (!live) return;
      setFetched({ id: playerId, card: e ? null : (data as PlayerCard), error: e ? e.message : null });
    });
    return () => { live = false; };
  }, [playerId, given]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = card?.player;
  const club = clubOf(p?.nfl_team);
  const color = teamColor(p?.nfl_team);
  const isDst = p?.position === "DST";
  const season = card ? (card.this_season ?? card.last_season) : null;
  const showingLast = !!card && !card.this_season && !!card.last_season;
  const nextProj = card?.projections[0] ?? null;

  return (
    <div className="sheet__wrap" role="dialog" aria-modal aria-label={p?.full_name ?? "Player"}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet__card" style={{
        ["--club" as string]: color ?? "var(--wine)",
        ["--club-wash" as string]: color ? `${color}1f` : "var(--gold-haze)",
        display: "flex", flexDirection: "column",
      }}>
        {/* ------------------------------------------------------- head -- */}
        <div className="sheet__hero" style={{ background: "var(--club-wash)", position: "relative" }}>
          {p ? (
            <>
              <span className="pl-shot" style={{ width: 84, height: 84, flexShrink: 0 }}>
                <NflImage src={headshot(p.espn_id)} alt={p.full_name} size={84}
                  fit={isDst ? "contain" : "cover"} pad={isDst ? 12 : 0} background="transparent" />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.full_name}</h2>
                <div className="pl-id__line" style={{ marginTop: 6 }}>
                  <span className="pos" data-p={p.position}>{p.position}</span>
                  <span className="pl-id__club">
                    <NflImage src={teamLogo(p.nfl_team)} alt={club?.name ?? ""} size={18} radius="0" fit="contain" />
                    {club?.name ?? "Free agent"}
                  </span>
                  {p.jersey != null && <span className="badge" data-tone="neutral">#{p.jersey}</span>}
                  {card?.injury && (
                    <span className="badge" data-tone={SEV_TONE[card.injury.severity] ?? "neutral"}>
                      {card.injury.status}{card.injury.detail ? ` · ${card.injury.detail}` : ""}
                    </span>
                  )}
                  {card?.roster_spot && (
                    <span className="badge" data-tone="wine">{card.roster_spot.team_name}</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)", marginTop: 10, flexWrap: "wrap" }}>
                  {card && <Kickoff game={card.game} week={card.week} />}
                  {nextProj && (
                    <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span className="score" style={{ fontSize: "1.35rem", color: "var(--gold)" }}>
                        {nextProj.points.toFixed(1)}
                      </span>
                      <span className="eyebrow">proj wk {nextProj.week}</span>
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1 }}><h2 style={{ color: "var(--faint)" }}>{error ? "Couldn't load" : "Loading…"}</h2></div>
          )}
          <button className="btn" data-v="ghost" data-size="icon" onClick={onClose} aria-label="Close"
            style={{ position: "absolute", top: 10, right: 10 }}>
            <X size={16} />
          </button>
        </div>

        {/* ------------------------------------------------------- body -- */}
        <div style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
          {error && <div className="note" data-kind="error">Couldn&apos;t load this player: {error}</div>}
          {!card && !error && <SkeletonRows n={6} />}

          {card && p && (
            <>
              {/* Seven facts; narrow enough columns that they sit on one row at
                  the sheet's full width and two rows on a phone. */}
              <div className="sheet__facts" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(33%, 96px), 1fr))" }}>
                <Fact label="Age" value={p.age != null ? String(p.age) : null} />
                <Fact label="Size" value={p.height_in || p.weight_lb
                  ? [feet(p.height_in), p.weight_lb ? `${p.weight_lb} lb` : null].filter(Boolean).join(" · ") : null} />
                <Fact label="Experience" value={
                  p.years_exp == null ? null : p.years_exp === 0 ? "Rookie" : `${p.years_exp} yrs`} />
                <Fact label="Bye" value={p.bye_week ? `Week ${p.bye_week}` : null} />
                <Fact label="Depth" value={
                  p.depth_chart_order ? `${p.depth_chart_pos ?? p.position}${p.depth_chart_order}` : null} />
                <Fact label="ADP" value={card.market?.adp ? Number(card.market.adp).toFixed(1) : null} />
                <Fact label="Rest of season" value={card.rest_of_season > 0 ? card.rest_of_season.toFixed(1) : null} tone="gold" />
              </div>

              {card.injury?.comment && (
                <div className="note" data-kind="error">
                  {card.injury.comment}
                  {card.injury.return_date ? ` Targeting a return ${card.injury.return_date}.` : ""}
                </div>
              )}

              <div style={{ display: "grid", gap: "var(--s4)", padding: "var(--s4)" }}>
                <ProjectionCard card={card} />

                {season ? (
                  <SeasonCard
                    line={season}
                    label={`${season.season} season`}
                    note={showingLast
                      ? `No ${card.league.season} lines yet — this is last season, scored under our rules.`
                      : null}
                    position={p.position}
                  />
                ) : (
                  <section className="card">
                    <div className="card__head"><h2>Season</h2></div>
                    <div className="empty">No stat lines on file for him.</div>
                  </section>
                )}

                {card.news.length > 0 && (
                  <section className="card">
                    <div className="card__head">
                      <h2>On the wire</h2>
                      <span className="eyebrow">ESPN</span>
                    </div>
                    <div className="rows">
                      {card.news.slice(0, 3).map((n) => (
                        <a key={n.id} className="row" href={n.url ?? undefined} target="_blank" rel="noopener noreferrer"
                          style={{ textDecoration: "none", color: "inherit", display: "grid", gap: 3 }}>
                          <b style={{ fontSize: "var(--t-small)", lineHeight: 1.35 }}>{n.headline}</b>
                          <span className="eyebrow" style={{ letterSpacing: "0.08em" }}>
                            {n.published_at ? fmtWhen(n.published_at) : ""}{n.byline ? ` · ${n.byline}` : ""}
                          </span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </div>

        {/* ------------------------------------------------------- foot -- */}
        <div style={{
          display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap",
          padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--rule)", background: "var(--ink-1)",
        }}>
          <Link href={`/player/${playerId}`} className="btn" data-v="ghost" data-size="sm">
            Full page <ExternalLink size={12} />
          </Link>
          <span style={{ marginLeft: "auto", display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
            {actions}
          </span>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string | null; tone?: "gold" }) {
  return (
    <div className="sheet__fact">
      <b style={tone === "gold" && value ? { color: "var(--gold)" } : undefined}>{value ?? "—"}</b>
      <span>{label}</span>
    </div>
  );
}
