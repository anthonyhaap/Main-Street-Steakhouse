"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { acceptInvite } from "@/lib/actions/invites";
import { SubmitButton } from "@/components/SubmitButton";
import { Alert } from "@/components/Alert";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, formAction] = useFormState(acceptInvite, undefined);
  // New owners pick a username; people who already have an account just log in.
  const [hasAccount, setHasAccount] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" value={email} disabled className="input bg-slate-100" />
        <p className="mt-1 text-xs text-slate-400">
          This invite is tied to your email. It becomes your login.
        </p>
      </div>

      {!hasAccount && (
        <div>
          <label className="label" htmlFor="username">
            Choose a username <span className="text-slate-400">(public handle)</span>
          </label>
          <input
            id="username"
            name="username"
            type="text"
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_]+"
            required={!hasAccount}
            className="input"
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="password">
          {hasAccount ? "Your password" : "Create a password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={hasAccount ? "current-password" : "new-password"}
          required
          minLength={8}
          className="input"
        />
      </div>

      <SubmitButton className="btn-primary w-full" pendingText="Joining league…">
        Accept &amp; join
      </SubmitButton>

      <button
        type="button"
        onClick={() => setHasAccount((v) => !v)}
        className="block w-full text-center text-sm text-turf-600 hover:underline"
      >
        {hasAccount
          ? "New here? Create an account instead"
          : "Already have an account? Log in to join"}
      </button>
    </form>
  );
}
