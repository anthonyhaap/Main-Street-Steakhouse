"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_ID } from "@/lib/config";
import { crestUrl } from "@/lib/crest";
import type { League, Team } from "@/lib/types";

/**
 * How the caller holds `team`. The owner is the manager — the name on the
 * standings, the one who hands seats out. A co-owner holds the same seat with
 * the same rights everywhere else in the app; the only screens that ask which
 * of the two you are are the ones about the seat itself.
 */
export type Seat = "owner" | "co_owner";

type SessionValue = {
  user: User | null;
  team: Team | null;
  league: League | null;
  teams: Team[];
  seat: Seat | null;
  isCommissioner: boolean;
  ready: boolean;
  reload: () => Promise<void>;
};

const Ctx = createContext<SessionValue>({
  user: null, team: null, league: null, teams: [], seat: null,
  isCommissioner: false, ready: false, reload: async () => {},
});

export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [ready, setReady] = useState(false);

  const load = useMemo(
    () => async () => {
      const supabase = supabaseBrowser();
      // `getSession()`, not `getUser()`. Every screen in the app waits on
      // `ready`, and `ready` waits on this — so this call sits in front of
      // ff_link_me, the league and team reads, and then the page's own data.
      // `getUser()` is a network round trip to the auth server on every load;
      // `getSession()` reads the token already in storage and only goes to the
      // network when it has actually expired, in which case it refreshes.
      //
      // Safe here and nowhere else: this is the browser, and nothing is
      // trusted on the strength of it. `user.id` picks a highlight and decides
      // which buttons to draw; every read and every write behind those buttons
      // is checked again by RLS against the token the database verifies for
      // itself. On the server, where a decision is being made rather than a
      // screen drawn, `getUser()` is still the only correct call.
      const { data: { session } } = await supabase.auth.getSession();
      const u = session?.user ?? null;
      setUser(u);

      if (!u) {
        setTeam(null); setLeague(null); setTeams([]); setReady(true);
        return;
      }

      // ff_link_me returns the team this account holds a seat at — owned, or
      // co-owned. Idempotent: the same team on every later call.
      //
      // This MUST run before the table reads, not alongside them: league tables
      // are readable only by members, and the answer here is what says whether
      // this account is one.
      const { data: linked } = await supabase.rpc("ff_link_me");

      const [{ data: lg }, { data: ts }] = await Promise.all([
        supabase.from("leagues").select("*").eq("id", LEAGUE_ID).maybeSingle(),
        supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      ]);

      const mine = Array.isArray(linked) ? linked[0] : linked;
      setTeam((mine as Team) ?? null);
      setLeague((lg as League) ?? null);
      setTeams((ts as Team[]) ?? []);
      setReady(true);
    },
    [],
  );

  useEffect(() => {
    void load();
    const supabase = supabaseBrowser();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        void load();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value: SessionValue = {
    user, team, league, teams, ready,
    seat: !user || !team ? null : team.owner_id === user.id ? "owner" : "co_owner",
    isCommissioner: !!user && !!league && league.commissioner_id === user.id,
    reload: load,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * A team's crest by id, for the seals scattered across the league.
 *
 * The session already carries every team in the league, so nothing here costs
 * a request. Components that are deliberately pure — the standings board, the
 * draft clock — take the lookup as a prop instead of calling this, so they
 * still render from a fixture.
 */
export function useCrests() {
  const { teams } = useSession();
  return useMemo(() => {
    const by = new Map(teams.map((t) => [t.id, crestUrl(t.logo_path)]));
    return (teamId: string | null | undefined) => (teamId ? by.get(teamId) ?? null : null);
  }, [teams]);
}
