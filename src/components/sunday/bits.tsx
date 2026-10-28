"use client";

/**
 * The small moving parts of the game center: a score that counts and bumps
 * when it goes up, the entertainment label on a manager, and the one-word
 * state of a table.
 */

import { useEffect, useRef, useState } from "react";
import { useCountUp } from "@/components/ui";
import type { CardState } from "@/lib/scoreboard";
import type { Mood } from "@/lib/sunday";

/**
 * A live score. It counts rather than snaps, and when it goes *up* it scales
 * once — the touchdown, felt. A score going down (a stat correction) just
 * counts; nothing about a correction deserves a celebration.
 */
export function LiveScore({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value, 700);
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (value > prev.current + 0.05) setBump((n) => n + 1);
    prev.current = value;
  }, [value]);
  return (
    <span key={bump} className={`${className ?? ""}${bump ? " sun-bump" : ""}`}>
      {shown.toFixed(1)}
    </span>
  );
}

export function MoodChip({ mood }: { mood: Mood | null }) {
  if (!mood) return null;
  return (
    <span className="sun-mood" data-mood={mood.key}>
      {mood.emoji && <span aria-hidden>{mood.emoji}</span>}
      {mood.label}
    </span>
  );
}

export function StateTag({ state, late }: { state: CardState; late?: boolean }) {
  const word = state === "live" ? "Live" : state === "settled" ? "Final" : state === "between" ? "In play" : "Proj.";
  return (
    <span className="sun-state" data-state={state}>
      {state === "live" && <i className="sun-dot" aria-hidden />}
      {word}
      {state === "live" && late && " · Late"}
    </span>
  );
}
