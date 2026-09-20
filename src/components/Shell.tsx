"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, BarChart3, ChevronDown, CircleDollarSign, Crown, Landmark, LogOut, Megaphone, MessageCircle, MoreHorizontal, Newspaper, Radio, Shield, Smartphone, Swords, Target, UtensilsCrossed, X } from "lucide-react";
import { useStandalone } from "@/lib/install";
import { useCrests, useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { WireStatus } from "@/lib/live";
import { useUnreadCounts } from "@/lib/unread";
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
 *
 * Players, Waivers, Trades and Ledger used to be four entries here. They are
 * four views of one question — how a roster changes — so they are one
 * destination, Transactions, and the tabs inside it.
 *
 * Draft, History, Chat, the League Feed and Recap used to be four more
 * entries here (Chat and the League Feed were one, "The House", until it
 * split — see git history). Unlike Transactions they are not one question —
 * a live draft board, a standings archive, the room people talk in, the
 * record of what happened, and a weekly recap have nothing in common
 * structurally — so they stay separate pages rather than merging into one.
 * What they share is that none of them is a destination you reach for
 * outside league business, so they hang off the League page as a dropdown
 * (desktop) or a grouped section of the More sheet (phone) instead of each
 * claiming a slot of their own in the bar.
 */
type NavItem = {
  href: string;
  label: string;
  Icon: typeof UtensilsCrossed;
  /** Set apart in the bar: the commissioner's room, not a manager's. */
  commish?: boolean;
  /** Which of ff_unread_counts' fields this item's badge reads, if any. */
  badge?: "chat" | "league_feed";
};

const NAV: NavItem[] = [
  { href: "/",             label: "Tonight",      Icon: UtensilsCrossed },
  { href: "/matchups",     label: "Matchups",     Icon: Radio },
  { href: "/team",         label: "My Team",      Icon: Shield },
  { href: "/standings",    label: "Standings",    Icon: BarChart3 },
  { href: "/pickem",       label: "Pick'em",      Icon: Target },
  { href: "/transactions", label: "Transactions", Icon: ArrowLeftRight },
  { href: "/challenges",   label: "Challenges",   Icon: CircleDollarSign },
];

/** The league's own history and rituals, grouped under the League page. */
const LEAGUE_PAGES: NavItem[] = [
  { href: "/draft",       label: "Draft",       Icon: Swords },
  { href: "/history",     label: "History",     Icon: Landmark },
  { href: "/chat",        label: "Chat",        Icon: MessageCircle, badge: "chat" },
  { href: "/league-feed", label: "League Feed", Icon: Megaphone,     badge: "league_feed" },
  { href: "/recap",       label: "Recap",       Icon: Newspaper },
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

/**
 * The League nav item's own dropdown: the hub plus its four grouped pages.
 *
 * This is a disclosure, not an ARIA menu — it doesn't own arrow-key or
 * Home/End navigation between its links, so it doesn't claim `role="menu"`.
 * The links inside are ordinary tab stops, and Escape both closes the panel
 * and gives focus back to the trigger that opened it.
 */
/** A small red count, capped at 99+, for a nav item that tracks unread. */
function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="nav__badge">{n > 99 ? "99+" : n}</span>;
}

function LeagueMenu({ path, counts }: { path: string; counts?: { chat: number; league_feed: number } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = isOn(path, "/league") || LEAGUE_PAGES.some((i) => isOn(path, i.href));

  const close = () => setOpen(false);
  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAndRefocus();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="nav__dropdown" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="nav__item nav__dropdown-trigger"
        data-on={active}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        League
        <ChevronDown size={13} strokeWidth={2.5} aria-hidden />
      </button>
      {open && (
        <div className="nav__dropdown-panel">
          <Link href="/league" className="nav__dropdown-item" data-on={isOn(path, "/league")} onClick={close}>
            <Crown size={14} strokeWidth={1.75} aria-hidden />
            League Home
          </Link>
          {LEAGUE_PAGES.map(({ href, label, Icon, badge }) => (
            <Link key={href} href={href} className="nav__dropdown-item" data-on={isOn(path, href)} onClick={close}>
              <Icon size={14} strokeWidth={1.75} aria-hidden />
              {label}
              {badge && <Badge n={counts?.[badge]} />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ status }: { status?: WireStatus }) {
  const path = usePathname();
  const router = useRouter();
  const { team, league, isCommissioner } = useSession();
  const crestOf = useCrests();
  const [more, setMore] = useState(false);
  const standalone = useStandalone();
  const close = () => setMore(false);
  const counts = useUnreadCounts();

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
  const restActive = rest.some((i) => isOn(path, i.href)) || LEAGUE_PAGES.some((i) => isOn(path, i.href));
  // The sheet groups Draft/History/The House/Recap under their own "League"
  // heading rather than listing League itself as one more flat tile.
  const sheetRest = rest.filter((i) => i.href !== "/league");

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
          {items.map(({ href, label, commish }) =>
            href === "/league" ? (
              <LeagueMenu key={href} path={path} counts={counts ?? undefined} />
            ) : (
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
            )
          )}
        </nav>

        <div className="topbar__actions">
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
              // A full document load, deliberately, and not router.push(). This
              // is the one navigation in the app whose job is to destroy state:
              // the session context, every cached league read, and whatever the
              // last screen still holds about eleven other managers. A client
              // navigation keeps all of it alive in memory on a shared laptop,
              // which is the exact thing signing out is for.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
            <span>{label}</span>
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
          <span>More</span>
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
            <div className="sheet__section">
              <span className="sheet__section-label">League</span>
              <div className="sheet__grid">
                <Link href="/league" className="qa__btn" data-on={isOn(path, "/league")} onClick={close}>
                  <Crown strokeWidth={1.75} />
                  League Home
                </Link>
                {LEAGUE_PAGES.map(({ href, label, Icon, badge }) => (
                  <Link key={href} href={href} className="qa__btn" data-on={isOn(path, href)} onClick={close}>
                    <Icon strokeWidth={1.75} />
                    {label}
                    {badge && <Badge n={counts?.[badge]} />}
                  </Link>
                ))}
              </div>
            </div>
            <div className="sheet__grid">
              {sheetRest.map(({ href, label, Icon }) => (
                <Link key={href} href={href} className="qa__btn" data-on={isOn(path, href)} onClick={close}>
                  <Icon strokeWidth={1.75} />
                  {label}
                </Link>
              ))}
              {/* The way back to the two taps the first-visit nudge showed once.
                  Gone in the installed app, where it would be advice already taken. */}
              {!standalone && (
                <Link href="/install" className="qa__btn" data-on={isOn(path, "/install")} onClick={close}>
                  <Smartphone strokeWidth={1.75} />
                  Install the app
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* The League item's own dropdown, desktop nav only (.nav hides below
           1180px, where the sheet's grouped section below takes over). */
        .nav__dropdown { position: relative; display: inline-flex; }
        .nav__dropdown-trigger {
          display: inline-flex; align-items: center; gap: 4px;
          border: 0; background: none; cursor: pointer; font: inherit;
        }
        .nav__dropdown-trigger svg { transition: transform 0.18s var(--ease); }
        .nav__dropdown-trigger[aria-expanded="true"] svg { transform: rotate(180deg); }
        .nav__dropdown-panel {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 70;
          min-width: 180px;
          display: grid; gap: 2px;
          padding: 6px;
          background: var(--ink-1);
          border: 1px solid var(--rule-soft);
          border-radius: var(--r-sm);
          box-shadow: var(--shadow-2);
          animation: dropdown-in .16s var(--ease);
        }
        .nav__dropdown-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px;
          border-radius: var(--r-sm);
          font: 600 var(--t-small)/1 var(--sans);
          color: var(--muted);
          text-decoration: none;
          white-space: nowrap;
        }
        .nav__dropdown-item svg { color: var(--wine); flex-shrink: 0; }

        /* Unread count on a League Feed / Chat entry, wherever it appears —
           the dropdown, the phone sheet. */
        .nav__badge {
          margin-left: auto;
          padding: 1px 6px;
          border-radius: 999px;
          background: var(--wine);
          color: var(--cream);
          font: 700 var(--t-nano)/1.6 var(--sans);
        }
        .nav__dropdown-item:hover { color: var(--cream); background: #1b18140a; }
        .nav__dropdown-item[data-on="true"] { color: var(--wine); background: var(--wine-wash); }
        @keyframes dropdown-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

        /* The sheet's own grouping for the same pages, phone-width equivalent
           of the dropdown above. */
        .sheet__section-label {
          display: block;
          padding: var(--s4) var(--s5) 0;
          font: 700 var(--t-nano)/1 var(--sans);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .sheet__section .sheet__grid { padding-top: var(--s2); }
        .sheet__section + .sheet__grid {
          padding-top: var(--s2);
          margin-top: var(--s2);
          border-top: 1px solid var(--rule-soft);
        }

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
          /* dvh, not vh, same reason as .modal__panel: this sits on a fixed,
             inset:0 overlay, so it's the visible viewport that must bound it.
             A grouped League section plus every other tile can outgrow a
             short phone screen, and the sheet has no other way back up. */
          max-height: 85dvh;
          overflow-y: auto;
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
