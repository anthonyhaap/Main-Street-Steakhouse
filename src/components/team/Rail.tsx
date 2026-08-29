"use client";

import { useState } from "react";
import {
  AlertTriangle, ArrowDownRight, CalendarClock, ExternalLink, Newspaper, TrendingUp,
} from "lucide-react";
import { Face, TeamLogo, fmtWhen } from "@/components/nfl";
import type { Insight } from "@/lib/nfl/insights";
import type { HubPlayer, TeamHub, Wire, WireArticle } from "@/lib/nfl/types";

/* -------------------------------------------------------- opportunity -- */

const KIND_ICON = {
  alert: AlertTriangle,
  boost: TrendingUp,
  downgrade: ArrowDownRight,
  schedule: CalendarClock,
} as const;

const KIND_WORD = {
  alert: "Act on this",
  boost: "More volume",
  downgrade: "Downgrade",
  schedule: "Not playing",
} as const;

/**
 * The whole point of the page, in one card.
 *
 * A national injury report is a wall of names that mean nothing to you. Read
 * against your roster it becomes two or three sentences that change a lineup:
 * the back ahead of yours is out, so his carries are yours this week. The
 * ranking is done in `buildInsights`; this only draws it.
 */
export function InsightBoard({
  insights, wireOk, onOpen,
}: {
  insights: Insight[];
  wireOk: boolean;
  onOpen: (p: HubPlayer) => void;
}) {
  return (
    <section className="card" data-accent="gold">
      <div className="card__head">
        <h2>What changed for you</h2>
        <span className="eyebrow">
          {insights.length ? <><span className="num">{insights.length}</span> notes</> : "Clear"}
        </span>
      </div>

      {!wireOk && (
        <div className="note" data-kind="info">
          The NFL wire is not answering right now, so this only reflects byes and
          the schedule. It will fill back in on its own.
        </div>
      )}

      {insights.length === 0 ? (
        <div className="empty" style={{ padding: "var(--s6) var(--s5)" }}>
          Nothing on the wire touches your roster.<br />Set it and enjoy the games.
        </div>
      ) : (
        <div>
          {insights.map((n) => {
            const Icon = KIND_ICON[n.kind];
            return (
              <button key={n.id} type="button" className="ins" data-kind={n.kind}
                onClick={() => onOpen(n.player)}>
                <Face player={n.player} size={38} />
                <span className="ins__body">
                  <b>{n.headline}</b>
                  <p>{n.detail}</p>
                  <span className="ins__tag">
                    <Icon size={11} strokeWidth={2.4} />
                    {KIND_WORD[n.kind]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- wire -- */

type Tagged = { article: WireArticle; players: HubPlayer[]; clubs: string[] };

export function NewsWire({ mine, all, wire }: { mine: Tagged[]; all: WireArticle[]; wire: Wire | null }) {
  const [tab, setTab] = useState<"mine" | "league">("mine");
  const newsOk = wire?.sources.find((s) => s.name === "news")?.ok ?? false;
  const showing = tab === "mine" ? mine : all.map((a) => ({ article: a, players: [], clubs: [] }));

  return (
    <section className="card">
      <div className="card__head">
        <h2>The wire</h2>
        <div className="segmented">
          <button className="segmented__opt" data-on={tab === "mine"} onClick={() => setTab("mine")}>
            My players
          </button>
          <button className="segmented__opt" data-on={tab === "league"} onClick={() => setTab("league")}>
            League
          </button>
        </div>
      </div>

      {!wire && <div className="empty" style={{ padding: "var(--s6)" }}>Pulling the wire…</div>}

      {wire && !newsOk && (
        <div className="note" data-kind="error">
          Couldn&apos;t reach the NFL news feed. Nothing else on this page depends on it.
        </div>
      )}

      {wire && newsOk && showing.length === 0 && (
        <div className="empty" style={{ padding: "var(--s6) var(--s5)" }}>
          {tab === "mine"
            ? "No stories about your roster in the last day."
            : "The wire is quiet."}
        </div>
      )}

      <div>
        {showing.slice(0, 14).map(({ article, players, clubs }) => (
          <NewsItem key={article.id} article={article} players={players} clubs={clubs} />
        ))}
      </div>

      {wire && newsOk && (
        <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--rule-soft)" }}>
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>
            Headlines and photographs from ESPN · {fmtWhen(wire.fetchedAt)}
          </span>
        </div>
      )}
    </section>
  );
}

function NewsItem({ article, players, clubs }: Tagged) {
  const mine = players.length > 0;
  return (
    <a className="news" data-mine={mine} href={article.url ?? undefined}
      target="_blank" rel="noopener noreferrer">
      <span className="news__shot">
        {article.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- ESPN CDN photo, fixed box
          <img src={article.image.url} alt={article.image.alt} loading="lazy" decoding="async" />
        ) : (
          <Newspaper size={18} color="var(--faint)" />
        )}
      </span>
      <span className="news__body">
        <b>{article.headline}</b>
        {article.description && <p>{article.description}</p>}
        <span className="news__meta">
          {players.slice(0, 2).map((p) => (
            <span key={p.player_id} className="badge" data-tone="wine" style={{ minHeight: 18, fontSize: 9 }}>
              {p.full_name}
            </span>
          ))}
          {!mine && clubs.slice(0, 2).map((c) => <TeamLogo key={c} abbr={c} size={13} />)}
          {article.published && <span>{fmtWhen(article.published)}</span>}
          {article.url && <ExternalLink size={10} />}
        </span>
      </span>
    </a>
  );
}

/* -------------------------------------------------------------- stats -- */

const POS_VAR: Record<string, string> = {
  QB: "var(--qb)", RB: "var(--rb)", WR: "var(--wr)",
  TE: "var(--te)", K: "var(--k)", DST: "var(--dst)",
};

/**
 * Where the week came from, and what it cost. The bench line is the one that
 * stings: points that scored for nobody because they sat.
 */
export function TeamStats({ hub, onOpen }: { hub: TeamHub; onOpen: (p: HubPlayer) => void }) {
  const splits = hub.splits.by_position;
  const top = Math.max(1, ...splits.map((s) => Number(s.points)));

  const scored = [...hub.roster].sort((a, b) => Number(b.points) - Number(a.points));
  const best = scored[0];
  const benchBest = scored.find((p) => p.slot === "BN");
  const started = hub.roster.filter((p) => p.slot !== "BN");
  const missing = started.filter((p) => p.on_bye || !p.game).length;

  const form = hub.roster.filter((p) => p.form && p.form.games > 0);
  const steadiest = [...form].sort((a, b) => a.form!.swing - b.form!.swing)[0];
  const wildest = [...form].sort((a, b) => b.form!.swing - a.form!.swing)[0];

  return (
    <section className="card">
      <div className="card__head">
        <h2>Team stats</h2>
        <span className="eyebrow">
          Week <span className="num">{hub.week}</span>
        </span>
      </div>

      <div className="th-strip" style={{ borderTop: 0 }}>
        <div className="th-stat">
          <b>{Number(hub.splits.starter_points).toFixed(1)}</b>
          <span>Starters</span>
        </div>
        <div className="th-stat">
          <b data-tone={Number(hub.splits.bench_points) > Number(hub.splits.starter_points) * 0.4 ? "warn" : undefined}>
            {Number(hub.splits.bench_points).toFixed(1)}
          </b>
          <span>Left on the bench</span>
        </div>
        <div className="th-stat">
          <b data-tone={missing ? "warn" : "ok"}>{started.length - missing}/{started.length}</b>
          <span>Starters with a game</span>
        </div>
      </div>

      {splits.length > 0 && (
        <div style={{ padding: "var(--s2) 0" }}>
          {splits.map((s) => (
            <div className="split" key={s.position} style={{ color: POS_VAR[s.position] ?? "var(--dim)" }}>
              <span className="pos" data-p={s.position} style={{ minWidth: 40 }}>{s.position}</span>
              <span className="split__bar">
                <i style={{ width: `${(Number(s.points) / top) * 100}%` }} />
              </span>
              <span className="num" style={{ fontSize: "var(--t-small)", color: "var(--cream)", minWidth: 44, textAlign: "right" }}>
                {Number(s.points).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--rule)" }}>
        {best && <StatLine label="Top scorer" player={best} value={`${Number(best.points).toFixed(1)} pts`} onOpen={onOpen} />}
        {benchBest && Number(benchBest.points) > 0 && (
          <StatLine label="Best on the bench" player={benchBest} value={`${Number(benchBest.points).toFixed(1)} pts`} onOpen={onOpen} />
        )}
        {steadiest?.form && (
          <StatLine label="Most reliable" player={steadiest}
            value={`±${steadiest.form.swing.toFixed(1)}`} onOpen={onOpen} />
        )}
        {wildest?.form && wildest.player_id !== steadiest?.player_id && (
          <StatLine label="Biggest swing" player={wildest}
            value={`±${wildest.form.swing.toFixed(1)}`} onOpen={onOpen} />
        )}
      </div>

      {hub.form_season && hub.form_season !== hub.league.season && (
        <div className="note" data-kind="info" style={{ borderBottom: 0 }}>
          Form and usage are last season&apos;s ({hub.form_season}), scored under this
          league&apos;s rules. They switch to {hub.league.season} as the games are played.
        </div>
      )}
    </section>
  );
}

function StatLine({
  label, player, value, onOpen,
}: {
  label: string; player: HubPlayer; value: string; onOpen: (p: HubPlayer) => void;
}) {
  return (
    <button type="button" onClick={() => onOpen(player)}
      style={{
        display: "flex", alignItems: "center", gap: "var(--s3)", width: "100%",
        padding: "8px var(--s4)", border: 0, borderTop: "1px solid var(--rule-soft)",
        background: "none", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left",
      }}>
      <Face player={player} size={28} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="eyebrow" style={{ display: "block", letterSpacing: "0.12em" }}>{label}</span>
        <span style={{
          display: "block", fontSize: "var(--t-small)", fontWeight: 600, marginTop: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {player.full_name}
        </span>
      </span>
      <span className="num" style={{ fontSize: "var(--t-small)", color: "var(--muted)" }}>{value}</span>
    </button>
  );
}
