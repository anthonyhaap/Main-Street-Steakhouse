export type MemberRole = "commissioner" | "owner" | "viewer";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  created_at: string;
}

export interface League {
  id: string;
  name: string;
  description: string | null;
  season: string | null;
  commissioner_id: string;
  created_at: string;
}

export interface FantasyTeam {
  id: string;
  league_id: string;
  name: string;
  owner_id: string | null;
  created_at: string;
}

export interface LeagueMember {
  id: string;
  league_id: string;
  user_id: string;
  role: MemberRole;
  team_id: string | null;
  created_at: string;
}

export interface LeagueInvite {
  id: string;
  league_id: string;
  email: string;
  role: MemberRole;
  team_id: string | null;
  token: string;
  status: InviteStatus;
  expires_at: string;
  invited_by: string;
  accepted_at: string | null;
  created_at: string;
}
