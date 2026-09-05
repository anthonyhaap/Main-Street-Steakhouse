"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/AuthFrame";
import { enterThroughDoors } from "@/components/Doors";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The token in the link is the whole credential. The screen used to take an
  // address instead and ask the database whether it was on the list, which
  // answered that question for any address to anyone who opened the page.
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ team: string; league: string; manager: string | null } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const t = params.get("t");
    setToken(t);
    if (!t) { setChecking(false); return; }

    let alive = true;
    void supabaseBrowser()
      .rpc("ff_invite_preview", { p_token: t })
      .then(({ data }) => {
        if (!alive) return;
        setInvite((data as { team: string; league: string; manager: string | null } | null) ?? null);
        setChecking(false);
      });
    return () => { alive = false; };
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) return;
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those two passwords don't match.");

    setBusy(true);
    const supabase = supabaseBrowser();
    const addr = email.trim().toLowerCase();

    const { data, error: signUpError } = await supabase.auth.signUp({ email: addr, password });

    // Somebody opening their link on a second device already has an account.
    // Signing them in with what they just typed is the same intent, so the one
    // form covers both rather than sending them away to come back.
    if (signUpError && /already registered/i.test(signUpError.message)) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: addr, password });
      if (signInError) {
        setBusy(false);
        return setError("You already have an account with that email, and that password doesn't match it.");
      }
    } else if (signUpError) {
      setBusy(false);
      return setError(signUpError.message);
    } else if (!data.session) {
      setBusy(false);
      return setError("Account made, but this project still requires email confirmation. Ask your commissioner to switch off Confirm Email in Supabase.");
    }

    const { error: claimError } = await supabase.rpc("ff_claim_invite", { p_token: token });
    if (claimError) {
      setBusy(false);
      return setError(claimError.message);
    }

    // The doors take the screen from here, and the form lets go under the white.
    enterThroughDoors(() => {
      setBusy(false);
      router.push("/welcome");
      router.refresh();
    });
  }

  if (checking) return null;

  // A missing, wrong, spent or already-claimed token all land here, saying the
  // same thing. Distinguishing them would rebuild the oracle in a smaller form:
  // "that link is spent" tells a guesser they found a real one.
  if (!token || !invite) {
    return (
      <div>
        <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "0 0 10px" }}>
          This link won&apos;t open
        </h1>
        <p className="prose" style={{ margin: "0 0 26px", fontSize: "var(--t-body)" }}>
          Invite links are single use, and they stop working once the team behind
          them has been claimed. Ask your commissioner to send you a fresh one.
        </p>
        <p style={{ fontSize: "var(--t-small)", color: "var(--dim)" }}>
          Already set up? <Link href="/login" style={{ color: "var(--gold)" }}>Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "0 0 10px" }}>
        Claim {invite.team}
      </h1>

      <p className="prose" style={{ margin: "0 0 26px", fontSize: "var(--t-body)" }}>
        {invite.manager ? `${invite.manager} — this` : "This"} link is yours alone,
        and it works once. Set a password and you&apos;re in{invite.league ? ` to ${invite.league}` : ""}.
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
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <label className="eyebrow" htmlFor="pw" style={{ display: "block", margin: "18px 0 7px" }}>
        Choose a password
      </label>
      <input
        id="pw"
        className="field"
        type="password"
        required
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
