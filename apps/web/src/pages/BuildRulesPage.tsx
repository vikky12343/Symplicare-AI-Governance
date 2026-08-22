import { INDICATORS, SOURCE_NOTES } from '@cgi/core';
import { useOrganisation } from '../lib/hooks.js';
import { AnswerBand, Loading, Notice, Panel } from '../components/ui.js';

/**
 * The rules the engine was built to obey, and where each one came from.
 *
 * Every statement here is carried through from the source dictionary's Notes
 * sheet. Putting them beside the thresholds actually in force means a rule can
 * be checked against its source without leaving the product — and that a rule
 * quietly drifting away from its source becomes visible.
 */
export function BuildRulesPage() {
  const organisation = useOrganisation();
  const rules = organisation.data?.organisation.rules;

  const quarterly = INDICATORS.filter((i) => i.period.includes('Quarterly')).map((i) => i.id);
  const rateDenominator = INDICATORS.filter((i) => i.den === 'Resident-days').map((i) => i.id);
  const inverse = INDICATORS.filter((i) => i.harm === 'Lower = worse').map((i) => i.id);

  return (
    <>
      <div className="view-head">
        <h1>Build rules &amp; source notes</h1>
        <p>The rules the trend engine obeys, quoted from the source dictionary, beside what is in force now.</p>
      </div>

      <AnswerBand
        tone="none"
        title="Every rule below is quoted, not paraphrased"
        meta={[
          `${INDICATORS.length} indicators in the library`,
          `${quarterly.length} may report quarterly`,
          `${inverse.length} where lower is worse`,
        ]}
      >
        These notes govern what the engine may and may not do with a reading. Where a note fixes
        behaviour — the missing-data rule, the period definition, the cadence — the engine
        implements it exactly and has a test that fails if it stops.
      </AnswerBand>

      {SOURCE_NOTES.map((note) => (
        <Panel key={note.id} title={note.heading}>
          <p className="small">{note.body}</p>
          {note.id === 'denominators' ? (
            <Notice variant="brand">
              In this build the recurring resident-days denominator is shared by{' '}
              <b>{rateDenominator.join(', ')}</b>, so those rates stay comparable with one another.
            </Notice>
          ) : null}
          {note.id === 'cadence' ? (
            <Notice variant="brand">
              {quarterly.join(', ')} may be set to quarterly per care home in Settings. A month a
              quarterly indicator is not due for is recorded as <b>off-cycle</b>, which is distinct
              from <b>insufficient data</b> — one is expected, the other is a gap.
            </Notice>
          ) : null}
          {note.id === 'direction-of-harm' ? (
            <Notice variant="brand">
              Read per indicator from the dictionary and never assumed uniform.{' '}
              <b>{inverse.join(', ')}</b> {inverse.length === 1 ? 'is the one' : 'are the ones'}{' '}
              where a fall is the harmful direction.
            </Notice>
          ) : null}
        </Panel>
      ))}

      <Panel title="Thresholds in force">
        {organisation.isLoading ? (
          <Loading label="Loading the rules" />
        ) : rules ? (
          <>
            <p className="small muted" style={{ marginBottom: 14 }}>
              Stored per organisation and editable in Settings. A report keeps the thresholds it was
              generated with, so changing them never rewrites history.
            </p>
            <table className="rules-table">
              <tbody>
                {Object.entries(rules).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</th>
                    <td>{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Panel>

      <Panel title="What the engine will not do">
        <ul className="br-list">
          <li>Impute a missing value as zero, or carry one forward — except Q13, which the dictionary makes the single exception and which is flagged <b>stale</b> rather than treated as fresh.</li>
          <li>Interpolate a skipped month, or wait for a late submission before evaluating the other indicators.</li>
          <li>Call deterioration on one large reading. Two independent tests must agree; a single unusual value is what <b>Watch</b> is for.</li>
          <li>Escalate an indicator whose period rests on fewer than five recorded events on its own.</li>
          <li>Treat a lagging indicator as an early warning, or state that an adverse event will occur.</li>
        </ul>
      </Panel>
    </>
  );
}
