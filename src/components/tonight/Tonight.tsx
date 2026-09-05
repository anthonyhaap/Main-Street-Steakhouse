"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID, SITE_URL } from "@/lib/config";
import { crestUrl } from "@/lib/crest";
import { matchupText, phaseOf, recapText, type Briefing } from "@/lib/briefing";
import { TopBar } from "@/components/Shell";
import { Seal, useToast } from "@/components/ui";
import { Curtain } from "@/components/Curtain";
import { InstallNudge } from "@/components/InstallNudge";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Carousel } from "@/components/tonight/Carousel";
import { Room } from "@/components/tonight/Room";
import { TonightSkeleton, TonightsTable, type Flash } from "@/components/tonight/TonightsTable";

/**
 * The first screen, live.
 *
 * The server hands in what it rendered so the card is on screen before a
 * byte of JavaScript runs; from there it is the same contract as every other
 * page — refetch on change, on focus, on reconnect, on a timer. On a Sunday
 * the timer tightens and a score that moves flashes gold (yours) or goes dim
 * (his), and an Android phone taps you on the wrist.
 */
export function Tonight({ initial, serverNow }: { initial: Briefing | null; serverNow: number }) {
  const { ready } = useSession();
  const toast = useToast();

  // The clock starts at the server's time so the first client render agrees
  // with the HTML, then ticks in server time: `useServerClock` measures the
  // offset against ff_now(), and until it has, the briefing's own timestamp
  // stands in. A phone forty seconds fast never sees a different day.
  const [now, setNow] = useState(serverNow);
  const { serverNow: clockNow, synced } = useServerClock();
  const skew = useRef(0);
  useEffect(() => {
    const id = setInterval(() => setNow(synced ? clockNow() : Date.now() + skew.current), 1000);
    return () => clearInterval(id);
  }, [synced, clockNow]);

  const fetcher = useCallback(async (): Promise<Briefing> => {
    const { data, error } = await supabaseBrowser().rpc("ff_briefing", { p_league_id: LEAGUE_ID });
    if (error) throw new Error(error.message);
    return data as Briefing;
  }, []);

  const phaseNow = initial ? phaseOf(initial, serverNow) : null;
  const { data, status, error, refetch } = useLive<Briefing>(fetcher, {
    tables: ["matchups", "rosters", "drafts", "teams", "nfl_games"],
    channel: "tonight",
    pollMs: phaseNow === "live" || phaseNow === "monday" ? 15000 : 45000,
    enabled: ready,
    initial,
  });

  useEffect(() => {
    if (data?.now) skew.current = new Date(data.now).getTime() - Date.now();
  }, [data]);

  /* ---------------------------------------------------------- live ticks */
  const prev = useRef<{ my: number; opp: number } | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => {
    const m = data?.matchup;
    if (!m) return;
    const cur = { my: Number(m.my_points), opp: Number(m.opp_points) };
    const was = prev.current;
    prev.current = cur;
    if (!was) return;
    if (cur.my > was.my) {
      setFlash("up");
      try { navigator.vibrate?.(12); } catch { /* not on this device */ }
    } else if (cur.opp > was.opp) {
      setFlash("dim");
    } else return;
    const id = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(id);
  }, [data]);

  /* ---------------------------------------------------------------- share */
  const share = useCallback(async () => {
    if (!data) return;
    const origin = typeof location !== "undefined" && location.origin.startsWith("http") ? location.origin : SITE_URL;
    const phase = phaseOf(data, now || new Date(data.now).getTime());
    const text = phase === "recap" ? recapText(data, origin) : matchupText(data, origin);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast("ok", "Copied. Paste it in the chat.");
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast("error", "Couldn't open the share sheet.");
    }
  }, [data, now, toast]);

  const b = data;
  // Before the first tick, `now` may be the server's zero; the briefing's
  // own timestamp is the next best clock.
  const clock = now || (b ? new Date(b.now).getTime() : 0);
  const phase = b ? phaseOf(b, clock) : null;

  return (
    <>
      <TopBar status={status} />
      <Curtain />
      <PullToRefresh onRefresh={refetch}>
        <main className="page tonight">
          {!b && !error && <TonightSkeleton />}
          {!b && error && (
            <section className="tt">
              <i className="tt__rule" />
              <p className="tt__eyebrow eyebrow"><span>Main Street Steakhouse</span></p>
              <h1 className="tt__title display">The kitchen&apos;s closed.</h1>
              <i className="tt__rule" />
              <p className="tt__line">{error}</p>
              <i className="tt__rule" />
              <button className="tt__action" onClick={() => void refetch()}><span>Try again</span></button>
            </section>
          )}
          {b && <TonightsTable b={b} now={clock} flash={flash} onShare={share} />}

          {b && <Carousel b={b} live={phase === "live"} />}
          {/* A second call, on purpose: the room arrives after the card. */}
          {b && <Room now={clock} enabled={ready} />}
          {b && <Table b={b} />}

          <InstallNudge />

          <p className="eyebrow tonight__foot">Main Street Steakhouse · Est. 2016 · Members Only</p>
        </main>
      </PullToRefresh>
    </>
  );
}

/** The standings, as a place card: seed, name, record. The line is the line. */
function Table({ b }: { b: Briefing }) {
  if (b.standings.length === 0) return null;
  const played = b.standings.some((t) => t.wins + t.losses + t.ties > 0);
  if (!played) return null;
  return (
    <section className="place" aria-label="Standings">
      <div className="room__head">
        <span className="eyebrow">The table</span>
        <Link href="/standings" className="eyebrow" data-tone="gold" style={{ textDecoration: "none" }}>Playoff odds →</Link>
      </div>
      <ol className="place__list">
        {b.standings.map((t) => (
          <li key={t.team_id} data-mine={t.team_id === b.me?.team_id} data-line={t.seed === b.league.playoff_teams}>
            <span className="num place__seed">{t.seed}</span>
            <Seal name={t.name} src={crestUrl(t.logo_path)} mine={t.team_id === b.me?.team_id} size={26} />
            <span className="place__name">{t.name}{t.manager_name && <i> · {t.manager_name}</i>}</span>
            <span className="num place__rec">{t.wins}–{t.losses}{t.ties ? `–${t.ties}` : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
