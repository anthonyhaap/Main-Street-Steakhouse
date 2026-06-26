"use client";

import { useFormState } from "react-dom";
import { renameTeam } from "@/lib/actions/teams";
import { SubmitButton } from "@/components/SubmitButton";
import { Alert } from "@/components/Alert";

export function MyTeamForm({
  leagueId,
  teamId,
  currentName,
}: {
  leagueId: string;
  teamId: string;
  currentName: string;
}) {
  const [state, formAction] = useFormState(renameTeam, undefined);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="teamId" value={teamId} />
      <div>
        <label className="label" htmlFor="name">
          Team name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={currentName}
          required
          maxLength={60}
          className="input"
        />
      </div>
      <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
    </form>
  );
}
