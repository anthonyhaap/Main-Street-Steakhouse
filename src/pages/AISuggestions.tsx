import { useState } from 'react';
import { Brain, TrendingUp, ArrowRightLeft, Plus, Target, RefreshCw } from 'lucide-react';
import { aiSuggestions } from '../data/mockData';

const typeIcons = {
  waiver:  <Plus size={14} />,
  start:   <TrendingUp size={14} />,
  trade:   <ArrowRightLeft size={14} />,
  matchup: <Target size={14} />,
};

const typeColors = {
  waiver:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  start:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  trade:   'bg-orange-500/20 text-orange-400 border-orange-500/30',
  matchup: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const priorityColors = {
  high:   'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low:    'bg-gray-500/20 text-gray-400',
};

export default function AISuggestions() {
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'waiver' | 'start' | 'trade' | 'matchup'>('all');

  const visible = aiSuggestions.filter(s => !dismissed.includes(s.id) && (filter === 'all' || s.type === filter));

  function refresh() {
    setLoading(true);
    setTimeout(() => setLoading(false), 1200);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain size={24} className="text-purple-400" />
            AI Suggestions
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Personalized recommendations powered by AI · Updated every 15 min
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm hover:border-gray-600 hover:text-white transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* AI overview banner */}
      <div className="rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
            <Brain size={22} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold">Your team is performing well!</h3>
            <p className="text-gray-300 text-sm mt-1 leading-relaxed">
              You're <span className="text-emerald-400 font-medium">7-3</span> and on track for the playoffs.
              Your biggest advantage is quarterback play — Mahomes is averaging <span className="text-white font-medium">32.4 pts/game</span>.
              Focus on upgrading your RB2 to strengthen your playoff run.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'Team Grade',    value: 'A-',   color: 'text-emerald-400' },
            { label: 'Playoff Odds',  value: '89%',  color: 'text-blue-400' },
            { label: 'Championship', value: '22%',  color: 'text-purple-400' },
          ].map(s => (
            <div key={s.label} className="text-center rounded-lg bg-gray-900/50 py-2">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-gray-500 text-xs">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all', 'waiver', 'start', 'trade', 'matchup'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize flex-shrink-0 transition-colors border
              ${filter === f ? 'bg-purple-500/20 text-purple-400 border-purple-500/40' : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-white'}`}
          >
            {f === 'all' ? 'All Picks' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Suggestion cards */}
      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Brain size={36} className="mx-auto mb-3 opacity-30" />
            <p>No suggestions in this category</p>
          </div>
        )}
        {visible.map(suggestion => {
          const player = suggestion.player;
          return (
            <div
              key={suggestion.id}
              className="rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors overflow-hidden"
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-800/50">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${typeColors[suggestion.type]}`}>
                    {typeIcons[suggestion.type]}
                    {suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColors[suggestion.priority]}`}>
                    {suggestion.priority.toUpperCase()}
                  </span>
                </div>
                <button
                  onClick={() => setDismissed(d => [...d, suggestion.id])}
                  className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
                >
                  Dismiss
                </button>
              </div>

              {/* Body */}
              <div className="p-4">
                <h3 className="text-white font-semibold text-base mb-1">{suggestion.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{suggestion.description}</p>

                {/* Player info */}
                <div className="mt-3 flex items-center gap-3 p-3 bg-gray-800/60 rounded-lg">
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 font-bold text-sm flex-shrink-0">
                    {player.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{player.name}</p>
                    <p className="text-gray-500 text-xs">{player.position} · {player.nflTeam}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm font-bold">{player.projectedPoints.toFixed(1)}</p>
                    <p className="text-gray-500 text-xs">proj pts</p>
                  </div>
                </div>

                {/* Confidence */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                    <span>AI Confidence</span>
                    <span className="text-purple-400 font-semibold">{suggestion.confidence}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-500"
                      style={{ width: `${suggestion.confidence}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-4 flex gap-2">
                  <button className="flex-1 py-2 rounded-lg bg-purple-500/15 text-purple-400 text-sm font-medium hover:bg-purple-500/25 transition-colors border border-purple-500/30">
                    Apply Suggestion
                  </button>
                  <button className="px-4 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-medium hover:bg-gray-700 hover:text-white transition-colors">
                    Details
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Matchup preview */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Target size={15} className="text-purple-400" />
            This Week's Matchup Analysis
          </h3>
        </div>
        <div className="p-4 space-y-3">
          {[
            { label: 'Projected Win',     value: '67%',   color: 'text-emerald-400', bar: 67 },
            { label: 'Ceiling Match',     value: '72%',   color: 'text-blue-400',    bar: 72 },
            { label: 'Floor Protection',  value: '81%',   color: 'text-yellow-400',  bar: 81 },
          ].map(s => (
            <div key={s.label}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-gray-400">{s.label}</span>
                <span className={`font-bold ${s.color}`}>{s.value}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-800">
                <div className={`h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400`} style={{ width: `${s.bar}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
