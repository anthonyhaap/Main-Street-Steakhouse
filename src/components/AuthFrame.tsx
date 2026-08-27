import { ShieldCheck } from "lucide-react";

/**
 * The two public screens are the first thing eleven people will ever see of
 * this league, and a lone form floating in black is not an introduction. On a
 * wide screen this is an editorial split: the house on the left, the business
 * on the right. On a phone it collapses to a compact crest above the form.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const facts = [
    ["12", "Managers"],
    ["15", "Rounds"],
    ["Live", "Scoring"],
    ["2026", "Season"],
  ];

  return (
    <main className="auth">
      <aside className="auth__house">
        <div className="auth__houseInner">
          <div className="auth__crest">MSS</div>

          <h1 className="display auth__wordmark">
            Main Street
            <br />
            Steakhouse
            <br />
            <span style={{ color: "var(--gold)" }}>League</span>
          </h1>

          <div className="auth__rule" />

          <p className="auth__creed">
            Twelve managers. One draft. Every Sunday settled here — no ads,
            no algorithm, no platform telling you what your rules can be.
          </p>

          <dl className="auth__facts">
            {facts.map(([v, k]) => (
              <div key={k}>
                <dt className="display">{v}</dt>
                <dd className="eyebrow">{k}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <section className="auth__work">
        <div className="auth__crestSm">
          <span>MSS</span>
          <ShieldCheck size={13} color="var(--gold)" />
        </div>
        <div className="auth__form">{children}</div>
      </section>

      <style>{`
        .auth {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: 1fr;
        }
        .auth__house { display: none; }

        .auth__work {
          display: grid;
          align-content: center;
          justify-items: stretch;
          padding: var(--s6) var(--s5);
        }
        .auth__form { width: 100%; max-width: 430px; margin: 0 auto; }

        .auth__crestSm {
          display: flex; align-items: center; gap: var(--s2);
          justify-content: center; margin-bottom: var(--s6);
        }
        .auth__crestSm > span {
          display: grid; place-items: center;
          width: 34px; height: 34px;
          border: 1px solid var(--gold-dim); color: var(--gold);
          font: 400 13px/1 var(--serif);
        }

        @media (min-width: 900px) {
          .auth { grid-template-columns: 1.05fr 1fr; }
          .auth__crestSm { display: none; }

          .auth__house {
            display: grid;
            align-content: center;
            padding: var(--s8) clamp(var(--s6), 5vw, var(--s8));
            border-right: 1px solid var(--rule);
            position: relative;
            overflow: hidden;
          }
          /* a very large, very quiet monogram behind the type */
          .auth__house::after {
            content: "MSS";
            position: absolute;
            right: -4%;
            bottom: -18%;
            font: 400 34vw/0.8 var(--serif);
            color: #f2ede303;
            pointer-events: none;
            user-select: none;
          }
          .auth__houseInner { position: relative; z-index: 1; max-width: 30rem; }

          .auth__crest {
            display: grid; place-items: center;
            width: 46px; height: 46px;
            border: 1px solid var(--gold-dim); color: var(--gold);
            font: 400 16px/1 var(--serif);
            margin-bottom: var(--s6);
          }
          .auth__wordmark { font-size: clamp(2.6rem, 4vw, 3.6rem); margin: 0; }
          .auth__rule {
            width: 56px; height: 1px; background: var(--gold-dim);
            margin: var(--s5) 0;
          }
          .auth__creed {
            margin: 0; color: var(--muted); line-height: 1.75;
            max-width: 34ch; font-size: var(--t-body);
          }
          .auth__facts {
            display: grid; grid-template-columns: repeat(4, auto);
            gap: var(--s6); margin: var(--s7) 0 0; justify-content: start;
          }
          .auth__facts dt { font-size: 1.5rem; color: var(--cream); margin: 0; }
          .auth__facts dd { margin: 6px 0 0; }
        }
      `}</style>
    </main>
  );
}
