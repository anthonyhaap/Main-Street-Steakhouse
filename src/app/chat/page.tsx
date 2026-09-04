"use client";

import { FormEvent, useCallback, useState } from "react";
import Link from "next/link";
import { MessageCircle, Send } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeagueMessage, Matchup } from "@/lib/types";

/**
 * The clubhouse.
 *
 * It is no longer the only place a line can be said. A comment made on a
 * matchup card lands in this same table with a `matchup_id` on it, and the
 * room shows it — with the game it was said about, and a way back to it.
 *
 * That direction matters as much as the other one. Moving the argument onto
 * the scoreboard would be no improvement if it then vanished from the room
 * everyone reads; a league of twelve cannot afford a conversation only two
 * people ever see.
 */
type Room = { messages: LeagueMessage[]; matchups: Matchup[] };

export default function ChatPage() {
  const { ready, user, teams } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<Room> => {
    const supabase = supabaseBrowser();
    const [said, games] = await Promise.all([
      supabase.from("league_messages").select("*")
        .eq("league_id", LEAGUE_ID).order("created_at").limit(100),
      // Only to caption a matchup line; the scoreboard owns the real numbers.
      supabase.from("matchups").select("id,week,home_team_id,away_team_id")
        .eq("league_id", LEAGUE_ID),
    ]);
    if (said.error) throw said.error;
    return {
      messages: (said.data ?? []) as LeagueMessage[],
      matchups: (games.data ?? []) as Matchup[],
    };
  }, []);

  const { data, status, refetch } = useLive<Room>(fetcher, {
    tables: ["league_messages"], channel: "league-chat", pollMs: 30000, enabled: ready,
  });

  const nameOf = (id: string | null) =>
    teams.find((team) => team.owner_id === id)?.name ?? "League manager";
  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? "—";

  /** "Week 11 · Prime Cut vs Gridiron Butchers", and where to read it. */
  const gameOf = (matchupId: string | null) => {
    if (!matchupId) return null;
    const m = data?.matchups.find((x) => x.id === matchupId);
    if (!m) return null;
    return {
      label: `Week ${m.week} · ${teamName(m.away_team_id)} vs ${teamName(m.home_team_id)}`,
      href: `/matchups?week=${m.week}`,
    };
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabaseBrowser()
      .rpc("ff_send_message", { p_league_id: LEAGUE_ID, p_body: value });
    setBusy(false);
    if (sendError) return setError(sendError.message);
    setBody("");
    await refetch();
  }

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="mid">
        <header style={{ marginBottom: "var(--s5)" }}>
          <div className="eyebrow" data-tone="gold">League clubhouse</div>
          <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>
            Keep the group together.
          </h1>
          <p className="prose">
            Draft talk, matchup arguments, and the messages worth remembering. Anything
            said on a matchup card shows up here too, with the game it was said about.
          </p>
        </header>

        <section className="card">
          <div className="card__head">
            <h2>League chat</h2>
            <MessageCircle size={16} color="var(--gold)" />
          </div>

          {!data ? <SkeletonRows n={6} /> : (
            <div className="rows" style={{ maxHeight: "58vh", overflowY: "auto" }}>
              {data.messages.length === 0 && (
                <div className="empty">No messages yet.<br />Start the season&apos;s first argument.</div>
              )}
              {data.messages.map((message) => {
                const game = gameOf(message.matchup_id);
                return (
                  <div className="row" key={message.id} data-mine={message.author_id === user?.id}
                    data-kind={message.kind} style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="eyebrow" style={{ marginBottom: 5 }}>
                        {message.kind === "house" ? "The House"
                          : message.author_id === user?.id ? "You"
                          : nameOf(message.author_id)}
                      </div>
                      <div className="chat__body">{message.body}</div>
                      {game && (
                        <Link href={game.href} className="chat__on">
                          <MessageCircle size={11} /> on {game.label}
                        </Link>
                      )}
                    </div>
                    <time className="num" style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
                      {stamp(message.created_at)}
                    </time>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={send} style={{ display: "flex", gap: "var(--s2)", padding: "var(--s4)", borderTop: "1px solid var(--rule)" }}>
            <input className="field" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Message the league…" aria-label="Message the league" />
            <button className="btn" data-v="primary" data-size="icon" disabled={busy || !body.trim()} aria-label="Send message">
              <Send size={16} />
            </button>
          </form>

          {error && <p role="alert" style={{ color: "var(--lose)", padding: "0 var(--s4) var(--s4)", margin: 0 }}>{error}</p>}
        </section>
      </main>
    </>
  );
}

function stamp(value: string) {
  const d = new Date(value);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} `
    + `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}
