"use client";

import { useEffect, useState } from "react";

/**
 * Draft room sound effects, synthesized with the Web Audio API rather than
 * shipped as files — three short cues, none worth a network request.
 *
 * A browser blocks audio until the page has seen a user gesture. The draft
 * room is full of clicks (tabs, queue stars, the Draft button itself) so the
 * context unlocks itself in practice; if it hasn't yet, playing quietly
 * fails and nobody notices.
 */

const MUTE_KEY = "ff-draft-sound-muted";

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.1, type: OscillatorType = "sine") {
  const c = audioCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

function setSoundMuted(muted: boolean) {
  try { window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private mode */ }
}

/** Two rising notes — the room turning to you. */
export function playYourTurn() {
  if (isSoundMuted()) return;
  tone(587.33, 0, 0.16, 0.11);
  tone(880, 0.13, 0.24, 0.12);
}

/** A short, satisfying knock — a pick landed on the board. */
export function playPickMade() {
  if (isSoundMuted()) return;
  tone(660, 0, 0.09, 0.09, "triangle");
}

/** A dull, falling note — someone just took a player off your queue. */
export function playQueueSniped() {
  if (isSoundMuted()) return;
  tone(415, 0, 0.11, 0.1, "sawtooth");
  tone(311, 0.09, 0.18, 0.09, "sawtooth");
}

/**
 * Mute state as a hook, so the toggle in the room re-renders when it flips.
 *
 * Starts unmuted and reads localStorage after mount rather than during the
 * initial render, which is the server's render too — there is no
 * localStorage there, and guessing at it would make the first client paint
 * disagree with what the server sent.
 */
export function useSoundMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage, not derivable from props/state
  useEffect(() => { setMuted(isSoundMuted()); }, []);
  return [muted, (next: boolean) => { setSoundMuted(next); setMuted(next); }];
}
