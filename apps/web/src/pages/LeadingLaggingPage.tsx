import { Link } from 'react-router-dom';
import { INDICATORS, LEADING_LAGGING_NOTE, type Indicator } from '@cgi/core';
import { AnswerBand, Notice, Panel } from '../components/ui.js';

/**
 * Leading versus lagging.
 *
 * The split comes from the dictionary's own `type` field and nothing else. The
 * distinction matters because the two answer different questions: a potential
 * leading indicator says conditions are changing, a lagging one says something
 * has already happened. Reading the second as the first is how a tracker ends
 * up implying it can predict an incident.
 */

const LEADING = INDICATORS.filter((i) => i.type === 'Potential leading');
const OTHER = INDICATORS.filter((i) => i.type !== 'Potential leading');

export function LeadingLaggingPage() {
  return (
    <>
      <div className="view-head">
        <h1>Leading vs lagging indicators</h1>
        <p>
          Which of the fifteen describe conditions that are still developing, and which describe
          outcomes that have already landed.
        </p>
      </div>

      <AnswerBand
        tone="none"
        title="The type field is used as supplied"
        meta={[
          `${LEADING.length} potential leading`,
          `${OTHER.length} lagging, outcome or context`,
          'No indicator is relabelled on opinion',
        ]}
      >
        {LEADING_LAGGING_NOTE}
      </AnswerBand>

      <div className="grid g-2">
        <Panel title={`Potential leading — ${LEADING.length}`}>
          <p className="small muted" style={{ marginBottom: 14 }}>
            Used to identify developing organisational conditions. These are the indicators a
            convergence signal is built from.
          </p>
          <IndicatorList items={LEADING} />
        </Panel>

        <Panel title={`Lagging, outcome and context — ${OTHER.length}`}>
          <p className="small muted" style={{ marginBottom: 14 }}>
            Describe what has already become visible. They stay in view for learning,
            accountability and context.
          </p>
          <IndicatorList items={OTHER} />
        </Panel>
      </div>

      <Panel title="How the distinction is used">
        <p className="small">
          A rise in a <b>potential leading</b> indicator is read as a change in the conditions the
          home is operating under, and several moving together is what raises a convergence signal.
          A rise in a <b>lagging</b> indicator is read as an outcome to understand and learn from.
        </p>
        <p className="small" style={{ marginTop: 10 }}>
          The dashboard does not treat lagging indicators as leading ones. Incidents, medication
          incidents, safeguarding concerns and complaints remain outcome measures used for context
          — the tracker never implies that an incident rate by itself predicts a future incident.
        </p>
        <Notice variant="brand">
          Q15 is marked <b>Lagging/context</b> in the dictionary and is deliberately treated as
          context alongside the other fourteen rather than as a standalone trend, because inspection
          cadence is irregular where the operational indicators are not.
        </Notice>
      </Panel>
    </>
  );
}

function IndicatorList({ items }: { items: readonly Indicator[] }) {
  return (
    <ul className="ll-list">
      {items.map((ind) => (
        <li key={ind.id}>
          <Link to={`/indicators/${ind.id}`}>
            <span className="ll-id">{ind.id}</span>
            <span className="ll-name">{ind.name}</span>
          </Link>
          <span className="ll-meta">
            {ind.domain} · {ind.type} · {ind.harm}
          </span>
        </li>
      ))}
    </ul>
  );
}
