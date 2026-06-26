"use client";

import { useFormState } from "react-dom";
import { createInvite } from "@/lib/actions/invites";
import { SubmitButton } from "@/components/SubmitButton";
import { Alert } from "@/components/Alert";
import type { FantasyTeam } from "@/lib/types";

export function InviteForm({
  leagueId,
  openTeams,
}: {
  leagueId: string;
  openTeams: FantasyTeam[];
}) {
  const [state, formAction] = useFormState(createInvite, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {state && "error" in state && <Alert>{state.error}</Alert>}
      {state && "ok" in state && <Alert kind="success">{state.ok}</Alert>}

      <input type="hidden" name="leagueId" value={leagueId} />

      <div>
        <label className="label" htmlFor="email">
          Owner email
        </label>
        <input id="email" name="email" type="email" required className="input" />
      </div>

      <div>
        <label className="label" htmlFor="role">
          Role
        </label>
        <select id="role" name="role" className="input" defaultValue="owner">
          <option value="owner">Owner — manages a team</option>
          <option value="viewer">Viewer — read only</option>
        </select>
      </div>

      <div>
        <label className="label" htmlFor="teamId">
          Assign team <span className="text-slate-400">(optional)</span>
        </label>
        <select id="teamId" name="teamId" className="input" defaultValue="">
          <option value="">— No team yet —</option>
          {openTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="newTeamName">
          …or create a new team <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="newTeamName"
          name="newTeamName"
          type="text"
          placeholder="e.g. Gridiron Goblins"
          maxLength={60}
          className="input"
        />
      </div>

      <SubmitButton className="btn-primary w-full" pendingText="Sending…">
        Send invite
      </SubmitButton>
    </form>
  );
}
