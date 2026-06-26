import { useState } from 'react';
import { AlertCircle, TrendingUp, Plus } from 'lucide-react';
import { players, teams } from '../data/mockData';
import PlayerCard from '../components/PlayerCard';

const STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'];
const BENCH_COUNT = 6;

export default function MyTeam() {
  const myTeam = teams.find(t => t.isMyTeam)!;
  const roster = players.filter(p => p.owner === 'My Team');

  const starters = roster.slice(0, 9);
  const bench = roster.slice(9);

  const [activeTab, setActiveTab] = useState<'roster' | 'waiver'>('roster');

  const totalPoints = starters.reduce((s, p) => s + p.points, 0);
  const projectedTotal = starters.reduce((s, p) => s + p.projectedPoints, 0);

  const freeAgents = players.filter(p => !p.owner).slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{myTeam.name}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{myTeam.owner} · Week 11</p>
        </div>
        <div className="flex gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-400">{myTeam.wins}-{myTeam.losses}</p>
            <p className="text-gray-500 text-xs">Record</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{totalPoints.toFixed(1)}</p>
            <p className="text-gray-500 text-xs">Live Pts</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
        {(['roster', 'waiver'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors capitalize
              ${activeTab === tab ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-400 hover:text-white'}`}
          >
            {tab === 'roster' ? 'My Roster' : 'Waiver Wire'}
          </button>
        ))}
      </div>

      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Injury/Bye alerts */}
          {roster.filter(p => p.status !== 'active').length > 0 && (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-3 flex items-start gap-3">
              <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-yellow-300 text-sm font-medium">Roster Alerts</p>
                <p className="text-yellow-400/70 text-xs mt-0.5">
                  {roster.filter(p => p.status === 'questionable').map(p => p.name).join(', ')} — Questionable &nbsp;|&nbsp;
                  {roster.filter(p => p.status === 'bye').map(p => p.name).join(', ')} — On Bye
                </p>
              </div>
            </div>
          )}

          {/* Projected total */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" />
              <span className="text-gray-400 text-sm">Projected Total</span>
            </div>
            <span className="text-white font-bold">{projectedTotal.toFixed(1)} pts</span>
          </div>

          {/* Starters */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 px-1">Starters</h3>
            <div className="space-y-1">
              {starters.map((player, i) => (
                <div key={player.id} className="flex items-center gap-2">
                  <span className="text-gray-600 text-xs w-7 text-right flex-shrink-0">{STARTERS[i]}</span>
                  <div className="flex-1">
                    <PlayerCard player={player} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bench */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 px-1">
              Bench ({bench.length}/{BENCH_COUNT})
            </h3>
            <div className="space-y-1">
              {bench.map(player => (
                <div key={player.id} className="flex items-center gap-2">
                  <span className="text-gray-600 text-xs w-7 text-right flex-shrink-0">BN</span>
                  <div className="flex-1">
                    <PlayerCard player={player} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'waiver' && (
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">Available players — sorted by projected points</p>
          <div className="space-y-2">
            {freeAgents.map(player => (
              <div key={player.id} className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors">
                <div className="flex-1">
                  <PlayerCard player={player} compact />
                </div>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-colors">
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
