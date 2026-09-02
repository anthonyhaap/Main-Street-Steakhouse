"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_ID } from "@/lib/config";
import { crestUrl } from "@/lib/crest";
import type { League, Team } from "@/lib/types";

type SessionValue = {
  user: User | null;
  team: Team | null;
  league: League | null;
  teams: Team[];
  isCommissioner: boolean;
  ready: boolean;
  reload: () => Promise<void>;
};

const Ctx = createContext<SessionValue>({
  user: null, team: null, league: null, teams: [],
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
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u ?? null);

      if (!u) {
        setTeam(null); setLeague(null); setTeams([]); setReady(true);
        return;
      }

      // ff_link_me claims the team whose owner_email matches this account.
      // Idempotent: returns the already-linked team on every later call.
      //
      // This MUST run before the table reads, not alongside them: league tables
      // are now readable only by members, and a brand-new account does not
      // become a member until this call binds it to its team.
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
