"use client";

import { TeamLogo } from "@/components/nfl";
import { team as clubOf } from "@/lib/nfl/teams";

/**
 * How the room picked, once a game has kicked off. Hidden entirely before
 * that — the caller simply doesn't render this when the field is null.
 */
export function PickDistribution({
  distribution, members, awayTeam, homeTeam,
}: {
  distribution: Record<string, number>;
  members: number;
  awayTeam: string;
  homeTeam: string;
}) {
  const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);

  const row = (abbr: string) => {
    const n = distribution[abbr] ?? 0;
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    return (
      <div className="pickem-dist__row" key={abbr}>
        <TeamLogo abbr={abbr} size={16} />
        <span className="pickem-dist__abbr">{clubOf(abbr)?.abbr ?? abbr}</span>
        <div className="meter" style={{ flex: 1 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="num pickem-dist__pct">{pct}%</span>
      </div>
    );
  };

  return (
    <div className="pickem-dist">
      {row(awayTeam)}
      {row(homeTeam)}
      <div className="eyebrow pickem-dist__foot">
        {total} of {members} picked
      </div>
    </div>
  );
}
