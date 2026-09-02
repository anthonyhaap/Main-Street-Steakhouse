"use client";

import Link from "next/link";
import { headshot, teamColor, teamLogo } from "@/lib/nfl/assets";
import { team as clubOf, normTeam } from "@/lib/nfl/teams";
import { NflImage } from "@/components/nfl";

/**
 * Where a badge should open in place instead of navigating.
 *
 * The draft room is the case: leaving the page mid-draft loses the clock, the
 * queue and your place in the list. So a badge can be handed an `onOpen`, and a
 * plain click goes there instead. The href stays, so a middle click, a
 * cmd-click and "open in new tab" still reach the full page.
 */
type Open = ((id: string) => void) | undefined;

function intercept(onOpen: Open, id: string) {
  if (!onOpen) return undefined;
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(id);
  };
}

/**
 * Just the face, linked. For places that already say the player's name in
 * their own words — an insight headline, say — where a second copy of it
 * inside the badge would be noise.
 */
export function PlayerFace({
  id, name, position, team, espnId, size = 38, onOpen,
}: {
  id: string; name: string; position?: string | null;
  team?: string | null; espnId?: string | null; size?: number;
  onOpen?: (id: string) => void;
}) {
  const club = clubOf(team);
  const isDst = position === "DST";
  const color = teamColor(team);

  return (
    <Link href={`/player/${id}`} className="pbadge__face" aria-label={`Open ${name}`}
      onClick={intercept(onOpen, id)}
      style={{ width: size, height: size, flexShrink: 0 }}>
      <NflImage
        src={headshot(espnId)}
        alt={name}
        size={size}
        fit={isDst ? "contain" : "cover"}
        pad={isDst ? Math.round(size * 0.14) : 0}
        background={color ? `${color}1f` : "var(--ink-2)"}
      />
      {!isDst && normTeam(team) && (
        <span className="pbadge__crest" style={{ width: size * 0.44, height: size * 0.44 }}>
          <NflImage src={teamLogo(team)} alt={club?.name ?? ""} size={Math.round(size * 0.34)}
            radius="0" fit="contain" />
        </span>
      )}
    </Link>
  );
}

/**
 * A player, as a thing you can click.
 *
 * Every place a name appears — a lineup row, a wire note, a depth chart, the
 * player list — it should be the same object and it should go to the same
 * place. So the badge is the only way this app draws a player: a face on his
 * club's colour, the crest tucked in the corner, and a link to his page.
 *
 * It is a Link rather than a button on purpose. A player page is a location:
 * it should be openable in a new tab, shareable in the league chat, and
 * reachable with the back button.
 */
export function PlayerBadge({
  id, name, position, team, espnId, size = 38, sub, tone = "plain", onOpen,
}: {
  id: string;
  name: string;
  position?: string | null;
  team?: string | null;
  espnId?: string | null;
  size?: number;
  /** Second line. Falls back to "RB · IND". */
  sub?: React.ReactNode;
  /** "plain" sits in a row; "chip" is a self-contained pill. */
  tone?: "plain" | "chip";
  /** Open in place on a plain click; modified clicks still follow the link. */
  onOpen?: (id: string) => void;
}) {
  const club = clubOf(team);
  const isDst = position === "DST";
  const color = teamColor(team);

  return (
    <Link href={`/player/${id}`} className="pbadge" data-tone={tone} title={`Open ${name}`}
      onClick={intercept(onOpen, id)}>
      <span className="pbadge__face" style={{ width: size, height: size }}>
        <NflImage
          src={headshot(espnId)}
          alt={name}
          size={size}
          fit={isDst ? "contain" : "cover"}
          pad={isDst ? Math.round(size * 0.14) : 0}
          background={color ? `${color}1f` : "var(--ink-2)"}
        />
        {!isDst && normTeam(team) && (
          <span className="pbadge__crest" style={{ width: size * 0.44, height: size * 0.44 }}>
            <NflImage src={teamLogo(team)} alt={club?.name ?? ""} size={Math.round(size * 0.34)}
              radius="0" fit="contain" />
          </span>
        )}
      </span>

      <span className="pbadge__text">
        <span className="pbadge__name">{name}</span>
        <span className="pbadge__sub">
          {sub ?? <>{position ?? "—"} · {normTeam(team) ?? "FA"}</>}
        </span>
      </span>
    </Link>
  );
}
