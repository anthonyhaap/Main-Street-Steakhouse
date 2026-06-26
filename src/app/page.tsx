import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 text-5xl">🏈</div>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">Gridiron League</h1>
      <p className="mt-4 max-w-xl text-lg text-slate-600">
        Invite-only fantasy football. Commissioners build a league and invite owners by
        email — each owner accepts to claim their team. No open sign-ups, no strangers.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/signup" className="btn-primary">
          Start a league
        </Link>
        <Link href="/login" className="btn-secondary">
          Log in
        </Link>
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Got an invite email? Open the link inside it to join.
      </p>
    </main>
  );
}
