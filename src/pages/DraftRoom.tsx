import { useState, useEffect, useRef } from 'react';
import { Clock, Users, ChevronRight, CheckCircle, Zap } from 'lucide-react';
import { draftPlayers, teams } from '../data/mockData';
import type { Player } from '../data/mockData';
import PlayerCard from '../components/PlayerCard';

const TOTAL_ROUNDS = 15;
const TOTAL_TEAMS = teams.length;
const PICK_TIME = 90; // seconds

function getPickOrder(round: number, pick: number) {
  // Snake draft
  return round % 2 === 1 ? pick : TOTAL_TEAMS + 1 - pick;
}

export default function DraftRoom() {
  const myDraftPosition = 3;
  const [currentRound, setCurrentRound] = useState(1);
  const [currentPick, setCurrentPick] = useState(1);
  const [timeLeft, setTimeLeft] = useState(PICK_TIME);
  const [draftedPlayers, setDraftedPlayers] = useState<{ playerId: number; teamId: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [draftStarted, setDraftStarted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const overallPick = (currentRound - 1) * TOTAL_TEAMS + currentPick;
  const teamOnClock = teams.find(t => t.id === getPickOrder(currentRound, currentPick)) ?? teams[0];
  const isMyPick = getPickOrder(currentRound, currentPick) === myDraftPosition;

  // Auto-advance timer
  useEffect(() => {
    if (!draftStarted) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          autoPick();
          return PICK_TIME;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStarted, currentRound, currentPick]);

  const availablePlayers = draftPlayers.filter(p =>
    !draftedPlayers.some(d => d.playerId === p.id)
  );

  function autoPick() {
    const best = [...availablePlayers].sort((a, b) => b.projectedPoints - a.projectedPoints)[0];
    if (best) draftPlayer(best);
  }

  function draftPlayer(player: Player) {
    const teamId = getPickOrder(currentRound, currentPick);
    setDraftedPlayers(prev => [...prev, { playerId: player.id, teamId }]);
    setTimeLeft(PICK_TIME);
    if (currentPick < TOTAL_TEAMS) {
      setCurrentPick(p => p + 1);
    } else if (currentRound < TOTAL_ROUNDS) {
      setCurrentRound(r => r + 1);
      setCurrentPick(1);
    }
  }

  const filtered = availablePlayers.filter(p => {
    const matchesPos = posFilter === 'ALL' || p.position === posFilter;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.nflTeam.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPos && matchesSearch;
  });

  const myPicks = draftedPlayers.filter(d => d.teamId === myDraftPosition);

  const timerPercent = (timeLeft / PICK_TIME) * 100;
  const timerColor = timeLeft > 30 ? 'bg-emerald-500' : timeLeft > 10 ? 'bg-yellow-500' : 'bg-red-500';

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  if (!draftStarted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Zap size={36} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white">Draft Room</h1>
          <p className="text-gray-400 mt-2 max-w-md">
            15-round snake draft · 8 teams · 90 seconds per pick.
            Your draft position: <span className="text-emerald-400 font-semibold">#{myDraftPosition}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-md">
          {[
            { label: 'Draft Position', value: `#${myDraftPosition}` },
            { label: 'Total Rounds',   value: `${TOTAL_ROUNDS}` },
            { label: 'Total Teams',    value: `${TOTAL_TEAMS}` },
            { label: 'Timer',          value: `${PICK_TIME}s` },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-gray-900 border border-gray-800 p-3 text-center">
              <p className="text-white font-bold text-lg">{s.value}</p>
              <p className="text-gray-500 text-xs">{s.label}</p>
            </div>
          ))}
        </div>
        <button
          onClick={() => setDraftStarted(true)}
          className="px-8 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-lg transition-colors"
        >
          Start Draft
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Draft Room</h1>
        <div className="text-sm text-gray-400">
          Round <span className="text-white font-bold">{currentRound}</span> ·
          Pick <span className="text-white font-bold">{overallPick}</span>
        </div>
      </div>

      {/* On the clock */}
      <div className={`rounded-xl border p-4 ${isMyPick ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-gray-800 bg-gray-900'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Clock size={16} className={isMyPick ? 'text-emerald-400' : 'text-gray-400'} />
            <div>
              <span className={`font-semibold ${isMyPick ? 'text-emerald-400' : 'text-white'}`}>
                {isMyPick ? '⭐ Your pick!' : `${teamOnClock.name} is on the clock`}
              </span>
              {!isMyPick && <p className="text-gray-500 text-xs">{teamOnClock.owner}</p>}
            </div>
          </div>
          <div className={`text-2xl font-bold font-mono ${timeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {timeLeft}s
          </div>
        </div>
        <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${timerColor}`}
            style={{ width: `${timerPercent}%` }}
          />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Player pool */}
        <div className="lg:col-span-2 rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <div className="p-3 border-b border-gray-800 space-y-2">
            <input
              type="text"
              placeholder="Search players…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex gap-1 overflow-x-auto pb-1">
              {positions.map(pos => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium flex-shrink-0 transition-colors
                    ${posFilter === pos ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-gray-800 text-gray-400 hover:text-white border border-transparent'}`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto max-h-[420px]">
            {filtered.slice(0, 30).map((player, i) => (
              <div key={player.id} className="flex items-center gap-3 px-3 py-2 border-b border-gray-800/60 hover:bg-gray-800/50 transition-colors">
                <span className="text-gray-600 text-xs w-5 flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <PlayerCard player={player} compact />
                </div>
                <button
                  onClick={() => isMyPick && draftPlayer(player)}
                  disabled={!isMyPick}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors
                    ${isMyPick
                      ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 cursor-pointer'
                      : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}
                >
                  Draft
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* My picks */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <div className="px-3 py-3 border-b border-gray-800 flex items-center gap-2">
            <Users size={14} className="text-emerald-400" />
            <span className="text-white text-sm font-medium">My Picks ({myPicks.length})</span>
          </div>
          <div className="overflow-y-auto max-h-[460px] divide-y divide-gray-800">
            {myPicks.length === 0 && (
              <div className="p-6 text-center text-gray-600 text-sm">
                No picks yet
              </div>
            )}
            {myPicks.map((pick, i) => {
              const p = draftPlayers.find(pl => pl.id === pick.playerId)!;
              return (
                <div key={pick.playerId} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-gray-600 text-xs w-5">{i + 1}.</span>
                  <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{p.name}</p>
                    <p className="text-gray-500 text-xs">{p.position} · {p.nflTeam}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Draft board teaser */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <ChevronRight size={14} className="text-gray-400" />
          <span className="text-white text-sm font-medium">Recent Picks</span>
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-2 p-3 min-w-max">
            {draftedPlayers.slice(-8).reverse().map((pick, i) => {
              const p = draftPlayers.find(pl => pl.id === pick.playerId)!;
              const t = teams.find(tm => tm.id === pick.teamId)!;
              return (
                <div key={i} className="w-28 rounded-lg bg-gray-800 border border-gray-700 p-2 text-center flex-shrink-0">
                  <p className="text-white text-xs font-medium truncate">{p?.name}</p>
                  <p className="text-gray-500 text-xs">{p?.position}</p>
                  <p className="text-emerald-400 text-xs mt-1 truncate">{t?.name}</p>
                </div>
              );
            })}
            {draftedPlayers.length === 0 && (
              <p className="text-gray-600 text-sm">Draft picks will appear here</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
