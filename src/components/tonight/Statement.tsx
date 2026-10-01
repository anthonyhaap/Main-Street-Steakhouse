/**
 * The Commissioner's statement on the free-agency debacle of September 29,
 * 2026, posted to the first screen as it was issued. Set as text rather than
 * a screenshot so it reads on a phone and a screen reader can read it aloud.
 */
export function Statement() {
  return (
    <article className="memo" aria-labelledby="memo-title">
      <p className="eyebrow" data-tone="wine">From the League Office</p>
      <h2 id="memo-title" className="memo__title display">Official statement from the Commissioner&apos;s Office</h2>
      <i className="memo__rule" />

      <p>
        The Main Street Steakhouse League is aware of the free-agency debacle that transpired on September 29, 2026.
        As a result of these events, the Commissioner has also been made aware of a potential resignation from the league.
      </p>
      <p>
        The situation involved two players in the free-agent pool who could not be found when one manager attempted
        to search for and acquire them. After the issue was corrected, another manager was later able to locate those
        same players and add them to his roster.
      </p>
      <p>For the sake of complete transparency:</p>

      <dl className="memo__qa">
        <dt>Was the issue resolved in a timely manner?</dt>
        <dd>Debatable. The Commissioner was attending a conference.</dd>
        <dt>Could the Commissioner have issued an urgent ruling stating that the original manager would be awarded the two players?</dt>
        <dd>Yes.</dd>
        <dt>Should he have?</dt>
        <dd>Probably.</dd>
      </dl>

      <p>Hindsight remains undefeated.</p>
      <p>
        League management ultimately determined that once the technical issue was corrected, the appropriate course
        of action was to allow the free-agent market to operate normally rather than retroactively determining where
        the players should have gone.
      </p>
      <p>In hindsight, that decision may not have been the perfect one.</p>
      <p>
        Unfortunately, it is now too late to completely right the wrongs of September 29. As with most things in life,
        the only thing any of us can truly control is what we can control.
      </p>
      <p><strong>Dawin.</strong></p>
      <p>
        The League Office fully understands that this situation has caused frustration and may ultimately result in
        the departure of one of its managers.
      </p>
      <p>
        The system briefly failed.<br />
        The issue was corrected.<br />
        The Commissioner accepts responsibility for how the situation was handled.
      </p>
      <p>
        That said, we would also like to remind all league members that quitting an entire fantasy football league
        because you missed out on two free agents is an extraordinarily powerful move and one that will undoubtedly be
        studied by future generations.
      </p>
      <p>
        Should the manager elect not to actively manage his roster for the remainder of the season, the Commissioner
        will ensure that a valid and competitive starting lineup is submitted each week so that the integrity of the
        remaining league schedule is preserved.
      </p>
      <p>The League Office considers this matter closed.</p>
      <p><strong>We do not negotiate with terrorists.</strong></p>
      <p>Unless additional screenshots emerge.</p>

      <footer className="memo__sign">
        <p>Respectfully,</p>
        <p className="memo__hand">Twan</p>
        <p>Commissioner<br />Main Street Steakhouse League</p>
      </footer>
      <p className="memo__note">AI was not used in the publishing of this statement.</p>
    </article>
  );
}
