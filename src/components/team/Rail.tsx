"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle, ArrowDownRight, CalendarClock, ExternalLink, TrendingUp,
} from "lucide-react";
import { NewsShot, TeamLogo, fmtWhen } from "@/components/nfl";
import { PlayerBadge, PlayerFace } from "@/components/PlayerBadge";
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
export function InsightBoard({ insights, wire }: { insights: Insight[]; wire: Wire | null }) {
  const empty = wire !== null && wire.injuries.length === 0;
  return (
    <section className="card" data-accent="gold">
      <div className="card__head">
        <h2>What changed for you</h2>
        <span className="eyebrow">
          {insights.length ? <><span className="num">{insights.length}</span> notes</> : "Clear"}
        </span>
      </div>

      {empty && (
        <div className="note" data-kind="info">
          No injury report loaded yet, so this only reflects byes and the
          schedule. The wire refreshes every quarter hour.
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
              <div key={n.id} className="ins" data-kind={n.kind}>
                <PlayerFace
                  id={n.player.player_id}
                  name={n.player.full_name}
                  team={n.player.nfl_team}
                  position={n.player.position}
                  espnId={n.player.espn_id}
                  size={38}
                />
                <span className="ins__body">
                  <b><Link href={`/player/${n.player.player_id}`} className="ins__link">
                    {n.headline}
                  </Link></b>
                  <p>{n.detail}</p>
                  <span className="ins__tag">
                    <Icon size={11} strokeWidth={2.4} />
                    {KIND_WORD[n.kind]}
                  </span>
                </span>
              </div>
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
  const newsOk = (wire?.articles.length ?? 0) > 0;
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
        <div className="note" data-kind="info">
          No headlines loaded yet. Nothing else on this page depends on them.
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
            Headlines and photographs from ESPN
            {wire.fetchedAt ? ` · latest ${fmtWhen(wire.fetchedAt)}` : ""}
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
      <NewsShot src={article.image_url} alt={article.image_alt ?? article.headline} />
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
          {article.published_at && <span>{fmtWhen(article.published_at)}</span>}
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
export function TeamStats({ hub }: { hub: TeamHub }) {
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
        {best && <StatLine label="Top scorer" player={best} value={`${Number(best.points).toFixed(1)} pts`} />}
        {benchBest && Number(benchBest.points) > 0 && (
          <StatLine label="Best on the bench" player={benchBest} value={`${Number(benchBest.points).toFixed(1)} pts`} />
        )}
        {steadiest?.form && (
          <StatLine label="Most reliable" player={steadiest} value={`±${steadiest.form.swing.toFixed(1)}`} />
        )}
        {wildest?.form && wildest.player_id !== steadiest?.player_id && (
          <StatLine label="Biggest swing" player={wildest} value={`±${wildest.form.swing.toFixed(1)}`} />
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

function StatLine({ label, player, value }: { label: string; player: HubPlayer; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--s3)",
      padding: "8px var(--s4)", borderTop: "1px solid var(--rule-soft)",
    }}>
      <PlayerBadge
        id={player.player_id}
        name={player.full_name}
        team={player.nfl_team}
        position={player.position}
        espnId={player.espn_id}
        size={28}
        sub={<span className="eyebrow" style={{ letterSpacing: "0.12em" }}>{label}</span>}
      />
      <span className="num" style={{
        marginLeft: "auto", fontSize: "var(--t-small)", color: "var(--muted)",
      }}>{value}</span>
    </div>
  );
}
