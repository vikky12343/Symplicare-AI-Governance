import { Link } from 'react-router-dom';
import { INDICATOR_BY_ID, WORKING_DEFAULTS } from '@cgi/core';
import { AnswerBand, Notice, Panel, Tag } from '../components/ui.js';

/**
 * The five open items, and what to assume until a pilot home settles them.
 *
 * Nothing here is wired into calculation logic, deliberately. Each item is a
 * decision a care home has to make about its own operation — what counts as
 * required training, how often supervision is due — and a default that quietly
 * became the rule would be a decision nobody took.
 */
export function WorkingDefaultsPage() {
  return (
    <>
      <div className="view-head">
        <h1>Working defaults</h1>
        <p>
          Provisional answers to the five questions the dictionary leaves open, each one sourced so
          it can be checked rather than taken on trust.
        </p>
      </div>

      <AnswerBand
        tone="watch"
        title="These are not product rules"
        meta={[
          `${WORKING_DEFAULTS.length} open items`,
          'Not used in any calculation',
          'Confirm with the pilot home before locking',
        ]}
      >
        They are fallbacks to use <b>only</b> if the pilot manager conversation has not happened
        yet. None of them is enforced anywhere in the engine — each is a decision about how a
        particular home runs, and the home is the one that gets to make it.
      </AnswerBand>

      {WORKING_DEFAULTS.map((d) => {
        const indicator = INDICATOR_BY_ID.get(d.indicatorId);
        return (
          <Panel
            key={d.indicatorId}
            title={
              <>
                <Link to={`/indicators/${d.indicatorId}`}>{d.indicatorId}</Link> · {d.item}
              </>
            }
            tools={<Tag>{indicator?.domain ?? 'Reference'}</Tag>}
          >
            <h3 className="wd-head">What the evidence says</h3>
            <p className="small">{d.finding}</p>

            <h3 className="wd-head">Proposed default</h3>
            <Notice variant="brand">{d.proposed}</Notice>

            <h3 className="wd-head">Sources</h3>
            <ul className="wd-sources">
              {d.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}

      <Notice variant="warn">
        When a home confirms its own answer, record it against that home rather than changing the
        default here — the default describes the sector, the home's answer describes the home.
      </Notice>
    </>
  );
}
