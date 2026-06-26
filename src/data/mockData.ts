export interface Player {
  id: number;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
  nflTeam: string;
  owner: string | null;
  points: number;
  projectedPoints: number;
  status: 'active' | 'questionable' | 'out' | 'bye';
  stats: { label: string; value: string }[];
}

export interface Team {
  id: number;
  name: string;
  owner: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  roster: number[];
  isMyTeam?: boolean;
}

export interface Matchup {
  id: number;
  week: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  isLive: boolean;
}

export interface DraftPick {
  round: number;
  pick: number;
  playerId: number;
  teamId: number;
}

export const players: Player[] = [
  { id: 1,  name: 'Patrick Mahomes', position: 'QB',  nflTeam: 'KC',  owner: 'My Team',       points: 34.2, projectedPoints: 28.5, status: 'active',       stats: [{ label: 'Pass YDs', value: '312' }, { label: 'TDs', value: '3' }, { label: 'INTs', value: '0' }] },
  { id: 2,  name: 'Christian McCaffrey', position: 'RB',  nflTeam: 'SF',  owner: 'My Team',       points: 29.8, projectedPoints: 22.1, status: 'active',       stats: [{ label: 'Rush YDs', value: '98' }, { label: 'Rec YDs', value: '45' }, { label: 'TDs', value: '2' }] },
  { id: 3,  name: 'Tyreek Hill',     position: 'WR',  nflTeam: 'MIA', owner: 'My Team',       points: 22.5, projectedPoints: 19.3, status: 'active',       stats: [{ label: 'Rec', value: '9' }, { label: 'Rec YDs', value: '135' }, { label: 'TDs', value: '1' }] },
  { id: 4,  name: 'Travis Kelce',    position: 'TE',  nflTeam: 'KC',  owner: 'My Team',       points: 18.7, projectedPoints: 16.4, status: 'active',       stats: [{ label: 'Rec', value: '7' }, { label: 'Rec YDs', value: '87' }, { label: 'TDs', value: '1' }] },
  { id: 5,  name: 'Justin Jefferson', position: 'WR', nflTeam: 'MIN', owner: 'My Team',       points: 21.3, projectedPoints: 18.0, status: 'active',       stats: [{ label: 'Rec', value: '8' }, { label: 'Rec YDs', value: '123' }, { label: 'TDs', value: '1' }] },
  { id: 6,  name: "Ja'Marr Chase",   position: 'WR',  nflTeam: 'CIN', owner: 'My Team',       points: 0,    projectedPoints: 17.5, status: 'bye',          stats: [] },
  { id: 7,  name: 'Nick Chubb',      position: 'RB',  nflTeam: 'CLE', owner: 'My Team',       points: 0,    projectedPoints: 14.2, status: 'questionable', stats: [] },
  { id: 8,  name: 'Evan McPherson',  position: 'K',   nflTeam: 'CIN', owner: 'My Team',       points: 11.0, projectedPoints: 9.0,  status: 'active',       stats: [{ label: 'FGM', value: '3' }, { label: 'XPM', value: '2' }] },
  { id: 9,  name: 'SF Defense',      position: 'DEF', nflTeam: 'SF',  owner: 'My Team',       points: 14.0, projectedPoints: 10.5, status: 'active',       stats: [{ label: 'Sacks', value: '4' }, { label: 'INTs', value: '2' }, { label: 'TDs', value: '1' }] },
  { id: 10, name: 'Josh Allen',      position: 'QB',  nflTeam: 'BUF', owner: null,            points: 31.5, projectedPoints: 26.0, status: 'active',       stats: [{ label: 'Pass YDs', value: '287' }, { label: 'TDs', value: '3' }, { label: 'Rush YDs', value: '42' }] },
  { id: 11, name: 'Saquon Barkley',  position: 'RB',  nflTeam: 'PHI', owner: 'Gridiron Guru', points: 24.1, projectedPoints: 21.0, status: 'active',       stats: [{ label: 'Rush YDs', value: '111' }, { label: 'TDs', value: '1' }] },
  { id: 12, name: 'Davante Adams',   position: 'WR',  nflTeam: 'NYJ', owner: null,            points: 0,    projectedPoints: 15.5, status: 'active',       stats: [] },
  { id: 13, name: 'CeeDee Lamb',     position: 'WR',  nflTeam: 'DAL', owner: 'Touchdown Kings',points: 19.8, projectedPoints: 18.5, status: 'active',      stats: [{ label: 'Rec', value: '7' }, { label: 'Rec YDs', value: '108' }, { label: 'TDs', value: '1' }] },
  { id: 14, name: 'Stefon Diggs',    position: 'WR',  nflTeam: 'BUF', owner: null,            points: 0,    projectedPoints: 14.8, status: 'active',       stats: [] },
  { id: 15, name: 'Tony Pollard',    position: 'RB',  nflTeam: 'TEN', owner: null,            points: 0,    projectedPoints: 13.5, status: 'active',       stats: [] },
  { id: 16, name: 'Sam LaPorta',     position: 'TE',  nflTeam: 'DET', owner: null,            points: 0,    projectedPoints: 11.2, status: 'active',       stats: [] },
  { id: 17, name: 'Lamar Jackson',   position: 'QB',  nflTeam: 'BAL', owner: 'End Zone Elites',points: 36.4, projectedPoints: 29.0, status: 'active',      stats: [{ label: 'Pass YDs', value: '201' }, { label: 'Rush YDs', value: '88' }, { label: 'TDs', value: '3' }] },
  { id: 18, name: 'Jonathan Taylor', position: 'RB',  nflTeam: 'IND', owner: null,            points: 0,    projectedPoints: 18.0, status: 'questionable', stats: [] },
  { id: 19, name: 'DeVonta Smith',   position: 'WR',  nflTeam: 'PHI', owner: null,            points: 0,    projectedPoints: 13.8, status: 'active',       stats: [] },
  { id: 20, name: 'Mark Andrews',    position: 'TE',  nflTeam: 'BAL', owner: 'End Zone Elites',points: 16.2, projectedPoints: 14.0, status: 'active',      stats: [{ label: 'Rec', value: '6' }, { label: 'Rec YDs', value: '72' }, { label: 'TDs', value: '1' }] },
];

