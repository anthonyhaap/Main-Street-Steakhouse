import { LT_STATS, ltNote } from "@/lib/lt";

/**
 * The house standard, under the hero on the league home page.
 *
 * A sign on the wall rather than a widget: nothing to click, nothing to load,
 * nothing that changes while you look at it. The line turns over once a day —
 * see `src/lib/lt.ts` for what goes on it and why it is words instead of a
 * highlight reel.
 *
 * `now` is passed in rather than read here for the same reason every other
 * clock value on this page is: the whole dashboard shares one tick, and the
 * fixture at /preview hands it a fixed one.
 */
export function Plaque({ now }: { now: number }) {
  return (
    <section className="lt" aria-label="Lawrence Taylor, number 56">
      <span className="lt__num num" aria-hidden>56</span>

      <div className="lt__say">
        <div className="eyebrow" data-tone="wine">Lawrence Taylor · Giants 1981–1993</div>
        <p>{ltNote(now)}</p>
      </div>

      <dl className="lt__stats">
        {LT_STATS.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd className="num">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
