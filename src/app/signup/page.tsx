import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="text-4xl">🏈</div>
        <h1 className="mt-2 text-2xl font-bold">Start your league</h1>
        <p className="text-sm text-slate-500">
          Create a commissioner account. You can invite owners next.
        </p>
      </div>
      <div className="card">
        <SignupForm />
      </div>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-turf-600 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
