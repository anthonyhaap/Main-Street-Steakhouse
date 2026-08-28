"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/AuthFrame";

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") ?? "/";
  const urlError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);

    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? "That email and password don't match. If you haven't set a password yet, use your invite link."
          : error.message,
      );
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "0 0 10px" }}>
        Welcome back
      </h1>

      <p className="prose" style={{ margin: "0 0 28px", fontSize: "var(--t-body)" }}>
        Sign in with the email your commissioner put on your team.
      </p>

      <label className="eyebrow" htmlFor="email" style={{ display: "block", marginBottom: 7 }}>Email</label>
      <input
        id="email" className="field" type="email" required autoFocus autoComplete="email"
        placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
      />

      <label className="eyebrow" htmlFor="pw" style={{ display: "block", margin: "18px 0 7px" }}>Password</label>
      <input
        id="pw" className="field" type="password" required autoComplete="current-password"
        placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
      />

      <button className="btn" data-v="primary" style={{ width: "100%", marginTop: 18, minHeight: 46 }} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>

      {(error || urlError) && (
        <p style={{ color: "var(--lose)", fontSize: "var(--t-small)", marginTop: 14, lineHeight: 1.6 }} role="alert">
          {error ?? urlError}
        </p>
      )}

      <p style={{ marginTop: 24, fontSize: "var(--t-small)", color: "var(--dim)" }}>
        Got an invite but no password yet?{" "}
        <Link href="/join" style={{ color: "var(--gold)" }}>Claim your team</Link>
      </p>
    </form>
  );
}

export default function Page() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
