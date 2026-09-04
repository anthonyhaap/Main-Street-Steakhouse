"use client";

/**
 * Table talk — the argument, on the game it is about.
 *
 * The clubhouse is a room people have to remember to visit, and a league's
 * best lines are not said there; they are said at four o'clock, at the score,
 * about one game. `league_messages.matchup_id` has been on the table since the
 * clubhouse was built and nothing ever wrote to it. This is what writes to it.
 *
 * Two components, on purpose:
 *
 *   `TalkThread` is pure — messages in, markup out, `onSend` optional. That is
 *   what lets `/preview/matchups` render a real argument from a fixture with
 *   no session and no database, and what lets a test assert it.
 *
 *   `MatchupTalk` is the live one: it fetches the thread when somebody opens
 *   it, keeps it under the same realtime contract as everything else, and
 *   posts through `ff_send_matchup_message`.
 *
 * The thread is not fetched until it is opened. A closed card carries only the
 * count and the last line, which `ff_scoreboard` already returns — six threads
 * polled every fifteen seconds through a Sunday would be six times the traffic
 * for a screen nobody is reading.
 */

import { FormEvent, useCallback, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { crestUrl } from "@/lib/crest";
import { Seal } from "@/components/ui";
import { freshness, talkTeaser, type MatchupThread, type ScoreCard, type ThreadMessage } from "@/lib/scoreboard";

/* ---------------------------------------------------------------- the pure -- */

export function TalkThread({
  messages, now, busy = false, error = null, onSend, emptyLine = "Nobody has said anything yet.",
}: {
  messages: ThreadMessage[];
  now: number;
  busy?: boolean;
  error?: string | null;
  /** Omitted for a read-only thread — the fixture, or a signed-out reader. */
  onSend?: (body: string) => void | Promise<void>;
  emptyLine?: string;
}) {
  const [body, setBody] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = body.trim();
    if (!value || busy || !onSend) return;
    // Cleared here rather than after the await: the send is optimistic about
    // the input, never about the message. A failure puts the error under the
    // box, and the text is still in the browser's undo.
    setBody("");
    await onSend(value);
  }

  return (
    <div className="talk">
      {messages.length === 0 && <p className="talk__empty">{emptyLine}</p>}

      {messages.length > 0 && (
        <ol className="talk__list">
          {messages.map((m) => (
            <li className="talk__msg" key={m.id} data-mine={m.mine} data-side={m.side ?? undefined}>
              <Seal name={m.author_name} src={crestUrl(m.author_logo)} mine={m.mine} size={24} />
              <div className="talk__body">
                <span className="talk__who">
                  <b>{m.mine ? "You" : m.author_manager || m.author_name}</b>
                  {m.side && <i className="talk__side">{m.side === "home" ? "home" : "away"}</i>}
                  <time dateTime={m.created_at}>{freshness(m.created_at, now)}</time>
                </span>
                <p>{m.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {onSend && (
        <form className="talk__form" onSubmit={submit}>
          <input
            className="field"
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say it to their face…"
            aria-label="Say something about this matchup"
          />
          <button
            className="btn"
            data-v="primary"
            data-size="icon"
            disabled={busy || !body.trim()}
            aria-label="Send"
          >
            <Send size={15} />
          </button>
        </form>
      )}

      {error && <p className="talk__error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- the live -- */

export function MatchupTalk({ card, now, onPosted }: {
  card: ScoreCard;
  now: number;
  /** Nudges the board so the closed card's count catches up with the thread. */
  onPosted?: () => void;
}) {
  const { ready, user } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="sb__talk">
      <button
        className="sb__talk-open"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <MessageCircle size={14} />
        <span className="sb__talk-label">Table talk</span>
        {card.talk?.count > 0 && <span className="sb__talk-n">{card.talk.count}</span>}
        <span className="sb__talk-teaser">{talkTeaser(card.talk)}</span>
      </button>

      {open && <Live card={card} now={now} enabled={ready} signedIn={!!user} onPosted={onPosted} />}
    </div>
  );
}

/**
 * Split out so the fetch and its subscription are mounted by opening the
 * thread and torn down by closing it — the hook cannot be called conditionally
 * in the component above.
 */
function Live({ card, now, enabled, signedIn, onPosted }: {
  card: ScoreCard; now: number; enabled: boolean; signedIn: boolean; onPosted?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<MatchupThread> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_matchup_thread", { p_matchup_id: card.id });
    if (error) throw new Error(error.message);
    return data as MatchupThread;
  }, [card.id]);

  const { data, error, refetch } = useLive<MatchupThread>(fetcher, {
    tables: ["league_messages"],
    channel: `talk-${card.id}`,
    pollMs: 30000,
    enabled,
  });

  const send = useCallback(async (body: string) => {
    setBusy(true);
    setSendError(null);
    const { error: err } = await supabaseBrowser()
      .rpc("ff_send_matchup_message", { p_matchup_id: card.id, p_body: body });
    setBusy(false);
    if (err) {
      setSendError(err.message);
      return;
    }
    await refetch();
    onPosted?.();
  }, [card.id, refetch, onPosted]);

  if (!data && error) return <p className="talk__error" role="alert">{error}</p>;
  if (!data) return <p className="talk__empty">Opening the thread…</p>;

  return (
    <TalkThread
      messages={data.messages}
      now={now}
      busy={busy}
      error={sendError}
      onSend={signedIn ? send : undefined}
      emptyLine={
        signedIn
          ? "Nobody has said anything yet. Somebody has to go first."
          : "Sign in to say something."
      }
    />
  );
}
