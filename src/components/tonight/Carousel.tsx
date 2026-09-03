"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Seal, fmtPts } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import type { BoardRow, Briefing } from "@/lib/briefing";

/**
 * The six tables, one swipe wide each, yours first. Snaps card to card on a
 * phone; on a desk it is simply a row that scrolls.
 */
export function Carousel({ b, live }: { b: Briefing; live: boolean }) {
  const router = useRouter();
  const teamOf = (id: string) => b.teams.find((t) => t.id === id);
  const rows = [...b.board].sort((x, y) => Number(y.mine) - Number(x.mine));

  if (rows.length === 0) return null;

  return (
    <section className="room" aria-label="This week's tables">
      <div className="room__head">
        <span className="eyebrow">The room · Week {b.week}</span>
        <Link href="/matchups" className="eyebrow" data-tone="gold" style={{ textDecoration: "none" }}>
          Full scoreboard →
        </Link>
      </div>
      <div className="carousel">
        {rows.map((r) => (
          <Link
            key={r.id}
            href="/matchups"
            className="table card"
            data-mine={r.mine}
            onTouchStart={() => router.prefetch("/matchups")}
          >
            <TableSide r={r} side="away" team={teamOf(r.away_team_id)} live={live} me={b.me?.team_id} />
            <TableSide r={r} side="home" team={teamOf(r.home_team_id)} live={live} me={b.me?.team_id} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function TableSide({ r, side, team, live, me }: {
  r: BoardRow; side: "home" | "away";
  team?: { id: string; name: string; manager_name: string | null; logo_path: string | null };
  live: boolean; me?: string | null;
}) {
  const pts = side === "home" ? Number(r.home_points) : Number(r.away_points);
  const other = side === "home" ? Number(r.away_points) : Number(r.home_points);
  const proj = side === "home" ? Number(r.home_proj) : Number(r.away_proj);
  const started = r.home_points + r.away_points > 0;
  const lead = started && pts > other;
  const mine = team?.id === me;
  return (
    <div className="table__side" data-lead={lead} data-mine={mine}>
      <Seal name={team?.name ?? "—"} src={crestUrl(team?.logo_path)} mine={mine} size={30} />
      <span className="table__name">
        <b>{team?.name ?? "—"}</b>
        {team?.manager_name && <i>{team.manager_name}</i>}
      </span>
      <span className="table__pts">
        <b className="num">{started ? fmtPts(pts) : fmtPts(proj)}</b>
        <span className="eyebrow">{started ? (live ? "live" : "") : "proj"}</span>
      </span>
    </div>
  );
}
