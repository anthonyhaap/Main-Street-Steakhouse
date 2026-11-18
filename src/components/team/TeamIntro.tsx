"use client";

import { useEffect, useRef, useState } from "react";

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
 *
 * It fades out rather than cutting to the desk, whether it ran to the end or
 * was skipped. Taps fall through to the desk while it fades. A clip that
 * failed to load, or a reader who asked for reduced motion, gets the cut.
 *
 * It fades in the same way: the black screen covers the desk at once, and
 * the picture comes up out of it when the clip actually starts playing, so a
 * slow load reads as black rather than a frozen first frame.
 */
const INTRO_KEY = "mss-team-intro";
const FADE_MS = 600;

/** Whether the clip has already played in this tab. Private mode or blocked
 *  storage reads as "not yet", so it plays rather than never. */
export function introSeen(): boolean {
  try { return !!sessionStorage.getItem(INTRO_KEY); } catch { return false; }
}

export function TeamIntro({ onDone }: { onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(onDone);
  // Follows the element, not the other way round: the browser can force it
  // muted when it refuses sound, and the button has to say so.
  const [muted, setMuted] = useState(false);
  const [fading, setFading] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { done.current = onDone; }, [onDone]);

  // Start the fade once; the overlay unmounts when it has finished.
  const leaving = useRef(false);
  const leave = useRef(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { done.current(); return; }
    setFading(true);
    setTimeout(() => done.current(), FADE_MS);
  });

  useEffect(() => {
    try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ }
    const v = video.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => done.current());
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") leave.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="team-intro"
      data-fading={fading || undefined}
      role="dialog"
      aria-label="Team intro"
      onClick={() => leave.current()}
    >
      <video
        ref={video}
        className="team-intro__video"
        src="/team-intro.mp4"
        playsInline
        preload="auto"
        data-playing={playing || undefined}
        onPlaying={() => setPlaying(true)}
        onEnded={() => leave.current()}
        onError={() => onDone()}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
      />
      <button
        type="button"
        className="team-intro__btn team-intro__mute"
        onClick={(e) => {
          e.stopPropagation();
          const v = video.current;
          if (v) v.muted = !v.muted;
        }}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        className="team-intro__btn team-intro__skip"
        onClick={(e) => { e.stopPropagation(); leave.current(); }}
      >
        Skip
      </button>
      <style>{`
        .team-intro {
          position: fixed; inset: 0; z-index: 400;
          background: #000;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: opacity ${FADE_MS}ms ease;
        }
        .team-intro[data-fading] { opacity: 0; pointer-events: none; }
        .team-intro__video {
          width: 100%; height: 100%; object-fit: contain;
          opacity: 0; transition: opacity ${FADE_MS}ms ease;
        }
        .team-intro__video[data-playing] { opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .team-intro__video { transition: none; }
        }
        .team-intro__btn {
          position: absolute;
          top: calc(env(safe-area-inset-top, 0px) + 16px);
          min-height: 52px; padding: 10px 26px;
          border-radius: 999px; border: 2px solid rgba(255,255,255,0.7);
          background: rgba(0,0,0,0.5); color: #fff;
          font: inherit; font-size: 18px; font-weight: 600; cursor: pointer;
        }
        .team-intro__skip { right: calc(env(safe-area-inset-right, 0px) + 16px); }
        .team-intro__mute { left: calc(env(safe-area-inset-left, 0px) + 16px); }
      `}</style>
    </div>
  );
}
