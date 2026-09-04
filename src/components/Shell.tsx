"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  BarChart3, CircleDollarSign, Crown, Landmark, LogOut, MessageCircle, MoreHorizontal,
  Radio, Shield, Swords, Users, UtensilsCrossed, X,
} from "lucide-react";
import { useCrests, useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { WireStatus } from "@/lib/live";
import { Seal } from "@/components/ui";

/**
 * The first four are the tab bar on a phone, in thumb order: the briefing,
 * the scores, your lineup, the table. Everything else is one tap further.
 *
 * Two names were doing two jobs each. "Scores" is the week's matchups, and
 * calling it Scores made it read as a results page rather than the screen
 * you watch — the tab is Matchups. And the room is called the Clubhouse
 * everywhere in the app except the tab that opens it, which said Chat; a
 * product with two names for one place has neither.
 */
type NavItem = {
  href: string;
  label: string;
  Icon: typeof UtensilsCrossed;
  /** Set apart in the bar: the commissioner's room, not a manager's. */
  commish?: boolean;
};

const NAV: NavItem[] = [
  { href: "/",           label: "Tonight",    Icon: UtensilsCrossed },
  { href: "/matchups",   label: "Matchups",   Icon: Radio },
  { href: "/team",       label: "My Team",    Icon: Shield },
  { href: "/standings",  label: "Standings",  Icon: BarChart3 },
  { href: "/draft",      label: "Draft",      Icon: Swords },
  { href: "/history",    label: "History",    Icon: Landmark },
  { href: "/players",    label: "Players",    Icon: Users },
  { href: "/chat",       label: "Clubhouse",  Icon: MessageCircle },
  { href: "/challenges", label: "Challenges", Icon: CircleDollarSign },
];

/** Four thumb-reachable tabs; everything else lives behind More. */
const TAB_COUNT = 4;

const isOn = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

export function Wire({ status }: { status?: WireStatus }) {
  if (!status) return null;
  const label = status === "live" ? "Live" : status === "stale" ? "Reconnecting" : "Syncing";
  return (
    <div className="wire" data-state={status} title={`Realtime: ${label}`}>
      <i className="wire__dot" />
      <span>{label}</span>
    </div>
  );
}

/** The crest and wordmark, rebuilt from the logo so it stays crisp at 38px. */
export function Crest({ size = 38 }: { size?: number }) {
  return (
    <span className="mark__seal" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" fill="none" aria-hidden focusable="false">
        <circle cx="32" cy="32" r="28.5" stroke="var(--gold-lit)" strokeWidth="3" />
        <ellipse cx="32" cy="21" rx="8.5" ry="2.6" stroke="var(--cream)" strokeWidth="2.4" />
        <path d="M32 22.5V45" stroke="var(--cream)" strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="32" cy="45.5" rx="13" ry="3.4" stroke="var(--cream)" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

export function TopBar({ status }: { status?: WireStatus }) {
  const path = usePathname();
  const router = useRouter();
  const { team, league, isCommissioner } = useSession();
  const crestOf = useCrests();
  const [more, setMore] = useState(false);
  const close = () => setMore(false);

  // Commish tools are not an everyday manager destination, and sitting them at
  // the same weight as My Team told eleven people to read past that whole end
  // of the bar. The room keeps its place and loses its equality: a rule before
  // it, and the crown that says whose it is.
  const showAdmin = isCommissioner || !league?.commissioner_id;
  const items: NavItem[] = [
    ...NAV,
    { href: "/league", label: "League", Icon: Crown },
    ...(showAdmin ? [{ href: "/admin", label: "Commish", Icon: Crown, commish: true }] : []),
  ];
  const tabs = items.slice(0, TAB_COUNT);
  const rest = items.slice(TAB_COUNT);
  const restActive = rest.some((i) => isOn(path, i.href));

  return (
    <>
      <header className="topbar">
        <Link href="/" className="mark" aria-label="Main Street Steakhouse — league home">
          <Crest />
          <span className="mark__words">
            <b>Main Street</b>
            <i>Steakhouse</i>
          </span>
        </Link>

        <nav className="nav" aria-label="Primary">
          {items.map(({ href, label, commish }) => (
            <Link
              key={href}
              href={href}
              className="nav__item"
              data-on={isOn(path, href)}
              data-role={commish ? "commish" : undefined}
            >
              {commish && <Crown size={12} aria-hidden />}
              {label}
            </Link>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--s3)" }}>
          <Wire status={status} />
          {team && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
              <Seal name={team.name} src={crestOf(team.id)} mine size={30} />
              <span className="hide-sm" style={{ fontSize: "var(--t-small)", color: "var(--muted)", fontWeight: 600 }}>
                {team.name}
              </span>
            </div>
          )}
          <button
            className="btn"
            data-v="ghost"
            data-size="icon"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <nav className="tabbar" aria-label="Primary">
        {tabs.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="tabbar__item"
            data-on={isOn(path, href)}
            onClick={close}
            // The next screen starts loading on the touch, not the tap.
            onTouchStart={() => router.prefetch(href)}
          >
            <Icon strokeWidth={1.75} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          className="tabbar__item"
          data-on={more || restActive}
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          style={{ border: 0, background: "none", cursor: "pointer", font: "inherit" }}
        >
          <MoreHorizontal strokeWidth={1.75} />
          More
        </button>
      </nav>

      {more && (
        <div className="sheet" role="dialog" aria-label="More pages" onClick={close}>
          <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head">
              <span className="eyebrow">Everything else</span>
              <button className="btn" data-v="ghost" data-size="icon" aria-label="Close" onClick={close}>
                <X size={16} />
              </button>
            </div>
            <div className="sheet__grid">
              {rest.map(({ href, label, Icon }) => (
                <Link key={href} href={href} className="qa__btn" data-on={isOn(path, href)} onClick={close}>
                  <Icon strokeWidth={1.75} />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* Below the tab bar (z 60) on purpose: the tabs stay visible and
           tappable while the sheet is open, so More is a toggle, not a trap. */
        .sheet {
          position: fixed; inset: 0; z-index: 55;
          display: flex; align-items: flex-end;
          background: #1b181459;
          backdrop-filter: blur(3px);
          animation: sheet-fade .18s var(--ease);
        }
        .sheet__panel {
          width: 100%;
          background: var(--ink-1);
          border-top: 3px solid var(--gold-lit);
          border-radius: var(--r-lg) var(--r-lg) 0 0;
          box-shadow: var(--shadow-3);
          padding-bottom: calc(var(--bottom-nav) + env(safe-area-inset-bottom));
          animation: sheet-up .24s var(--ease);
        }
        .sheet__head {
          display: flex; align-items: center; justify-content: space-between;
          padding: var(--s4) var(--s5);
          border-bottom: 1px solid var(--rule-soft);
        }
        .sheet__grid {
          display: grid; gap: var(--s2);
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
          padding: var(--s4) var(--s5) var(--s5);
        }
        .sheet__grid .qa__btn[data-on="true"] {
          border-color: var(--gold-lit); background: var(--gold-haze); color: var(--wine);
        }
        @keyframes sheet-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sheet-up { from { transform: translateY(14px) } to { transform: none } }
      `}</style>
    </>
  );
}
