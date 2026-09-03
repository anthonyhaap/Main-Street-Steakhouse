"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, CircleDollarSign, Crown, Home, LogOut, MessageCircle, MoreHorizontal,
  Radio, Shield, Swords, Users, X,
} from "lucide-react";
import { useCrests, useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { WireStatus } from "@/lib/live";
import { Seal } from "@/components/ui";

const NAV = [
  { href: "/",           label: "League",     Icon: Home },
  { href: "/draft",      label: "Draft",      Icon: Swords },
  { href: "/matchups",   label: "Scores",     Icon: Radio },
  { href: "/team",       label: "My Team",    Icon: Shield },
  { href: "/standings",  label: "Standings",  Icon: BarChart3 },
  { href: "/players",    label: "Players",    Icon: Users },
  { href: "/chat",       label: "Chat",       Icon: MessageCircle },
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

export function TopBar({ status }: { status?: WireStatus }) {
  const path = usePathname();
  const { team, league, isCommissioner } = useSession();
  const crestOf = useCrests();
  const [more, setMore] = useState(false);
  const close = () => setMore(false);

  const showAdmin = isCommissioner || !league?.commissioner_id;
  const items = showAdmin ? [...NAV, { href: "/admin", label: "Commish", Icon: Crown }] : NAV;
  const tabs = items.slice(0, TAB_COUNT);
  const rest = items.slice(TAB_COUNT);
  const restActive = rest.some((i) => isOn(path, i.href));

  return (
    <>
      <header className="topbar">
        <Link href="/" className="mark" aria-label="Main Street Steakhouse — league home">
          {/* Both cut from the same outlines as /logo-full.svg, so the header
              and the badge can't drift apart. Phones get the mark alone. */}
          <Image className="mark__lockup" src="/logo-lockup.svg" alt="" width={248} height={40} priority />
          <Image className="mark__seal" src="/mark.svg" alt="" width={64} height={64} priority />
        </Link>

        <nav className="nav" aria-label="Primary">
          {items.map(({ href, label }) => (
            <Link key={href} href={href} className="nav__item" data-on={isOn(path, href)}>
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
          <Link key={href} href={href} className="tabbar__item" data-on={isOn(path, href)} onClick={close}>
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
