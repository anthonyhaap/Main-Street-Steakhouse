import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="text-4xl">🏈</div>
        <h1 className="mt-2 text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-slate-500">Log in to your fantasy leagues</p>
      </div>
      <div className="card">
        <LoginForm redirectTo={searchParams.redirect} />
      </div>
      <p className="mt-4 text-center text-sm text-slate-500">
        Need to start a league?{" "}
        <Link href="/signup" className="font-medium text-turf-600 hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
