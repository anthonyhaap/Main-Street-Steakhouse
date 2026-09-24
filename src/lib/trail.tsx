"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * The page the reader was on before this one, as long as they got here inside
 * the app.
 *
 * A Back button can't read the browser's history, and `history.length` counts
 * entries that aren't worth returning to: a player card opened cold goes
 * through /login first, and stepping back from it lands on the sign-in form.
 * So the root layout mounts `<Trail />`, which notes each pathname as the
 * router settles on it. A full load starts the trail empty, which is exactly
 * the "opened cold" case.
 */
let previous: string | null = null;
let current: string | null = null;

export function Trail() {
  const path = usePathname();
  useEffect(() => {
    if (path === current) return;
    previous = current;
    current = path;
  }, [path]);
  return null;
}

/** Screens that are a way in, not somewhere a Back button should return to. */
const DOORS = ["/login", "/auth", "/join", "/welcome", "/splash"];

/** Whether stepping back would land on a page of the app someone chose to be on. */
export function cameFromInApp(): boolean {
  if (!previous) return false;
  const from = previous;
  return !DOORS.some((d) => from === d || from.startsWith(d + "/"));
}
