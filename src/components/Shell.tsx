"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, CircleDollarSign, Crown, Home, LogOut, MessageCircle, Radio, Shield, Swords, Users,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { WireStatus } from "@/lib/live";
import { Seal } from "@/components/ui";

const NAV = [
  { href: "/",          label: "League",    Icon: Home },
  { href: "/matchups",  label: "Scores",    Icon: Radio },
  { href: "/chat",      label: "Chat",      Icon: MessageCircle },
  { href: "/challenges",label: "Challenges",Icon: CircleDollarSign },
  { href: "/draft",     label: "Draft",     Icon: Swords },
  { href: "/team",      label: "My Team",   Icon: Shield },
  { href: "/standings", label: "Standings", Icon: BarChart3 },
  { href: "/players",   label: "Players",   Icon: Users },
];

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

  const showAdmin = isCommissioner || !league?.commissioner_id;
  const items = showAdmin ? [...NAV, { href: "/admin", label: "Commish", Icon: Crown }] : NAV;

  return (
    <>
      <header className="topbar">
        <Link href="/" className="mark" aria-label="League home">
          <span className="mark__seal">MSS</span>
          <span className="mark__words">
            Main&nbsp;Street
            <br />
            Steakhouse
          </span>
        </Link>

        <nav className="nav">
          {items.map(({ href, label }) => (
            <Link key={href} href={href} className="nav__item" data-on={isOn(path, href)}>
              {label}
            </Link>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--s4)" }}>
          <Wire status={status} />
          {team && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
              <Seal name={team.name} mine size={28} />
              <span className="hide-sm" style={{ fontSize: "var(--t-small)", color: "var(--muted)" }}>
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
        {items.slice(0, 5).map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="tabbar__item" data-on={isOn(path, href)}>
            <Icon strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
