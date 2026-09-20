"use client";

import { useEffect } from "react";

/**
 * The one boundary above the root layout itself.
 *
 * `error.tsx` catches everything thrown while rendering a route, but an
 * error thrown by the layout — `SessionProvider`, `ToastHost`, `DoorsHost`,
 * or anything else mounted in `layout.tsx` — has no segment above it to
 * fall back to. Next only reaches for this file for that case, and it has
 * to bring its own `<html>` and `<body>`: the ones in `layout.tsx` are gone
 * along with everything that threw.
 *
 * Plain inline styles, deliberately. The app's own CSS is loaded by the
 * layout this file replaces, so it cannot be trusted to still be there.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#191614",
        color: "#f6efe1",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
      }}>
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>The kitchen&apos;s closed.</h1>
          <p style={{ color: "#b8ada0", marginBottom: 20 }}>
            Something broke loading Main Street Steakhouse. It&apos;s on us, not your connection.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#c99c3f",
              color: "#191614",
              border: 0,
              borderRadius: 8,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
