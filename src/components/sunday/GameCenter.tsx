"use client";

/**
 * Steakhouse Sunday — the game center, as a picture of one payload.
 *
 * Presentation only: `/sunday` hands it the live board and the room, and
 * `/preview/sunday` hands it the fixture. Everything it says comes from
 * `@/lib/sunday`, which is pure, so the two render the same way from the same
 * facts.
 *
 * One DOM for both screens, and the reader's own table above both. On a
 * desktop it is a broadcast dashboard under that — what just happened and the
 * league pulse, the featured table and the board on the left, the Fantasy
 * RedZone rail on the right, the chat as a drawer, the ticker along the
 * bottom. Under 960px the columns dissolve into one: my matchup, sticky tabs,
 * and whichever panel the tab names (the featured strip moves into Live). The two tab rows are separate state on purpose — the
 * desktop has a "Game center" view a phone has no room for, and a phone opens
 * on the Live feed.
 */

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import { freshness, slateLine } from "@/lib/scoreboard";
import {
  alerts as alertsOf, closeGames, eventContext, excitement, featured, intelContext, liveMoment, storylines,
  sundayPhase, talkContext, tickerItems, weightsFrom,
  type CardContext, type Phase, type RecapExtras, type SundayBoard, type SundayEvent, type TickerTarget,
} from "@/lib/sunday";
import type { ChatItem } from "@/lib/types";
import { Featured } from "./Featured";
import { AllMatchups, CloseGames, NflBoard } from "./Boards";
import { Recap, RedZoneRail, WatchRedZone } from "./RedZone";
import { SundayTicker } from "./Ticker";
import { ChatPanel, type TalkContext } from "./ChatPanel";
import { ManagerStatusBoard, Storylines, TuneExcitement, WhatDoINeed, WhyFeatured, storiesFor } from "./Intel";
import { JustHappened, LeaguePulse, MyMatchup, NextUp } from "./GameDay";
import { justHappened, leaguePulse, matchupMoment, nextUp, pulseTicker, seatOf, weekdayName } from "@/lib/gameday";
import "./sunday.css";

type Desk = "center" | "redzone" | "matchups" | "nfl";
type Mob = "feed" | "matchups" | "nfl" | "chat";

export type GameCenterProps = {
  board: SundayBoard;
  now: number;
  /** Live stats are behind: say so, keep everything. */
  delayed?: boolean;
  chat: ChatItem[] | null;
  /** With an event id, the message is Talk shit about that moment. */
  onSend?: (body: string, eventId?: string) => Promise<void>;
  chatError?: string | null;
  /** One tap on a moment. Absent where there is nobody to react as. */
  onReact?: (eventId: string, emoji: string) => void;
  /** Chat lines this reader has not seen, for the ticker. */
  unreadChat?: number;
  /** What the server knows about a table that a snapshot does not. */
  context?: Record<string, CardContext>;
  /** The commissioner's save for the excitement weights. */
  onTune?: (changes: Record<string, number | null>) => Promise<void>;
  /** What the recap needs beyond the board, once the week is over. */
  recapExtras?: RecapExtras | null;
  /**
   * Links to the Sundays either side of this one. Absent where there is
   * nowhere to go — the preview runs one invented week.
   */
  weeks?: { prev: string | null; next: string | null; current: string | null };
};

const PHONE = "(max-width: 960px)";

