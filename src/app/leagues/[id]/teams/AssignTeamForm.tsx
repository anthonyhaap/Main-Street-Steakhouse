"use client";

import { useFormState } from "react-dom";
import { assignTeam } from "@/lib/actions/teams";

export function AssignTeamForm({
  leagueId,
  teamId,
  currentOwnerId,
  owners,
}: {
  leagueId: string;
  teamId: string;
  currentOwnerId: string | null;
  owners: { userId: string; username: string }[];
}) {
  const [state, formAction] = useFormState(assignTeam, undefined);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="teamId" value={teamId} />
      <select name="userId" defaultValue={currentOwnerId ?? ""} className="input py-2">
        <option value="">— Unassigned —</option>
        {owners.map((o) => (
          <option key={o.userId} value={o.userId}>
            @{o.username}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-primary px-3 py-2 text-xs">
        Assign
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
