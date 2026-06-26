import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { requireProfile } from "@/lib/data";
import { CreateLeagueForm } from "./CreateLeagueForm";

export default async function NewLeaguePage() {
  const { profile } = await requireProfile();

  return (
    <div className="min-h-screen">
      <Navbar username={profile.username} />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Create a league</h1>
        <p className="mb-6 text-sm text-slate-500">
          You&apos;ll be the commissioner. Add team slots now or later — you assign each
          team to an owner when they accept their invite.
        </p>
        <div className="card">
          <CreateLeagueForm />
        </div>
      </main>
    </div>
  );
}