export function GameCenter({
  board, now, delayed = false, chat, onSend, chatError, context, onReact, onTune, unreadChat = 0,
  recapExtras = null, weeks,
}: GameCenterProps) {
  const phase: Phase = sundayPhase(board, now);
  const [desk, setDesk] = useState<Desk>("center");
  const [mob, setMob] = useState<Mob>("feed");
  const [picked, setPicked] = useState<string | null>(null);
  const [openGame, setOpenGame] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  // The moment Talk shit attached to the next message, if any.
  const [talk, setTalk] = useState<TalkContext | null>(null);

  // The league's own weights when the server sent them; the defaults when not.
  const weights = useMemo(() => weightsFrom(board.intel?.weights), [board]);
  const list = useMemo(() => alertsOf(board, weights), [board, weights]);
  const stories = useMemo(() => storylines(board), [board]);
  const close = useMemo(() => closeGames(board), [board]);
  const closeIds = useMemo(() => new Set(close.map((c) => c.id)), [close]);
  // What the day's events know about each table — lead changes, touchdowns —
  // counts toward which one is featured, on top of whatever the page was given.
  // So does what the league's history knows — a rivalry, playoff stakes.
  const ctx = useMemo(() => {
    const out: Record<string, CardContext> = {};
    for (const part of [eventContext(board.events ?? []), intelContext(board), context ?? {}]) {
      for (const [id, c] of Object.entries(part)) out[id] = { ...out[id], ...c };
    }
    return out;
  }, [board, context]);
  // Your own table has its own panel at the top, so the one the page features
  // is the best of the *other* five — never the same game twice on one screen.
  const seat = useMemo(() => seatOf(board), [board]);
  const others = useMemo(
    () => (seat ? { ...board, matchups: board.matchups.filter((c) => c.id !== seat.card.id) } : board),
    [board, seat],
  );
  const ranked = useMemo(() => featured(others, phase, ctx, weights), [others, phase, ctx, weights]);
  // A Steakhouse moment takes the featured slot for a few minutes, then gives
  // it back. The reader's own pick always wins over both.
  const moment = liveMoment((board.events ?? []).filter((e) => e.matchup_id !== seat?.card.id), now);
  const momentCard = moment ? board.matchups.find((c) => c.id === moment.matchup_id) ?? null : null;
  const auto = momentCard
    ? { card: momentCard, label: "🚨 Steakhouse moment", score: Infinity }
    : ranked && { ...ranked, label: `${phase === "live" ? "🔥" : "🏆"} ${ranked.label}` };
  const pickedCard = picked ? board.matchups.find((c) => c.id === picked) ?? null : null;
  const focus = pickedCard ?? auto?.card ?? null;
  // Why the page chose it, in the words the score counted. Not for a pick or
  // a moment: the reader chose the one, and the moment explains itself.
  const why = useMemo(() => (focus && !pickedCard && !momentCard
    ? excitement(focus, board, ctx[focus.id], weights).reasons : []), [focus, pickedCard, momentCard, board, ctx, weights]);
  // A minute is plenty of resolution for "the last half hour".
  const minute = Math.floor(now / 60_000);
  const pulse = useMemo(() => leaguePulse(board, minute * 60_000), [board, minute]);
  const happened = useMemo(() => justHappened(board.events ?? [], minute * 60_000, board.my_team_id), [board, minute]);
  const myMoment = useMemo(
    () => (seat ? matchupMoment(seat.card, board.events ?? [], board.nfl ?? [], minute * 60_000) : null),
    [seat, board, minute],
  );
  const upNext = useMemo(() => nextUp(board, minute * 60_000), [board, minute]);
  // The pulse lines the ticker does not already carry from the events and the
  // alerts: monster days, bench pain, the table as it stands.
  const ticker = useMemo(() => {
    const base = tickerItems(board, list, phase, minute * 60_000, unreadChat);
    const extra = pulseTicker(pulse.filter((p) => p.kind === "monster" || p.kind === "bench" || p.kind === "playoff"));
    const at = base.findIndex((t) => !t.id.startsWith("ev:"));
    return at < 0 ? [...base, ...extra] : [...base.slice(0, at), ...extra, ...base.slice(at)];
  }, [board, list, phase, minute, unreadChat, pulse]);

  const phone = () => typeof window !== "undefined" && window.matchMedia(PHONE).matches;

  const openMatchup = useCallback((id: string) => {
    // Your own table is the panel at the top, not a pick.
    if (seat && id === seat.card.id) {
      setPicked(null);
      requestAnimationFrame(() => document.getElementById("sun-mine")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    setPicked(id === auto?.card.id ? null : id);
    // On a phone the featured strip lives on the feed tab.
    if (phone() && seat) setMob("feed");
    // The featured panel lives in the game center view; take the reader there.
    if (!phone() && desk !== "center") setDesk("center");
    requestAnimationFrame(() => document.getElementById("sun-featured")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [auto?.card.id, desk, seat]);

  const openNfl = useCallback((id: string) => {
    setOpenGame(id);
    if (phone()) setMob("nfl");
    else if (desk === "redzone" || desk === "matchups") setDesk("nfl");
    requestAnimationFrame(() => document.getElementById(`sun-game-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [desk]);

  const openChat = useCallback(() => {
    if (phone()) {
      setMob("chat");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else setDrawer(true);
  }, []);

  // Talk shit: the chat opens with the moment already above the composer.
  const talkAbout = useCallback((e: SundayEvent) => {
    setTalk({ eventId: e.id, text: talkContext(e) });
    openChat();
  }, [openChat, setTalk]);

  const onTarget = useCallback((t: TickerTarget) => {
    if (t.kind === "matchup") openMatchup(t.id);
    else if (t.kind === "game") openNfl(t.id);
    else openChat();
  }, [openMatchup, openNfl, openChat]);

  const feedLabel = phase === "pre" ? "Pregame" : phase === "final" ? "Recap" : "Live";
  const phaseWord = phase === "live" ? "Live" : phase === "pre" ? "Pre-game" : "Final";
  const empty = board.matchups.length === 0;
  // Between windows: still Sunday, nothing on this minute.
  const between = phase === "live" && (board.games?.in_progress ?? 0) === 0;
  const day = now ? weekdayName(now) : "";
  const title = phase === "final" ? "Week in the books" : /^(Sunday|Monday|Thursday|Saturday)$/.test(day) ? `${day} Game Center` : "Game Center";
  const needPanel = () => {
    setMob("feed");
    requestAnimationFrame(() => document.querySelector("[data-panel='need']")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="sun" data-phase={phase} data-desk={desk} data-mob={mob} data-chat={drawer} data-seat={!!seat}>
      <header className="sun-head">
        <div className="sun-head__title">
          <span className="gd-eyebrow">Main Street Steakhouse</span>
          <h1>{title}</h1>
          <div className="sun-head__meta">
            {weeks?.prev && <a className="sun-week" href={weeks.prev} aria-label={`Week ${board.week - 1}`}>‹</a>}
            <span>Week {board.week}</span>
            {weeks?.next && <a className="sun-week" href={weeks.next} aria-label={`Week ${board.week + 1}`}>›</a>}
            {weeks?.current && <a className="sun-week" href={weeks.current}>This Sunday</a>}
            <span aria-hidden>•</span>
            <span className="sun-live" data-phase={phase}><i aria-hidden />{phaseWord}</span>
            <span className="sun-fresh">
              {slateLine(board.games, now)} Scores {freshness(board.stats_updated_at, now)}.
            </span>
          </div>
        </div>
        <div className="sun-head__actions">
          <WatchRedZone compact />
        </div>
      </header>

      {delayed && (
        <div className="sun-delay" role="status">
          <span aria-hidden>⏱</span>
          Live stats temporarily delayed. The scores below are the last we had, and they will pick up where they left off.
        </div>
      )}

      {seat && <MyMatchup seat={seat} moment={myMoment} onNeed={phase === "live" ? needPanel : undefined} />}
      {!seat && !empty && phase !== "final" && (
        <p className="gd-noseat">You don&apos;t have a matchup this week — here&apos;s the whole league.</p>
      )}
      <NextUp next={upNext} phase={phase} betweenWindows={between} />

      <nav className="sun-tabs" data-for="desk" aria-label="Game center sections">
        {([
          ["center", "Game center"], ["redzone", "Fantasy RedZone"], ["matchups", "Matchups"], ["nfl", "NFL games"],
        ] as [Desk, string][]).map(([k, label]) => (
          <button key={k} type="button" className="sun-tab" data-on={desk === k} aria-pressed={desk === k} onClick={() => setDesk(k)}>
            {label}
            {k === "redzone" && phase === "live" && <i className="sun-dot" aria-hidden />}
          </button>
        ))}
        <button type="button" className="sun-tab" data-on={drawer} aria-pressed={drawer} onClick={() => setDrawer((v) => !v)}>
          Chat
        </button>
      </nav>

      <nav className="sun-tabs" data-for="phone" aria-label="Game center tabs">
        {([["feed", feedLabel], ["matchups", "Matchups"], ["nfl", "NFL"], ["chat", "Chat"]] as [Mob, string][]).map(([k, label]) => (
          <button key={k} type="button" className="sun-tab" data-on={mob === k} aria-pressed={mob === k} onClick={() => setMob(k)}>
            {label}
            {k === "feed" && phase === "live" && <i className="sun-dot" aria-hidden />}
            {k === "matchups" && close.length > 0 && <span className="sun-tab__n">{close.length}</span>}
          </button>
        ))}
      </nav>

      <div className="sun-grid">
        <div className="sun-main">
          {phase === "final" && <Recap board={board} extras={recapExtras} onMatchup={openMatchup} />}
          <div className="sun-pair">
            <JustHappened events={happened} now={now} phase={phase} onOpen={openMatchup} />
            <LeaguePulse items={pulse} phase={phase} onOpen={openMatchup} />
          </div>
          {focus && auto && (
            <Featured
              card={focus} label={auto.label} auto={!pickedCard} phase={phase} now={now}
              nfl={board.nfl ?? []} cards={board.matchups} onPick={(id) => (id ? openMatchup(id) : setPicked(null))}
              stories={storiesFor(stories, focus)} why={<WhyFeatured reasons={why} />}
            />
          )}
          {phase === "live" && <WhatDoINeed board={board} nfl={board.nfl ?? []} onOpen={openMatchup} />}
          <Storylines stories={stories} onOpen={openMatchup} />
          {empty && (
            <div className="sun-quiet" data-panel="featured">
              No matchups for week {board.week} yet. Lineups post once the draft is done.
            </div>
          )}
          <CloseGames cards={close} onOpen={openMatchup} />
          <ManagerStatusBoard board={board} phase={phase} onOpen={openMatchup} />
          <AllMatchups board={board} focusId={focus?.id ?? null} close={closeIds} phase={phase} onOpen={openMatchup} />
          <NflBoard board={board} nfl={board.nfl ?? []} now={now} openId={openGame}
            onToggle={(id) => setOpenGame((cur) => (cur === id ? null : id))} />
          {board.intel?.can_tune && onTune && <TuneExcitement weights={board.intel.weights} onSave={onTune} />}
        </div>
        <aside className="sun-rail" aria-label="Fantasy RedZone rail">
          <RedZoneRail board={board} phase={phase} list={list} now={now} onMatchup={openMatchup} onGame={openNfl}
            onReact={onReact} onTalk={onSend ? talkAbout : undefined} />
        </aside>
        {/* The chat is a column of the layout, not a sheet over it: beside the
            rail on a wide screen, in the rail's place on a narrower one, and
            never on top of anything. */}
        {drawer && (
          <aside className="sun-drawer" aria-label="League chat">
            <div className="sun-drawer__head">
              <h2>💬 Chat</h2>
              <button type="button" className="sun-btn" style={{ padding: 6 }} aria-label="Close chat" onClick={() => setDrawer(false)}>
                <X size={14} />
              </button>
            </div>
            <ChatPanel items={chat} onSend={onSend} error={chatError} context={talk} onClearContext={() => setTalk(null)} />
          </aside>
        )}
      </div>

      <section className="sun-sec" data-panel="chat" aria-label="League chat">
        <ChatPanel items={chat} onSend={onSend} error={chatError} context={talk} onClearContext={() => setTalk(null)} />
      </section>


      <SundayTicker items={ticker} onTarget={onTarget} />
    </div>
  );
}

/** The game center's silhouette, for the moment before the first payload. */
export function GameCenterSkeleton() {
  return (
    <div className="sun" data-phase="pre" data-desk="center" data-mob="feed" aria-busy="true">
      <header className="sun-head">
        <div className="sun-head__title">
          <span className="gd-eyebrow">Main Street Steakhouse</span>
          <h1>Game Center</h1>
          <div className="sun-head__meta"><span>Loading the board…</span></div>
        </div>
      </header>
      <div className="sun-grid" style={{ marginTop: "var(--s4)" }}>
        <div className="sun-main">
          <div className="sun-skel" data-panel="featured" style={{ height: 220 }} />
          <div className="sun-skel" data-panel="matchups" style={{ height: 180 }} />
        </div>
        <aside className="sun-rail">
          <div className="sun-skel" data-panel="redzone" style={{ height: 320 }} />
        </aside>
      </div>
    </div>
  );
}
