"use client";

import { useEffect, useRef } from "react";

/**
 * The clip that plays on the way into your own desk.
 *
 * Full screen, over the desk, which loads underneath while it plays — so when
 * the clip ends the lineup is usually already there. It ends itself; a tap
 * anywhere, the Skip button or Escape ends it sooner, and a clip that fails
 * to load gets out of the way rather than leaving a black screen.
 *
 * Sound is tried first: the tap on "My Team" usually counts as the gesture a
 * browser wants before it plays audio. Where it does not, it plays muted
 * rather than not at all.
 *
 * Once per session: the first time it shows, it marks the tab, and the desk
 * goes straight in until the tab is closed.
 */
const INTRO_KEY = "mss-team-intro";

/** Whether the clip has already played in this tab. Private mode or blocked
 *  storage reads as "not yet", so it plays rather than never. */
export function introSeen(): boolean {
  try { return !!sessionStorage.getItem(INTRO_KEY); } catch { return false; }
}

export function TeamIntro({ onDone }: { onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => {
    try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ }
    const v = video.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => done.current());
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="team-intro" role="dialog" aria-label="Team intro" onClick={() => onDone()}>
      <video
        ref={video}
        className="team-intro__video"
        src="/team-intro.mp4"
        playsInline
        preload="auto"
        onEnded={() => onDone()}
        onError={() => onDone()}
      />
      <button
        type="button"
        className="team-intro__skip"
        onClick={(e) => { e.stopPropagation(); onDone(); }}
      >
        Skip
      </button>
      <style>{`
        .team-intro {
          position: fixed; inset: 0; z-index: 400;
          background: #000;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }
        .team-intro__video { width: 100%; height: 100%; object-fit: contain; }
        .team-intro__skip {
          position: absolute;
          top: calc(env(safe-area-inset-top, 0px) + 16px);
          right: calc(env(safe-area-inset-right, 0px) + 16px);
          min-height: 36px; padding: 6px 14px;
          border-radius: 999px; border: 1px solid rgba(255,255,255,0.4);
          background: rgba(0,0,0,0.5); color: #fff;
          font: inherit; font-size: 14px; cursor: pointer;
        }
      `}</style>
    </div>
  );
}
