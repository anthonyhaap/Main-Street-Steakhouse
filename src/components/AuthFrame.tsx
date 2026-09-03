import Image from "next/image";

/**
 * The two public screens are the first thing eleven people will ever see of
 * this league, and a lone form floating on a page is not an introduction. On a
 * wide screen this is an editorial split: the house on the left, the business
 * on the right. On a phone it collapses to the crest above the form.
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
          <Image
            className="auth__logo"
            src="/logo-full.svg"
            alt="Main Street Steakhouse — Est. 2016 — Members Only"
            width={800}
            height={892}
            priority
          />

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
        <Image
          className="auth__logoSm"
          src="/logo-full.svg"
          alt="Main Street Steakhouse"
          width={800}
          height={892}
          priority
        />
        <div className="auth__form">{children}</div>
      </section>

      <style>{`
        .auth {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: 1fr;
        }
        @media (min-width: 940px) {
          .auth { grid-template-columns: minmax(0, 1.05fr) minmax(430px, 0.95fr); }
        }

        /* ---------------------------------------------------------- house -- */
        .auth__house {
          display: none;
          position: relative;
          padding: clamp(var(--s6), 5vw, var(--s8));
          background:
            radial-gradient(760px 460px at 22% 10%, #c99c3f2e, transparent 68%),
            radial-gradient(620px 420px at 90% 92%, #6a0b2016, transparent 66%),
            linear-gradient(160deg, #fffdf8, #f6efe1);
          border-right: 1px solid var(--rule);
        }
        @media (min-width: 940px) { .auth__house { display: grid; align-content: center; } }

        .auth__house::after {
          content: "";
          position: absolute; inset: auto 0 0 0; height: 4px;
          background: linear-gradient(90deg, var(--wine), var(--gold-lit) 55%, var(--wine));
        }

        .auth__houseInner { max-width: 520px; margin: 0 auto; width: 100%; }

        .auth__logo {
          width: min(100%, 380px);
          height: auto;
          display: block;
          margin: 0 0 var(--s6);
        }

        .auth__creed {
          margin: 0 0 var(--s6);
          padding-top: var(--s5);
          border-top: 1px solid var(--rule);
          font: 400 clamp(1rem, 0.9rem + 0.4vw, 1.15rem)/1.65 var(--serif);
          color: var(--muted);
          max-width: 46ch;
        }

        .auth__facts {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: var(--s4);
        }
        .auth__facts dt {
          font-size: clamp(1.4rem, 1.1rem + 1vw, 1.9rem);
          color: var(--wine);
          margin: 0 0 4px;
        }
        .auth__facts dd { margin: 0; }

        /* ----------------------------------------------------------- work -- */
        .auth__work {
          display: grid;
          align-content: center;
          justify-items: stretch;
          padding: clamp(var(--s5), 6vw, var(--s7)) clamp(var(--s4), 5vw, var(--s7));
          background: var(--ink-0);
        }

        .auth__logoSm {
          width: 168px;
          height: auto;
          margin: 0 auto var(--s6);
          display: block;
        }
        @media (min-width: 940px) { .auth__logoSm { display: none; } }

        .auth__form { width: 100%; max-width: 420px; margin: 0 auto; }
      `}</style>
    </main>
  );
}
