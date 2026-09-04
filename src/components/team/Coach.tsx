"use client";

import { useEffect, useState } from "react";
import { CloudSun, Sparkles, X } from "lucide-react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { skyWord } from "@/lib/nfl/weather";
import type { Factor, LineupPlan, Valuation } from "@/lib/nfl/lineup";
import type { GameWeather } from "@/lib/nfl/venues";

/**
 * The coach's answer, shown before it is taken.
 *
 * The rule this screen is built around: it never changes anything on its own.
 * A lineup is the one thing in the app a manager is judged on at the end of the
 * week, and handing that to a model that silently rearranged nine slots is how
 * you lose him. So the plan is drawn first — every move, and the sentence
 * behind every move — and one button applies the lot.
 *
 * Which means the reasoning is the product, not the number. Anyone can print
 * "start Chase". The thing worth reading is *why*: the projection, the ankle,
 * the wind off the lake, the back ahead of him who is out. Those come out of
 * `buildLineup` as factors and are printed verbatim.
 */
export function Coach({
  plan, week, busy, weather, onApply, onClose,
}: {
  plan: LineupPlan;
  week: number;
  busy: boolean;
  weather: Map<string, GameWeather> | null;
  /** Absent where there is no team to write to — the fixture. */
  onApply?: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const changed = plan.slots.filter((s) => s.now?.player_id !== s.best?.player.player_id);
  const conditions = [...(weather?.values() ?? [])]
    .filter((w) => w.state === "forecast" || w.state === "indoors")
    .sort((a, b) => a.club.localeCompare(b.club));

  return (
    <div className="modal" role="dialog" aria-modal aria-label="Best lineup"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="modal__panel" data-wide="true">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Week {week}</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>
              {plan.moves.length === 0 ? "You are already there" : "The best lineup we can see"}
            </h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onClose}
            disabled={busy} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="th-strip" style={{ borderTop: 0 }}>
          <div className="th-stat">
            <b>{plan.now.toFixed(1)}</b>
            <span>Your lineup now</span>
          </div>
          <div className="th-stat">
            <b data-tone="gold">{plan.best.toFixed(1)}</b>
            <span>The best we can see</span>
          </div>
          <div className="th-stat">
            <b data-tone={plan.gain > 0.05 ? "ok" : undefined}>
              {plan.gain > 0.05 ? `+${plan.gain.toFixed(1)}` : "—"}
            </b>
            <span>Points on the table</span>
          </div>
        </div>

        <Sources plan={plan} />

        {plan.locked.length > 0 && (
          <div className="note" data-kind="info">
            {plan.locked.length === 1
              ? `${plan.locked[0].full_name} has already kicked off and stays where he is.`
              : `${plan.locked.length} players have already kicked off and stay where they are.`}
          </div>
        )}

        <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
          {/* ------------------------------------------------ the changes -- */}
          {plan.moves.length === 0 ? (
            <div className="empty" style={{ padding: "var(--s5) 0" }}>
              Nothing on the wire, the schedule or the forecast beats the lineup you
              already have.<br />Set it and enjoy the games.
            </div>
          ) : (
            <div className="coach">
              {changed.map((s) => (
                <div className="coach__change" key={s.key}>
                  <span className="pos" data-p={s.slot}>{s.slot}</span>
                  <div className="coach__pair">
                    <Side v={s.best} direction="in" />
                    <Side v={s.now ? plan.values.get(s.now.player_id) ?? null : null} direction="out" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ------------------------------------------- the whole lineup -- */}
          <div>
            <button className="btn" data-v="ghost" data-size="sm" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Hide" : "Show"} the full lineup
            </button>

            {showAll && (
              <div className="coach" style={{ marginTop: "var(--s3)" }}>
                {plan.slots.map((s) => (
                  <div className="coach__row" key={s.key}>
                    <span className="pos" data-p={s.slot}>{s.slot}</span>
                    {s.best ? <Line v={s.best} /> : (
                      <span style={{ color: "var(--lose)", fontStyle: "italic", fontSize: "var(--t-small)" }}>
                        Nobody eligible — this slot scores zero.
                      </span>
                    )}
                  </div>
                ))}

                {plan.bench.length > 0 && (
                  <div className="coach__rule">
                    <span className="eyebrow">Left out</span>
                  </div>
                )}
                {plan.bench.slice(0, 8).map((v) => (
                  <div className="coach__row" key={v.player.player_id}>
                    <span className="pos" data-p="BN">BN</span>
                    <Line v={v} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------------------------------------------- the forecast -- */}
          {conditions.length > 0 && (
            <div>
              <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CloudSun size={12} /> At kickoff
              </div>
              <div className="coach__sky">
                {conditions.map((w) => (
                  <span className="badge" data-tone="neutral" key={w.club} title={`${w.venue}, ${w.city}`}>
                    {w.club} · {skyWord(w)}
                    {w.temp_f != null ? ` ${Math.round(w.temp_f)}°` : ""}
                    {w.wind_mph != null && w.wind_mph >= 8 ? ` · ${Math.round(w.wind_mph)} mph` : ""}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: "var(--t-micro)", color: "var(--dim)", marginTop: 6 }}>
                Forecasts from Open-Meteo, taken for the hour of kickoff over the home stadium.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--s2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn" data-v="ghost" onClick={onClose} disabled={busy}>
              {plan.moves.length === 0 ? "Close" : "Leave it alone"}
            </button>
            {onApply && (
              <button className="btn" data-v="primary" onClick={onApply}
                disabled={busy || plan.moves.length === 0}>
                <Sparkles size={14} />
                {busy ? "Setting…" : plan.moves.length === 0 ? "Nothing to set" : "Set this lineup"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ parts -- */

/** One half of a change: who arrives, or who is stood down, and on what grounds. */
function Side({ v, direction }: { v: Valuation | null; direction: "in" | "out" }) {
  if (!v) {
    return (
      <div className="coach__side" data-dir={direction}>
        <span className="eyebrow">{direction === "in" ? "In" : "Out"}</span>
        <span style={{ color: "var(--dim)", fontSize: "var(--t-small)" }}>
          {direction === "in" ? "Nobody eligible" : "The slot was empty"}
        </span>
      </div>
    );
  }

  return (
    <div className="coach__side" data-dir={direction}>
      <span className="eyebrow">{direction === "in" ? "In" : "Out"}</span>
      <Line v={v} />
    </div>
  );
}

/** A player, his number, and every reason the number is not his projection. */
function Line({ v }: { v: Valuation }) {
  const p = v.player;
  return (
    <div className="coach__line">
      <PlayerBadge
        id={p.player_id}
        name={p.full_name}
        position={p.position}
        team={p.nfl_team}
        espnId={p.espn_id}
        size={34}
        sub={<span>{p.position} · {p.nfl_team ?? "FA"}</span>}
      />

      <span className="coach__pts num">
        {v.value.toFixed(1)}
        <span>
          {v.baseFrom === "projection" ? `from ${v.base.toFixed(1)} proj`
            : v.baseFrom === "form" ? `from ${v.base.toFixed(1)} form`
            : "nothing to go on"}
        </span>
      </span>

      <div className="coach__why">
        {v.blocked && (
          <span className="badge coach__blocked" data-tone="danger" data-solid="true">{v.blocked}</span>
        )}
        {v.factors.map((f, i) => (
          <span className="badge" key={i}
            data-tone={f.mult > 1.005 ? "ok" : f.mult < 0.995 ? "warn" : "neutral"}
            title={f.detail}>
            {f.label}
            {Math.abs(f.mult - 1) >= 0.005 && (
              <i style={{ fontStyle: "normal", opacity: 0.75 }}>
                {f.mult > 1 ? "+" : "−"}{Math.round(Math.abs(f.mult - 1) * 100)}%
              </i>
            )}
          </span>
        ))}
      </div>

      {/* Every chip carries its sentence in a tooltip; the one spelled out is
          whichever moved the number most, because that is the one the manager
          is being asked to agree with. A tooltip is not an argument on a
          phone. */}
      {loudest(v) && <p className="coach__note">{loudest(v)!.detail}</p>}
    </div>
  );
}

/** The factor that did the most to the number, in either direction. */
const loudest = (v: Valuation) =>
  v.factors.reduce<Factor | null>(
    (best, f) => (!best || Math.abs(f.mult - 1) > Math.abs(best.mult - 1) ? f : best),
    null,
  );

/** What the plan was actually able to read, said plainly rather than implied. */
function Sources({ plan }: { plan: LineupPlan }) {
  const missing = [
    !plan.inputs.projections && "projections",
    !plan.inputs.injuries && "the injury wire",
    !plan.inputs.matchups && "matchups",
    !plan.inputs.weather && "the forecast",
  ].filter(Boolean) as string[];

  if (missing.length === 0) {
    return (
      <div className="note" data-kind="ok">
        Expected points, read from projections, the injury wire, the schedule,
        each man&apos;s own matchup and the weather over every stadium you play in.
      </div>
    );
  }

  return (
    <div className="note" data-kind="info">
      Expected points, working without {list(missing)} — every other signal still
      counts, and the chips below say which ones moved.
    </div>
  );
}

const list = (items: string[]) =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
