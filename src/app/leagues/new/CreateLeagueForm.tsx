"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { createLeague } from "@/lib/actions/leagues";
import { SubmitButton } from "@/components/SubmitButton";
import { Alert } from "@/components/Alert";

export function CreateLeagueForm() {
  const [state, formAction] = useFormState(createLeague, undefined);
  const [teams, setTeams] = useState<string[]>(["", ""]);

  function updateTeam(i: number, value: string) {
    setTeams((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && <Alert>{state.error}</Alert>}
      <div>
        <label className="label" htmlFor="name">
          League name
        </label>
        <input id="name" name="name" type="text" required maxLength={80} className="input" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="season">
            Season <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="season"
            name="season"
            type="text"
            placeholder="2026"
            maxLength={20}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description <span className="text-slate-400">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2} maxLength={500} className="input" />
      </div>

      <div>
        <label className="label">Team slots</label>
        <p className="mb-2 text-xs text-slate-400">
          Name the teams in your league. You can add or rename them later.
        </p>
        <div className="space-y-2">
          {teams.map((team, i) => (
            <div key={i} className="flex gap-2">
              <input
                name="teams"
                value={team}
                onChange={(e) => updateTeam(i, e.target.value)}
                placeholder={`Team ${i + 1}`}
                maxLength={60}
                className="input"
              />
              {teams.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTeams((prev) => prev.filter((_, idx) => idx !== i))}
                  className="btn-secondary px-3"
                  aria-label="Remove team"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTeams((prev) => [...prev, ""])}
          className="mt-2 text-sm font-medium text-turf-600 hover:underline"
        >
          + Add team
        </button>
      </div>

      <SubmitButton className="btn-primary w-full" pendingText="Creating…">
        Create league
      </SubmitButton>
    </form>
  );
}
