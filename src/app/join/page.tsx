"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/AuthFrame";
import { enterThroughDoors } from "@/components/Doors";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The invite link carries the address the commissioner registered, so the
  // manager never has to remember which of their emails is on the team.
  useEffect(() => {
    const fromLink = params.get("email");
    if (fromLink) {
      setEmail(fromLink.trim().toLowerCase());
      setLocked(true);
    }
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those two passwords don't match.");

    setBusy(true);
    const supabase = supabaseBrowser();
    const addr = email.trim().toLowerCase();

    const { data: invited, error: checkError } = await supabase.rpc("ff_email_invited", {
      p_email: addr,
    });
    if (checkError) { setBusy(false); return setError(checkError.message); }
    if (!invited) {
      setBusy(false);
      return setError("That email isn't on the league's invite list. Ask your commissioner to add it, then try again.");
    }

    const { data, error: signUpError } = await supabase.auth.signUp({ email: addr, password });

    if (signUpError) {
      setBusy(false);
      return setError(
        /already registered/i.test(signUpError.message)
          ? "You already have an account — sign in instead."
          : signUpError.message,
      );
    }
    if (!data.session) {
      setBusy(false);
      return setError("Account made, but this project still requires email confirmation. Ask your commissioner to switch off Confirm Email in Supabase.");
    }

    await supabase.rpc("ff_link_me");

    // The doors take the screen from here, and the form lets go under the white.
    enterThroughDoors(() => {
      setBusy(false);
      router.push("/welcome");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "0 0 10px" }}>
        Claim your team
      </h1>

      <p className="prose" style={{ margin: "0 0 26px", fontSize: "var(--t-body)" }}>
        Set a password and you&apos;re in. That&apos;s the whole thing — nothing else
        gets emailed to you.
      </p>

      <label className="eyebrow" htmlFor="email" style={{ display: "block", marginBottom: 7 }}>
        Your email
      </label>
      <div style={{ position: "relative" }}>
        <input
          id="email"
          className="field"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          readOnly={locked}
          onChange={(e) => setEmail(e.target.value)}
          style={locked ? { paddingRight: 40, color: "var(--muted)" } : undefined}
        />
        {locked && (
          <Lock
            size={14}
            style={{ position: "absolute", right: 13, top: 14, color: "var(--faint)" }}
            aria-label="Set by your invite"
          />
        )}
      </div>

      <label className="eyebrow" htmlFor="pw" style={{ display: "block", margin: "18px 0 7px" }}>
        Choose a password
      </label>
      <input
        id="pw"
        className="field"
        type="password"
        required
        autoFocus={locked}
        autoComplete="new-password"
        placeholder="At least 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="field"
        style={{ marginTop: 9 }}
        type="password"
        required
        autoComplete="new-password"
        placeholder="Confirm password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <button className="btn" data-v="primary" style={{ width: "100%", marginTop: 18, minHeight: 46 }} disabled={busy}>
        {busy ? "Setting up…" : "Enter the league"}
      </button>

      {error && (
        <p style={{ color: "var(--lose)", fontSize: "var(--t-small)", marginTop: 14, lineHeight: 1.6 }} role="alert">
          {error}
        </p>
      )}

      <p style={{ marginTop: 24, fontSize: "var(--t-small)", color: "var(--dim)" }}>
        Already set up? <Link href="/login" style={{ color: "var(--gold)" }}>Sign in</Link>
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", borderTop: "1px solid var(--rule)", paddingTop: 18, display: "grid", gap: 9 }}>
        {[
          "Your roster, your queue, your matchups — private to you.",
          "Live draft board and scoring on any device.",
          "No app to install.",
        ].map((line) => (
          <li key={line} style={{ display: "flex", gap: 9, color: "var(--dim)", fontSize: "var(--t-small)", lineHeight: 1.5 }}>
            <Check size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--gold-dim)" }} />
            {line}
          </li>
        ))}
      </ul>
    </form>
  );
}

export default function Page() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <JoinForm />
      </Suspense>
    </AuthFrame>
  );
}
