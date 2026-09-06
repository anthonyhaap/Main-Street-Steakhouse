"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Gavel, ScrollText, Users } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import type { WireStatus } from "@/lib/live";
import { DeskPanel } from "@/components/transactions/DeskPanel";
import { LedgerPanel } from "@/components/transactions/LedgerPanel";
import { PlayersPanel } from "@/components/transactions/PlayersPanel";
import { WirePanel } from "@/components/transactions/WirePanel";

/**
 * The transaction centre.
 *
 * Signing a man, claiming him off the wire, trading for him and reading what
 * happened were four destinations in the nav, which is four places to look for
 * one thing: how a roster changes. They were never independent — all three
 * moves start from the player pool, all three write the same rows to
 * `transactions`, and the ledger is the account of all three. So they are one
 * screen with four tabs, and the nav is three entries shorter.
 *
 * Only the open tab is mounted. That is deliberate: each panel opens its own
 * realtime channel and its own poll, and running four of those behind three
 * hidden tabs is four times the traffic for one screen anybody is reading.
 */
const TABS = [
  { key: "players", label: "Players", Icon: Users },
  { key: "waivers", label: "Waivers", Icon: Gavel },
  { key: "trades",  label: "Trades",  Icon: ArrowLeftRight },
  { key: "ledger",  label: "Ledger",  Icon: ScrollText },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const isTab = (v: string | null): v is TabKey => !!v && TABS.some((t) => t.key === v);

/** The strip, with nothing selected while the URL is still being read. */
function Tabs({ tab, onPick }: { tab?: TabKey; onPick?: (key: TabKey) => void }) {
  return (
    <div className="txn-head">
      <h1 className="txn-title">Transaction Center</h1>
      <div className="txn-tabs">
        <div className="segmented">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className="segmented__opt"
              data-on={tab === key}
              aria-pressed={tab === key}
              disabled={!onPick}
              onClick={() => onPick?.(key)}
            >
              <Icon size={13} strokeWidth={2} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TransactionCenter() {
  // The URL is the tab, so a refresh, a bookmark, a push notification and the
  // `next=` a sign-in carries back all land on the same one.
  const asked = useSearchParams().get("tab");
  const tab: TabKey = isTab(asked) ? asked : "players";
  const [status, setStatus] = useState<WireStatus | undefined>(undefined);

  /** Replaced rather than pushed: Back should leave the centre, not walk a
   *  manager out through every tab he touched on the way in. */
  const pick = useCallback((key: TabKey) => {
    setStatus(undefined);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <Tabs tab={tab} onPick={pick} />
        {tab === "players" && <PlayersPanel />}
        {tab === "waivers" && <WirePanel onStatus={setStatus} />}
        {tab === "trades" && <DeskPanel onStatus={setStatus} />}
        {tab === "ledger" && <LedgerPanel onStatus={setStatus} />}
      </main>
    </>
  );
}

export default function TransactionsPage() {
  // `useSearchParams` client-renders the tree it sits in, so the strip is the
  // fallback as well as the screen: the chrome is in the prerendered HTML and
  // only the panel waits.
  return (
    <Suspense
      fallback={
        <>
          <TopBar />
          <main className="page">
            <Tabs />
            <div className="card"><SkeletonRows n={8} /></div>
          </main>
        </>
      }
    >
      <TransactionCenter />
    </Suspense>
  );
}
