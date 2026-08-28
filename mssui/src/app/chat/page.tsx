"use client";

import { FormEvent, useCallback, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeagueMessage } from "@/lib/types";

export default function ChatPage() {
  const { ready, user, teams } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useCallback(async () => {
    const { data, error: readError } = await supabaseBrowser().from("league_messages").select("*")
      .eq("league_id", LEAGUE_ID).order("created_at").limit(100);
    if (readError) throw readError;
    return (data ?? []) as LeagueMessage[];
  }, []);
  const { data, status, refetch } = useLive(fetcher, { tables: ["league_messages"], channel: "league-chat", pollMs: 30000, enabled: ready });
  const nameOf = (id: string) => teams.find((team) => team.owner_id === id)?.name ?? "League manager";

  async function send(event: FormEvent) {
    event.preventDefault(); const value = body.trim(); if (!value || busy) return;
    setBusy(true); setError(null);
    const { error: sendError } = await supabaseBrowser().rpc("ff_send_message", { p_league_id: LEAGUE_ID, p_body: value });
    setBusy(false);
    if (sendError) return setError(sendError.message);
    setBody(""); await refetch();
  }

  return <><TopBar status={status}/><main className="page" data-width="mid">
    <header style={{ marginBottom: "var(--s5)" }}><div className="eyebrow" data-tone="gold">LEAGUE CLUBHOUSE</div><h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>Keep the group together.</h1><p className="prose">Draft talk, matchup arguments, and the messages worth remembering.</p></header>
    <section className="card"><div className="card__head"><h2>League chat</h2><MessageCircle size={16} color="var(--gold)"/></div>
      {!data ? <SkeletonRows n={6}/> : <div className="rows" style={{ maxHeight: "58vh", overflowY: "auto" }}>{data.length === 0 && <div className="empty">No messages yet.<br/>Start the season&apos;s first argument.</div>}{data.map((message) => <div className="row" key={message.id} data-mine={message.author_id === user?.id} style={{ alignItems: "flex-start" }}><div style={{ flex: 1 }}><div className="eyebrow" style={{ marginBottom: 5 }}>{message.author_id === user?.id ? "You" : nameOf(message.author_id)}</div><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.body}</div></div><time className="num" style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>{stamp(message.created_at)}</time></div>)}</div>}
      <form onSubmit={send} style={{ display: "flex", gap: "var(--s2)", padding: "var(--s4)", borderTop: "1px solid var(--rule)" }}><input className="field" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the league…" aria-label="Message the league"/><button className="btn" data-v="primary" data-size="icon" disabled={busy || !body.trim()} aria-label="Send message"><Send size={16}/></button></form>
      {error && <p role="alert" style={{ color: "var(--lose)", padding: "0 var(--s4) var(--s4)", margin: 0 }}>{error}</p>}
    </section>
  </main></>;
}
function stamp(value:string){const d=new Date(value);return `${String(d.getUTCMonth()+1).padStart(2,"0")}/${String(d.getUTCDate()).padStart(2,"0")} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}Z`}
