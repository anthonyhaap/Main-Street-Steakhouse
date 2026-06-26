import Link from "next/link";
import { SignOutButton } from "./SignOutButton";

export function Navbar({ username }: { username?: string | null }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-slate-900">
          <span>🏈</span> Gridiron League
        </Link>
        <div className="flex items-center gap-4">
          {username && <span className="text-sm text-slate-500">@{username}</span>}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