export const teams: Team[] = [
  { id: 1, name: 'My Team',          owner: 'You',            wins: 7, losses: 3, pointsFor: 1248.5, pointsAgainst: 1102.3, roster: [1,2,3,4,5,6,7,8,9],   isMyTeam: true },
  { id: 2, name: 'Gridiron Guru',    owner: 'Alex',           wins: 6, losses: 4, pointsFor: 1198.2, pointsAgainst: 1145.6, roster: [11,17] },
  { id: 3, name: 'Touchdown Kings',  owner: 'Marcus',         wins: 6, losses: 4, pointsFor: 1175.0, pointsAgainst: 1130.8, roster: [13,20] },
  { id: 4, name: 'End Zone Elites',  owner: 'Jordan',         wins: 5, losses: 5, pointsFor: 1155.3, pointsAgainst: 1160.1, roster: [17,20] },
  { id: 5, name: 'Blitz Brigade',    owner: 'Taylor',         wins: 5, losses: 5, pointsFor: 1140.8, pointsAgainst: 1148.2, roster: [] },
  { id: 6, name: 'Field Goal Fanatics', owner: 'Morgan',      wins: 4, losses: 6, pointsFor: 1110.5, pointsAgainst: 1175.3, roster: [] },
  { id: 7, name: 'Red Zone Rangers', owner: 'Casey',          wins: 4, losses: 6, pointsFor: 1095.2, pointsAgainst: 1182.4, roster: [] },
  { id: 8, name: 'Hail Mary Heroes', owner: 'Riley',          wins: 3, losses: 7, pointsFor: 1050.1, pointsAgainst: 1210.6, roster: [] },
];

export const currentMatchups: Matchup[] = [
  { id: 1, week: 11, homeTeamId: 1, awayTeamId: 2, homeScore: 151.5, awayScore: 138.2, isLive: true },
  { id: 2, week: 11, homeTeamId: 3, awayTeamId: 4, homeScore: 112.3, awayScore: 124.8, isLive: true },
  { id: 3, week: 11, homeTeamId: 5, awayTeamId: 6, homeScore: 98.7,  awayScore: 89.4,  isLive: true },
  { id: 4, week: 11, homeTeamId: 7, awayTeamId: 8, homeScore: 88.2,  awayScore: 105.6, isLive: false },
];

export const draftPlayers: Player[] = [
  ...players,
  { id: 21, name: 'Tua Tagovailoa',  position: 'QB',  nflTeam: 'MIA', owner: null, points: 0, projectedPoints: 22.5, status: 'active', stats: [] },
  { id: 22, name: 'Breece Hall',     position: 'RB',  nflTeam: 'NYJ', owner: null, points: 0, projectedPoints: 20.0, status: 'active', stats: [] },
  { id: 23, name: 'Amon-Ra St. Brown', position: 'WR', nflTeam: 'DET', owner: null, points: 0, projectedPoints: 17.2, status: 'active', stats: [] },
  { id: 24, name: 'George Kittle',   position: 'TE',  nflTeam: 'SF',  owner: null, points: 0, projectedPoints: 15.5, status: 'active', stats: [] },
  { id: 25, name: 'Jake Tucker',     position: 'K',   nflTeam: 'KC',  owner: null, points: 0, projectedPoints: 8.5,  status: 'active', stats: [] },
  { id: 26, name: 'KC Defense',      position: 'DEF', nflTeam: 'KC',  owner: null, points: 0, projectedPoints: 9.0,  status: 'active', stats: [] },
];

export const aiSuggestions = [
  {
    id: 1,
    type: 'waiver' as const,
    priority: 'high' as const,
    title: 'Add Jonathan Taylor',
    description: 'Taylor returns from injury this week with a favorable matchup vs. HOU. 78% chance of 15+ points.',
    player: players[17],
    confidence: 78,
  },
  {
    id: 2,
    type: 'start' as const,
    priority: 'high' as const,
    title: "Start Ja'Marr Chase",
    description: "Chase returns from bye with the highest projected ceiling this week. Don't leave him on your bench.",
    player: players[5],
    confidence: 85,
  },
  {
    id: 3,
    type: 'trade' as const,
    priority: 'medium' as const,
    title: 'Trade Nick Chubb',
    description: "Chubb's injury status is uncertain. Consider trading him while his value is high before the deadline.",
    player: players[6],
    confidence: 71,
  },
  {
    id: 4,
    type: 'matchup' as const,
    priority: 'medium' as const,
    title: 'Stack Mahomes + Kelce',
    description: 'KC faces the weakest pass defense this week. A Mahomes-Kelce stack maximizes your ceiling.',
    player: players[0],
    confidence: 82,
  },
  {
    id: 5,
    type: 'start' as const,
    priority: 'low' as const,
    title: 'Bench SF Defense',
    description: 'SF faces a high-powered offense this week. Consider streaming a different DST.',
    player: players[8],
    confidence: 63,
  },
];
