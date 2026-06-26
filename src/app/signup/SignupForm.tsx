"use client";

import { useFormState } from "react-dom";
import { signUp } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { Alert } from "@/components/Alert";

export function SignupForm() {
  const [state, formAction] = useFormState(signUp, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Alert>{state.error}</Alert>}
      <div>
        <label className="label" htmlFor="email">
          Email <span className="text-slate-400">(your login)</span>
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="username">
          Username <span className="text-slate-400">(your public handle)</span>
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-zA-Z0-9_]+"
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="fullName">
          Full name <span className="text-slate-400">(optional)</span>
        </label>
        <input id="fullName" name="fullName" type="text" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
        />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
