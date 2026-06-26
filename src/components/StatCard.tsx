interface Props {
  value: string | number;
  label: string;
  sublabel?: string;
  accent?: 'green' | 'blue' | 'yellow' | 'red' | 'default';
  icon?: React.ReactNode;
}

const accentClasses = {
  green:   'border-emerald-500/30 bg-emerald-500/5',
  blue:    'border-blue-500/30 bg-blue-500/5',
  yellow:  'border-yellow-500/30 bg-yellow-500/5',
  red:     'border-red-500/30 bg-red-500/5',
  default: 'border-gray-700/50 bg-gray-800/60',
};

const valueClasses = {
  green:   'text-emerald-400',
  blue:    'text-blue-400',
  yellow:  'text-yellow-400',
  red:     'text-red-400',
  default: 'text-white',
};

export default function StatCard({ value, label, sublabel, accent = 'default', icon }: Props) {
  return (
    <div className={`rounded-xl border p-4 ${accentClasses[accent]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-2xl font-bold ${valueClasses[accent]}`}>{value}</p>
          <p className="text-gray-400 text-sm mt-0.5">{label}</p>
          {sublabel && <p className="text-gray-600 text-xs mt-0.5">{sublabel}</p>}
        </div>
        {icon && <div className="text-gray-500">{icon}</div>}
      </div>
    </div>
  );
}
