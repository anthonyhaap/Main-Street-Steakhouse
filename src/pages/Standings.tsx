import { teams, currentMatchups } from '../data/mockData';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function Standings() {
  const sorted = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Standings</h1>
        <p className="text-gray-400 text-sm mt-0.5">Week 11 · Regular Season</p>
      </div>

      {/* Standings table */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider">#</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider">Team</th>
                <th className="text-center text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider">W</th>
                <th className="text-center text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider">L</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider hidden sm:table-cell">PF</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider hidden md:table-cell">PA</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3 text-xs uppercase tracking-wider hidden lg:table-cell">Streak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {sorted.map((team, i) => {
                const isMe = team.isMyTeam;
                const place = i + 1;
                const isPlayoff = place <= 4;
                const trend = place <= 4 ? <TrendingUp size={13} className="text-emerald-400" /> : <TrendingDown size={13} className="text-red-400" />;

                return (
                  <tr
                    key={team.id}
                    className={`transition-colors ${isMe ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : 'hover:bg-gray-800/50'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${isPlayoff ? 'text-emerald-400' : 'text-gray-500'}`}>{place}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isMe ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-300'}`}>
                          {team.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className={`font-medium ${isMe ? 'text-emerald-400' : 'text-white'}`}>
                            {team.name} {isMe && <span className="text-xs">(You)</span>}
                          </p>
                          <p className="text-gray-500 text-xs">{team.owner}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-4 py-3 text-white font-bold">{team.wins}</td>
                    <td className="text-center px-4 py-3 text-gray-400">{team.losses}</td>
                    <td className="text-right px-4 py-3 text-gray-300 hidden sm:table-cell">{team.pointsFor.toFixed(1)}</td>
                    <td className="text-right px-4 py-3 text-gray-500 hidden md:table-cell">{team.pointsAgainst.toFixed(1)}</td>
                    <td className="text-right px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center justify-end">{trend}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-emerald-500/40" />
            <span>Playoff position (Top 4)</span>
          </div>
        </div>
      </div>

      {/* This week matchups */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Week 11 Matchups</h2>
        <div className="space-y-3">
          {currentMatchups.map(m => {
            const home = teams.find(t => t.id === m.homeTeamId)!;
            const away = teams.find(t => t.id === m.awayTeamId)!;
            const homeWin = m.homeScore > m.awayScore;
            return (
              <div key={m.id} className="rounded-xl bg-gray-900 border border-gray-800 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${home.isMyTeam ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-300'}`}>
                      {home.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${home.isMyTeam ? 'text-emerald-400' : 'text-white'}`}>{home.name}</p>
                      <p className="text-gray-500 text-xs">{home.owner}</p>
                    </div>
                  </div>

                  <div className="text-center px-4">
                    <div className="flex items-center gap-2 font-mono font-bold">
                      <span className={homeWin ? 'text-emerald-400' : 'text-gray-300'}>{m.homeScore.toFixed(1)}</span>
                      <span className="text-gray-600">—</span>
                      <span className={!homeWin ? 'text-emerald-400' : 'text-gray-300'}>{m.awayScore.toFixed(1)}</span>
                    </div>
                    {m.isLive && (
                      <div className="flex items-center justify-center gap-1 mt-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                        </span>
                        <span className="text-emerald-400 text-xs">Live</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-1 justify-end">
                    <div className="text-right">
                      <p className="text-sm font-medium text-white">{away.name}</p>
                      <p className="text-gray-500 text-xs">{away.owner}</p>
                    </div>
                    <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 text-xs font-bold">
                      {away.name.slice(0, 2).toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
