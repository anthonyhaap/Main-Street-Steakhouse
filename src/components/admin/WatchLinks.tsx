"use client";

import { useCallback, useState } from "react";
import { Copy, Eye, Plus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { useToast } from "@/components/ui";

type WatchLink = {
  id: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  live: boolean;
  visitors: number;
};

const LENGTHS: { days: number | null; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: null, label: "Until revoked" },
];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function status(l: WatchLink): string {
  if (l.revoked_at) return `Switched off ${day(l.revoked_at)}`;
  if (!l.live) return `Expired ${l.expires_at ? day(l.expires_at) : ""}`.trim();
  const until = l.expires_at ? `until ${day(l.expires_at)}` : "until revoked";
  const seen = l.visitors === 1 ? "1 visitor" : `${l.visitors} visitors`;
  return `Live ${until} · ${seen}`;
}

/**
 * View-only links: somebody can look around the whole league without an
 * account, and can change nothing.
 *
 * The link is shown once, when it is made. Only a hash of it is kept, so a
 * lost link is replaced rather than looked up again. Switching one off signs
 * out everyone who came in through it on their next page.
 *
 * Link visitors do not see Chat or table talk. The database enforces that and
 * the read-only part (20261030140000); this card only hands the links out.
 */
export function WatchLinks() {
  const toast = useToast();
  const { ready } = useSession();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<WatchLink[]> => {
    const { data, error } = await supabaseBrowser().rpc("ff_watch_links", { p_league_id: LEAGUE_ID });
    if (error) throw new Error(error.message);
    return (data ?? []) as WatchLink[];
  }, []);
  const { data: links, refetch } = useLive<WatchLink[]>(fetcher, {
    tables: [], channel: "watch-links", pollMs: 0, enabled: ready,
  });

  async function create() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("ff_create_watch_link", {
      p_league_id: LEAGUE_ID, p_label: label.trim() || null, p_days: days,
    });
    setBusy(false);
    if (error) { toast("error", error.message); return; }
    setFresh(`${window.location.origin}/watch/${data as string}`);
    setLabel("");
    void refetch();
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      toast("ok", "Link copied.");
    } catch {
      toast("error", "Couldn't copy. Select the link and copy it by hand.");
    }
  }

  async function revoke(link: WatchLink) {
    const name = link.label ?? "this link";
    if (!window.confirm(`Switch off ${name}? Anyone using it is signed out.`)) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("ff_revoke_watch_link", { p_link_id: link.id });
    setBusy(false);
    if (error) { toast("error", error.message); return; }
    toast("ok", "Link switched off.");
    void refetch();
  }

  return (
    <div className="card__body" style={{ display: "grid", gap: "var(--s4)" }}>
      <p className="prose" style={{ margin: 0, fontSize: "var(--t-small)" }}>
        Anyone with one of these links can look around the league without an account: standings,
        matchups, rosters, the League Feed. They can&apos;t change anything, and they don&apos;t see Chat.
      </p>

      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="field"
          style={{ flex: "1 1 180px", minWidth: 0 }}
          placeholder="Who it's for (optional)"
          aria-label="Who the link is for"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className="field"
          style={{ flex: "0 0 auto", width: "auto" }}
          aria-label="How long the link lasts"
          value={days ?? ""}
          onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
        >
          {LENGTHS.map((l) => <option key={l.label} value={l.days ?? ""}>{l.label}</option>)}
        </select>
        <button className="btn" data-v="primary" disabled={busy} onClick={create}>
          <Plus size={14} /> Make a link
        </button>
      </div>

      {fresh && (
        <div className="note" style={{ borderRadius: "var(--r-sm)", display: "grid", gap: "var(--s2)" }}>
          <strong>Copy it now. It won&apos;t be shown again.</strong>
          <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", minWidth: 0 }}>
            <code style={{ overflowWrap: "anywhere", flex: 1, minWidth: 0, userSelect: "all" }}>{fresh}</code>
            <button className="btn" data-size="sm" onClick={copy}><Copy size={13} /> Copy</button>
          </div>
        </div>
      )}

      {links && links.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--s2)" }}>
          {links.map((l) => (
            <li key={l.id} style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
              <Eye size={15} color={l.live ? "var(--gold)" : "var(--dim)"} aria-hidden style={{ flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.label ?? "Unnamed link"}</div>
                <div className="eyebrow" style={{ marginTop: 2 }}>{status(l)}</div>
              </div>
              {l.live && (
                <button className="btn" data-v="ghost" data-size="sm" disabled={busy} onClick={() => revoke(l)}>
                  Switch off
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
