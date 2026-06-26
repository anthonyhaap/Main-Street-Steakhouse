import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Zap,
  Trophy,
  Brain,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/',          label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/my-team',   label: 'My Team',    icon: Users },
  { to: '/draft',     label: 'Draft Room', icon: Zap },
  { to: '/standings', label: 'Standings',  icon: Trophy },
  { to: '/ai',        label: 'AI Picks',   icon: Brain },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between bg-gray-900 border-b border-gray-800 px-4 h-14">
        <span className="text-emerald-400 font-bold text-lg tracking-tight">🏈 Main St. FF</span>
        <button onClick={() => setOpen(!open)} className="text-gray-400 hover:text-white">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-60 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <span className="text-2xl">🏈</span>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Main Street</p>
            <p className="text-emerald-400 font-bold text-sm leading-tight">Fantasy Football</p>
          </div>
        </div>

        {/* Week badge */}
        <div className="mx-4 mt-4 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
          <p className="text-xs text-emerald-400 font-semibold">WEEK 11 • LIVE</p>
          <p className="text-xs text-gray-400 mt-0.5">4 of 4 matchups active</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 mt-5 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm">
              Y
            </div>
            <div>
              <p className="text-white text-xs font-medium">You</p>
              <p className="text-gray-500 text-xs">My Team · 7-3</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
