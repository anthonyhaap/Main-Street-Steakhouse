import type { PlayerCard } from "@/lib/nfl/types";

/** Verbatim snapshot of ff_player_card for one player, 1 September 2026. See page.tsx. */
const LOG_2025 = [
  26.02, 22.08, 13.16, 27.3, 26.72, 31.48, 26.24, 22.96, 10.5,
  13.34, 17.08, 29.44, 6.3, 13.06, 0, 0, 0,
];
const WEEKS_2025 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18];

export const CARD: PlayerCard = {
  player: {
    id: "e4df654a-8f9e-4515-acbc-20da345a8269",
    full_name: "Patrick Mahomes",
    first_name: null, last_name: null,
    position: "QB", nfl_team: "KC", status: "ACT",
    bye_week: 5, jersey: 15, age: 30, birth_date: "1995-09-17",
    height_in: 74, weight_lb: 225, college: "Texas Tech",
    high_school: "Whitehouse (TX)", years_exp: 9, rookie_year: 2017,
    depth_chart_order: 1, depth_chart_pos: "QB",
    espn_id: "3139477", sleeper_id: "4046",
  },
  league: { season: 2026, name: "Anthony's League" },
  week: 1,
  game: {
    opponent: "DEN", home: true,
    kickoff_at: "2026-09-15T00:15:00+00:00",
    status: "pre", status_detail: "9/14 - 8:15 PM EDT",
  },
  injury: {
    status: "Questionable", severity: "questionable",
    detail: "Knee - ACL", location: "Leg",
    comment: "Mahomes (knee) is on track to start Week 1 against the Broncos, Ian Rapoport of NFL Network reports.",
    return_date: "2026-09-14", reported_at: "2026-08-29T17:08:00+00:00",
  },
  this_season: null,
  last_season: {
    season: 2025,
    games: 17,
    points: 285.68,
    avg_points: 16.8,
    last3_avg: 0,
    best: 31.48,
    worst: 0,
    swing: 10.78,
    booms: 9,
    busts: 3,
    game_log: WEEKS_2025.map((week, i) => ({ week, points: LOG_2025[i] })),
    usage: {
      snap_pct: 97.4, pass_att: 29.5, pass_yds: 211, carries: 3.8,
      rush_yds: 24.8, tds: 1.59, turnovers: 0.65,
    },
    totals: {
      pass_cmp: 315, pass_att: 502, pass_yd: 3587, pass_td: 22, pass_int: 11,
      rush_att: 64, rush_yd: 422, rush_td: 5, rec: 1, rec_yd: -10, rec_tgt: 1,
    },
  },
  projections: [
    { week: 1, points: 16.42, source_ppr: 19.22, stats: {}, updated_at: "2026-09-01T00:35:00Z" },
    { week: 2, points: 17.36, source_ppr: 20.24, stats: {}, updated_at: "2026-09-01T00:35:00Z" },
  ],
  rest_of_season: 33.8,
  depth_chart: [
    { player_id: "e4df654a-8f9e-4515-acbc-20da345a8269", name: "Patrick Mahomes",
      order: 1, injury_status: "Questionable", is_this_player: true, avg_points: 16.8 },
    { player_id: "c984c7e4-e377-4136-a613-5ff72f3d46cf", name: "Justin Fields",
      order: 2, injury_status: null, is_this_player: false, avg_points: 11 },
    { player_id: "753f627e-34a7-46f6-9b6e-8cafc1e050bf", name: "Chris Oladokun",
      order: 3, injury_status: "Questionable", is_this_player: false, avg_points: 0.7 },
    { player_id: "f7b46616-9022-409d-8fe4-25b0d4ff0ea4", name: "Garrett Nussmeier",
      order: 4, injury_status: null, is_this_player: false, avg_points: null },
  ],
  news: [
    {
      id: "49752772",
      headline: "How many different Week 1 starting QBs has each NFL team used?",
      description: "Since the NFL expanded to 32 teams in 2002, no team has used more Week 1 starting quarterbacks than the Browns.",
      published_at: "2026-08-31T16:49:25+00:00",
      url: null, byline: "John McTigue",
      image_url: "https://a.espncdn.com/photo/2026/0824/r1706315_608x342_16-9.jpg",
      image_alt: null,
    },
    {
      id: "49556816",
      headline: "Fantasy Football 'Do Draft' list: Derrick Henry, Patrick Mahomes among undervalued players to pick",
      description: "You've read the \"Do Not Draft\" list. Now, Eric Karabell lists players being drafted later than they should be.",
      published_at: "2026-08-31T15:59:19+00:00",
      url: null, byline: "Eric Karabell",
      image_url: "https://a.espncdn.com/photo/2026/0812/nfl_do_draft_list_16x9.jpg",
      image_alt: null,
    },
    {
      id: "49537843",
      headline: "How to bet the 2026 NFL season: Three bets to make on each team",
      description: "Will your NFL team beat its projected win total? What props should you target?",
      published_at: "2026-08-31T15:07:59+00:00",
      url: null, byline: "Tyler Fulghum",
      image_url: "https://a.espncdn.com/photo/2026/0827/nfl_fulghum-best-bets_16x9_608x342.jpg",
      image_alt: null,
    },
  ],
  roster_spot: null,
  market: { adp: 102.5, overall_rank: 106 },
  generated_at: "2026-09-01T02:00:00Z",
};
