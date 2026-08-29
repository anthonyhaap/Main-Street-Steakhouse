"use client";

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { Face, InjuryBadge, Kickoff, TeamLogo, fmtWhen } from "@/components/nfl";
import { team as clubOf } from "@/lib/nfl/teams";
import type { HubPlayer, WireArticle, WireInjury } from "@/lib/nfl/types";

/** Labels for the usage keys, in the order a manager reads them. */
const USAGE_LABELS: [keyof NonNullable<HubPlayer["form"]>["usage"], string][] = [
  ["snap_pct", "Snap share"],
  ["carries", "Carries"],
  ["targets", "Targets"],
  ["catches", "Catches"],
  ["rush_yds", "Rush yards"],
  ["rec_yds", "Rec yards"],
  ["pass_yds", "Pass yards"],
  ["pass_att", "Attempts"],
  ["tds", "Touchdowns"],
  ["turnovers", "Turnovers"],
  ["fg_made", "Field goals"],
  ["sacks", "Sacks"],
];

/**
 * The full card on one player: his week, his season, how he got there, and
 * whatever the wire is currently saying about him.
 *
 * Everything here is already in memory — the hub payload carries the game log
 * and usage rates, the wire carries his headlines — so opening a player costs
 * nothing and closing it loses nothing.
 */
export function PlayerSheet({
  player, week, injury, news, onClose,
}: {
  player: HubPlayer;
  week: number;
  injury: WireInjury | null;
  news: WireArticle[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const form = player.form;
  const club = clubOf(player.nfl_team);
  const log = form?.game_log ?? [];
  const peak = Math.max(1, ...log.map((g) => g.points));
  const usage = form?.usage ?? {};
  const shown = USAGE_LABELS.filter(([k]) => {
    const v = usage[k];
    return typeof v === "number" && v > 0;
  });

  return (
    <div className="sheet__wrap" role="dialog" aria-modal="true"
      aria-label={player.full_name} onClick={onClose}>
      <div className="sheet__card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hero">
          <Face player={player} size={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{player.full_name}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", marginTop: 6, flexWrap: "wrap" }}>
              <span className="pos" data-p={player.position}>{player.position}</span>
              <TeamLogo abbr={player.nfl_team} size={18} />
              <span style={{ fontSize: "var(--t-small)", color: "var(--muted)" }}>
                {club?.name ?? "Free agent"}
              </span>
              {player.depth.rank && player.depth.of ? (
                <span className="badge" data-tone="neutral">
                  {player.position}{player.depth.rank} of {player.depth.of}
                </span>
              ) : null}
              <span className="badge" data-tone={player.slot === "BN" ? "neutral" : "wine"}>
                {player.slot === "BN" ? "Bench" : `Starting ${player.slot}`}
              </span>
            </div>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {injury && injury.severity !== "probable" && (
          <div className="note" data-kind="error">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexWrap: "wrap" }}>
              <InjuryBadge injury={injury} />
              {injury.returnDate && <span>Targeting a return {injury.returnDate}.</span>}
            </div>
            {injury.comment && <div style={{ marginTop: 6 }}>{injury.comment}</div>}
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "var(--s3)", padding: "var(--s3) var(--s5)", borderBottom: "1px solid var(--rule)",
          flexWrap: "wrap",
        }}>
          <Kickoff game={player.game} week={week} />
          <span>
            <span className="score" style={{ fontSize: "1.4rem", color: "var(--gold)" }}>
              {Number(player.points).toFixed(1)}
            </span>
            <span className="eyebrow" style={{ marginLeft: 8 }}>Week {week}</span>
          </span>
        </div>

        {form ? (
          <>
            <div className="sheet__facts">
              <Fact label={`${form.season} avg`} value={form.avg_points.toFixed(1)} />
              <Fact label="Last 3" value={form.last3_avg != null ? form.last3_avg.toFixed(1) : "—"} />
              <Fact label="Best" value={form.best.toFixed(1)} />
              <Fact label="Worst" value={form.worst.toFixed(1)} />
              <Fact label="15+ weeks" value={String(form.booms)} />
              <Fact label="Under 5" value={String(form.busts)} />
            </div>

            {log.length > 0 && (
              <>
                <div className="card__head" style={{ borderTop: "1px solid var(--rule)" }}>
                  <h2 style={{ fontSize: "var(--t-body)" }}>{form.season} game log</h2>
                  <span className="eyebrow">Our scoring · ±{form.swing.toFixed(1)} swing</span>
                </div>
                <div className="gamelog">
                  {log.map((g) => (
                    <span className="gamelog__col" key={g.week} data-best={g.points === form.best}>
                      <b>{g.points.toFixed(0)}</b>
                      <i className="gamelog__bar" style={{ height: `${Math.max(2, (g.points / peak) * 100)}%` }} />
                      <span>W{g.week}</span>
                    </span>
                  ))}
                </div>
              </>
            )}

            {shown.length > 0 && (
              <>
                <div className="card__head" style={{ borderTop: "1px solid var(--rule)" }}>
                  <h2 style={{ fontSize: "var(--t-body)" }}>Per game</h2>
                  <span className="eyebrow">{form.games} games</span>
                </div>
                <div className="sheet__facts" style={{ borderTop: "1px solid var(--rule)" }}>
                  {shown.map(([key, label]) => (
                    <Fact
                      key={key}
                      label={label}
                      value={key === "snap_pct" ? `${Math.round(usage[key] as number)}%` : String(usage[key])}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="empty">No stat lines on file for him yet.</div>
        )}

        {news.length > 0 && (
          <>
            <div className="card__head" style={{ borderTop: "1px solid var(--rule)" }}>
              <h2 style={{ fontSize: "var(--t-body)" }}>On the wire</h2>
              <span className="eyebrow">ESPN</span>
            </div>
            <div>
              {news.slice(0, 4).map((a) => (
                <a key={a.id} className="news" href={a.url ?? undefined} target="_blank" rel="noopener noreferrer">
                  <span className="news__shot">
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ESPN CDN photo, fixed box
                      <img src={a.image.url} alt={a.image.alt} loading="lazy" decoding="async" />
                    ) : null}
                  </span>
                  <span className="news__body">
                    <b>{a.headline}</b>
                    {a.description && <p>{a.description}</p>}
                    <span className="news__meta">
                      {a.published && <span>{fmtWhen(a.published)}</span>}
                      <ExternalLink size={10} />
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </>
        )}

        {(player.depth.overall_rank || player.bye_week) && (
          <div style={{ padding: "var(--s3) var(--s5)", borderTop: "1px solid var(--rule)" }}>
            <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>
              {player.depth.overall_rank ? `Drafted around ${Number(player.depth.adp ?? 0).toFixed(0)} overall` : ""}
              {player.depth.overall_rank && player.bye_week ? " · " : ""}
              {player.bye_week ? `Bye week ${player.bye_week}` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="sheet__fact">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
