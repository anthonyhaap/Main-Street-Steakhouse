import Link from "next/link";

interface Tab {
  href: string;
  label: string;
  commissionerOnly?: boolean;
}

export function LeagueNav({
  leagueId,
  isCommissioner,
  active,
}: {
  leagueId: string;
  isCommissioner: boolean;
  active: string;
}) {
  const base = `/leagues/${leagueId}`;
  const tabs: Tab[] = [
    { href: base, label: "Overview" },
    { href: `${base}/my-team`, label: "My Team" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/teams`, label: "Assign Teams", commissionerOnly: true },
    { href: `${base}/invite`, label: "Invite Owners", commissionerOnly: true },
  ];

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs
        .filter((t) => !t.commissionerOnly || isCommissioner)
        .map((t) => {
          const isActive = t.label === active;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? "border-turf-500 text-turf-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}
