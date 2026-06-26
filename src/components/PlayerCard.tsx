import type { Player } from '../data/mockData';

interface Props {
  player: Player;
  compact?: boolean;
}

const statusColors = {
  active:       'bg-emerald-500/20 text-emerald-400',
  questionable: 'bg-yellow-500/20 text-yellow-400',
  out:          'bg-red-500/20 text-red-400',
  bye:          'bg-gray-500/20 text-gray-400',
};

const positionColors: Record<string, string> = {
  QB:  'bg-purple-500/20 text-purple-400',
  RB:  'bg-blue-500/20 text-blue-400',
  WR:  'bg-emerald-500/20 text-emerald-400',
  TE:  'bg-orange-500/20 text-orange-400',
  K:   'bg-gray-500/20 text-gray-400',
  DEF: 'bg-red-500/20 text-red-400',
};

export default function PlayerCard({ player, compact = false }: Props) {
  return (
    <div className={`flex items-center gap-3 ${compact ? 'py-2' : 'p-3 bg-gray-800/60 rounded-xl border border-gray-700/50 hover:border-gray-600 transition-colors'}`}>
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-sm font-bold text-gray-300">
        {player.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-medium truncate">{player.name}</p>
          <span className={`text-xs px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${positionColors[player.position]}`}>
            {player.position}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-gray-400 text-xs">{player.nflTeam}</span>
          <span className={`text-xs px-1.5 rounded-sm ${statusColors[player.status]}`}>
            {player.status === 'active' ? '' : player.status.charAt(0).toUpperCase() + player.status.slice(1)}
          </span>
        </div>
      </div>

      {/* Points */}
      <div className="text-right flex-shrink-0">
        <p className="text-white font-bold text-sm">
          {player.points > 0 ? player.points.toFixed(1) : '—'}
        </p>
        <p className="text-gray-500 text-xs">proj {player.projectedPoints.toFixed(1)}</p>
      </div>
    </div>
  );
}
