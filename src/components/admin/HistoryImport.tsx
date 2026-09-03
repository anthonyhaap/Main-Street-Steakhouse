"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_ID } from "@/lib/config";
import { useToast } from "@/components/ui";

/**
 * The old seasons, pasted in once.
 *
 * ESPN keeps the league's history behind its own login and there is no
 * export button, so this takes the plainest thing a spreadsheet can produce:
 * one row per game. Manager names are the key — spell them exactly as they
 * appear on the Managers card above, and the current season lines up with
 * the past ones on the wall.
 */
const COLUMNS = ["season", "week", "round", "home_manager", "home_team", "home_points", "away_manager", "away_team", "away_points"];

const EXAMPLE = [
  COLUMNS.join(","),
  "2016,1,regular,Anthony,Gridiron Butchers,128.4,Dave,The Porterhouse,101.2",
  "2016,15,semifinal,Dave,The Porterhouse,131.0,Mike,Prime Cut,119.6",
  "2016,16,final,Dave,The Porterhouse,142.8,Anthony,Gridiron Butchers,140.9",
].join("\n");

type Row = Record<string, string>;

function parse(text: string): { rows: Row[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ["Paste a header row and at least one game."] };
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const missing = ["season", "week", "home_manager", "home_points", "away_manager", "away_points"].filter((c) => !head.includes(c));
  if (missing.length) return { rows: [], errors: [`Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`] };

  const rows: Row[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Row = {};
    head.forEach((h, j) => { row[h] = cells[j] ?? ""; });
    if (!/^\d{4}$/.test(row.season) || !/^\d{1,2}$/.test(row.week)) errors.push(`Line ${i + 2}: season and week must be numbers.`);
    else if (!row.home_manager || !row.away_manager) errors.push(`Line ${i + 2}: both managers are required.`);
    else if (Number.isNaN(Number(row.home_points)) || Number.isNaN(Number(row.away_points))) errors.push(`Line ${i + 2}: points must be numbers.`);
    else rows.push(row);
  });
  return { rows, errors };
}

export function HistoryImport({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parse(text), [text]);
  const seasons = useMemo(() => [...new Set(parsed.rows.map((r) => r.season))].sort(), [parsed.rows]);

  async function submit() {
    if (!parsed.rows.length) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("ff_import_history", { p_league_id: LEAGUE_ID, p_rows: parsed.rows });
    setBusy(false);
    if (error) { toast("error", error.message); return; }
    const res = data as { rows: number; seasons: number[] };
    toast("ok", `${res.rows} games across ${res.seasons.length} season${res.seasons.length === 1 ? "" : "s"} are on the wall.`);
    setText("");
    onDone?.();
  }

  return (
    <div className="card__body import" style={{ display: "grid", gap: "var(--s3)" }}>
      <p className="prose" style={{ margin: 0, fontSize: "var(--t-small)" }}>
        One line per game, comma-separated, with this header. <code>round</code> is{" "}
        <code>regular</code>, <code>quarterfinal</code>, <code>semifinal</code>, <code>final</code>,{" "}
        <code>third</code> or <code>consolation</code>; the final is what puts a name on the plaque.
        Every season you paste replaces that season on the wall, so a corrected sheet can be pasted again.
      </p>
      <textarea
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        aria-label="History rows"
        spellCheck={false}
      />
      {text && parsed.errors.length > 0 && (
        <div className="note" data-kind="error" style={{ borderRadius: "var(--r-sm)" }}>
          {parsed.errors.slice(0, 4).map((e, i) => <div key={i}>{e}</div>)}
          {parsed.errors.length > 4 && <div>…and {parsed.errors.length - 4} more.</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--s3)", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" data-v="primary" disabled={busy || !parsed.rows.length || parsed.errors.length > 0} onClick={submit}>
          <Upload size={14} /> {busy ? "Hanging it up…" : "Put it on the wall"}
        </button>
        {parsed.rows.length > 0 && (
          <span className="eyebrow">{parsed.rows.length} games · {seasons.join(", ")}</span>
        )}
        <button className="btn" data-v="ghost" data-size="sm" onClick={() => setText(EXAMPLE)} disabled={busy}>
          Show an example
        </button>
      </div>
    </div>
  );
}
