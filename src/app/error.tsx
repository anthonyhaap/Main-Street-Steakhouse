"use client";

import { useEffect } from "react";

/**
 * The floor under every screen.
 *
 * Nothing in this app renders inside a try/catch — a hook throwing on an
 * unexpected shape, a realtime payload nobody planned for, a null the
 * database has never sent before today — and until now the only thing
 * standing between that and a manager's phone was hoping it never happened.
 * It always eventually does, and without this file the App Router's own
 * answer to it was a blank, unstyled page with no way back but a hard
 * refresh: reported as "the page doesn't load, it breaks."
 *
 * This is the per-segment boundary, so it swaps in under the shell — the top
 * bar, the session, the toasts all stay mounted — for any error thrown while
 * rendering a route. `reset()` re-renders the segment without a full reload,
 * which is enough for a transient bad payload; a refresh is one tap away for
 * anything that isn't.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page tonight">
      <section className="tt">
        <i className="tt__rule" />
        <p className="tt__eyebrow eyebrow"><span>Main Street Steakhouse</span></p>
        <h1 className="tt__title display">The kitchen&apos;s closed.</h1>
        <i className="tt__rule" />
        <p className="tt__line">Something broke loading this page. It&apos;s on us, not your connection.</p>
        <i className="tt__rule" />
        <button className="tt__action" type="button" onClick={() => reset()}><span>Try again</span></button>
      </section>
    </main>
  );
}
