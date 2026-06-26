import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, Users, Zap, Brain, ChevronRight } from 'lucide-react';
import { teams, currentMatchups, players, aiSuggestions } from '../data/mockData';
import StatCard from '../components/StatCard';

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
    </span>
  );
}

export default function Dashboard() {
  const [tick, setTick] = useState(0);

  // Simulate live score updates
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 8000);
    return () => clearInterval(id);
  }, []);

  const myTeam = teams.find(t => t.isMyTeam)!;
  const myMatchup = currentMatchups[0];
  const opponent = teams.find(t => t.id === myMatchup.awayTeamId)!;

  // Simulate slight score drift each tick
  const liveOffset = (tick % 3) * 0.4;
  const myLiveScore = myMatchup.homeScore + liveOffset;
  const oppLiveScore = myMatchup.awayScore + (tick % 2) * 0.3;

  const topScorer = [...players].filter(p => p.owner === 'My Team').sort((a, b) => b.points - a.points)[0];
  const topAI = aiSuggestions[0];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">Week 11 · Thursday Night</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-emerald-400 font-medium">
          <LiveDot />
          <span>Live</span>
        </div>
      </div>

      {/* My live matchup hero card */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-emerald-500/30 p-6">
        <div className="flex items-center gap-2 mb-4">
          <LiveDot />
          <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wide">Live Matchup · Week 11</span>
        </div>
        <div className="flex items-center justify-between">
          {/* Home */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg mx-auto mb-2">
              MY
            </div>
            <p className="text-white font-semibold text-sm">{myTeam.name}</p>
            <p className={`text-3xl font-bold mt-1 ${myLiveScore > oppLiveScore ? 'text-emerald-400' : 'text-white'}`}>
              {myLiveScore.toFixed(1)}
            </p>
            <p className="text-gray-500 text-xs mt-1">proj 162.4</p>
          </div>

          {/* VS */}
          <div className="text-center">
            <div className="text-gray-600 text-xl font-bold">VS</div>
            <div className="mt-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-emerald-400 text-xs font-medium">W2 go</span>
            </div>
          </div>

          {/* Away */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 font-bold text-lg mx-auto mb-2">
              GG
            </div>
            <p className="text-white font-semibold text-sm">{opponent.name}</p>
            <p className={`text-3xl font-bold mt-1 ${oppLiveScore > myLiveScore ? 'text-red-400' : 'text-white'}`}>
              {oppLiveScore.toFixed(1)}
            </p>
            <p className="text-gray-500 text-xs mt-1">proj 144.8</p>
          </div>
        </div>

        {/* Win probability bar */}
        <div className="mt-5">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Win Prob</span>
            <span className="text-emerald-400 font-medium">67%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-1000" style={{ width: '67%' }} />
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          value={`${myTeam.wins}-${myTeam.losses}`}
          label="Record"
          sublabel="1st place"
          accent="green"
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          value={myTeam.pointsFor.toFixed(0)}
          label="Points For"
          sublabel="Avg 124.9/wk"
          accent="blue"
          icon={<Activity size={20} />}
        />
        <StatCard
          value={topScorer.points.toFixed(1)}
          label="Top Scorer"
          sublabel={topScorer.name}
          accent="yellow"
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          value={myTeam.pointsAgainst.toFixed(0)}
          label="Points Against"
          sublabel="2nd lowest"
          accent="default"
          icon={<TrendingDown size={20} />}
        />
      </div>

      {/* Live scores + AI tip side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* All matchups */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <Activity size={15} className="text-emerald-400" />
              Live Scores
            </h2>
            <Link to="/standings" className="text-emerald-400 text-xs hover:text-emerald-300 flex items-center gap-1">
              All <ChevronRight size={13} />
            </Link>
          </div>
          <div className="divide-y divide-gray-800">
            {currentMatchups.map(m => {
              const home = teams.find(t => t.id === m.homeTeamId)!;
              const away = teams.find(t => t.id === m.awayTeamId)!;
              const homeAdj = m.id === 1 ? myLiveScore : m.homeScore;
              const awayAdj = m.id === 1 ? oppLiveScore : m.awayScore;
              return (
                <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                  {m.isLive && <LiveDot />}
                  {!m.isLive && <span className="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0" />}
                  <div className="flex-1 flex items-center justify-between text-sm">
                    <div>
                      <span className={homeAdj > awayAdj ? 'text-white font-medium' : 'text-gray-400'}>{home.name}</span>
                      <span className="text-gray-600 mx-2">vs</span>
                      <span className={awayAdj > homeAdj ? 'text-white font-medium' : 'text-gray-400'}>{away.name}</span>
                    </div>
                    <div className="font-mono text-xs text-gray-300">
                      <span className={homeAdj > awayAdj ? 'text-emerald-400' : ''}>{homeAdj.toFixed(1)}</span>
                      <span className="text-gray-600 mx-1">—</span>
                      <span className={awayAdj > homeAdj ? 'text-emerald-400' : ''}>{awayAdj.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI tip */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <Brain size={15} className="text-purple-400" />
              Top AI Suggestion
            </h2>
            <Link to="/ai" className="text-purple-400 text-xs hover:text-purple-300 flex items-center gap-1">
              All picks <ChevronRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
                <Brain size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-semibold text-sm">{topAI.title}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                    {topAI.priority.toUpperCase()}
                  </span>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">{topAI.description}</p>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>AI Confidence</span>
                    <span className="text-purple-400 font-medium">{topAI.confidence}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-700">
                    <div
                      className="h-full rounded-full bg-purple-500"
                      style={{ width: `${topAI.confidence}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/my-team',   icon: Users,      label: 'Manage Roster',  iconClass: 'bg-blue-500/15 text-blue-400 group-hover:bg-blue-500/25' },
          { to: '/draft',     icon: Zap,        label: 'Draft Room',     iconClass: 'bg-yellow-500/15 text-yellow-400 group-hover:bg-yellow-500/25' },
          { to: '/ai',        icon: Brain,      label: 'AI Suggestions', iconClass: 'bg-purple-500/15 text-purple-400 group-hover:bg-purple-500/25' },
          { to: '/standings', icon: TrendingUp, label: 'Standings',      iconClass: 'bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25' },
        ].map(({ to, icon: Icon, label, iconClass }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors group"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${iconClass}`}>
              <Icon size={18} />
            </div>
            <span className="text-gray-300 text-xs text-center group-hover:text-white transition-colors">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
