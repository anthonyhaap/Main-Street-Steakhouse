"use client";

import { useCallback, useState } from "react";
import { Link2, LogOut, Send, UserMinus, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useToast } from "@/components/ui";
import type { TeamSeats } from "@/lib/types";

/**
 * Who sits at this seat, and the door for letting somebody else in.
 *
 * The manager and the commissioner see the whole picture — the co-owners, the
 * invites still out, and the form to send another — and may remove anyone. A
 * co-owner sees the same list and one button, to leave. Everybody else in the
 * league sees the names and nothing to press; the addresses on outstanding
 * invites never reach them, because `ff_team_seats` leaves them out rather
 * than trusting this component to.
 *
 * Sending an invite goes through /api/invite/co-owner rather than an RPC,
 * because the link has to be mailed, and the mail credentials live on the
 * server. When the mail cannot go, the link comes back and lands on the
 * clipboard instead — the same fallback the commissioner's invite has.
 */
export function CoOwners({ teamId, onChanged }: {
  teamId: string;
  /** Called when the caller's own seat changed hands — after leaving — so the
      session can be reloaded by whoever mounted this. */
  onChanged?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_team_seats", { p_team_id: teamId });
    if (error) throw new Error(error.message);
    return data as TeamSeats;
  }, [teamId]);

  const { data: seats, refetch } = useLive<TeamSeats>(fetcher, {
    tables: ["team_co_owners"],
    channel: `seats-${teamId}`,
    pollMs: 0,
  });

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    try {
      const res = await fetch("/api/invite/co-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, email: addr }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("ok", `Invite sent to ${json.sentTo}.`);
        setEmail("");
      } else {
        toast("error", json.error ?? "Couldn't send the invite.");
        if (json.joinUrl) {
          try {
            await navigator.clipboard.writeText(json.joinUrl);
            toast("info", "Invite link copied to your clipboard instead — send it yourself.");
            setEmail("");
          } catch { /* clipboard denied — the error toast already explains */ }
        }
      }
    } catch {
      toast("error", "Network error sending the invite.");
    } finally {
      setBusy(false);
      await refetch();
    }
  }

  async function cancel(id: string, addr: string) {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("ff_cancel_co_owner_invite", { p_invite_id: id });
    setBusy(false);
    if (error) toast("error", error.message);
    else toast("ok", `Withdrew the invite to ${addr}.`);
    await refetch();
  }

  async function remove(userId: string, name: string | null, me: boolean) {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("ff_remove_co_owner", {
      p_team_id: teamId, p_user_id: userId,
    });
    setBusy(false);
    if (error) return toast("error", error.message);
    toast("ok", me ? "You've left the team." : `${name ?? "The co-owner"} is off the team.`);
    await refetch();
    if (me) await onChanged?.();
  }

  if (!seats) return null;

  const rows = [
    ...(seats.owner ? [{ ...seats.owner, role: "Manager" as const }] : []),
    ...seats.co_owners.map((c) => ({ ...c, role: "Co-owner" as const })),
  ];

  return (
    <div style={{ display: "grid", gap: "var(--s3)" }}>
      <div>
        <div className="eyebrow">Who runs this team</div>
        <div style={{ fontSize: "var(--t-micro)", color: "var(--dim)", marginTop: 5, lineHeight: 1.5 }}>
          A co-owner drafts, sets the lineup, works the wire and talks in the house
          as this team. {seats.can_manage ? "Up to three, and you can show anyone the door." : ""}
        </div>
      </div>

      <div className="rows" style={{ border: "1px solid var(--rule)", borderRadius: 10 }}>
        {rows.map((r) => (
          <div className="row" key={r.user_id} style={{ alignItems: "center", gap: "var(--s3)" }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: "var(--t-small)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name ?? (r.role === "Manager" ? "The manager" : "A co-owner")}
              {r.me && <span style={{ color: "var(--dim)", fontWeight: 400 }}> · you</span>}
            </span>
            <span className="eyebrow" style={{ color: r.role === "Manager" ? "var(--gold)" : "var(--dim)" }}>{r.role}</span>
            {r.role === "Co-owner" && (seats.can_manage || r.me) && (
              <button className="btn" data-v="ghost" data-size="sm" disabled={busy}
                onClick={() => void remove(r.user_id, r.name, r.me)}
                title={r.me ? "Leave this team" : "Remove this co-owner"}>
                {r.me ? <LogOut size={13} /> : <UserMinus size={13} />} {r.me ? "Leave" : "Remove"}
              </button>
            )}
          </div>
        ))}

        {seats.invites.map((i) => (
          <div className="row" key={i.id} style={{ alignItems: "center", gap: "var(--s3)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: "var(--t-small)", color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {i.email}
            </span>
            <span className="eyebrow" style={{ color: "var(--faint)" }}>Invited</span>
            <button className="btn" data-v="ghost" data-size="sm" disabled={busy}
              onClick={() => void cancel(i.id, i.email)} title="Withdraw this invite">
              <X size={13} /> Withdraw
            </button>
          </div>
        ))}

        {rows.length === 0 && seats.invites.length === 0 && (
          <div className="empty" style={{ padding: "var(--s4)" }}>Nobody has claimed this team yet.</div>
        )}
      </div>

      {seats.can_manage && (
        <form onSubmit={invite} style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          <input
            className="field"
            type="email"
            required
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="co-owner@email.com"
            aria-label="Co-owner's email"
            style={{ flex: "1 1 200px", minWidth: 0 }}
          />
          <button className="btn" data-size="sm" disabled={busy || !email.trim()} title="Email them a link to this seat">
            {busy ? <Link2 size={14} /> : <Send size={14} />} {busy ? "Sending" : "Invite a co-owner"}
          </button>
        </form>
      )}
    </div>
  );
}
