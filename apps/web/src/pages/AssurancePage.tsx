import { useNavigate } from 'react-router-dom';
import { toneOf } from '@cgi/core';
import { useAssurance, useDictionary, useSelection } from '../lib/hooks.js';
import { AnswerBand, ErrorState, Loading, Notice, Panel, StatusChip } from '../components/ui.js';
import { BarList, Stat, StatRow } from '../components/stats.js';

export function AssurancePage() {
  const { careHomeId, period } = useSelection();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useAssurance(careHomeId, period);
  const dictionary = useDictionary();

  if (isLoading) return <Loading label="Loading governance assurance" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const weakest = [...data.areas].sort((a, b) => rank(a.state) - rank(b.state))[0]!;

  const totalDeteriorating = data.areas.reduce((n, a) => n + a.deteriorating, 0);
  const totalWatch = data.areas.reduce((n, a) => n + a.watch, 0);
  const mapped = data.areas.reduce((n, a) => n + a.members.length, 0);
  const settled = data.areas.filter((a) => a.state === 'Stable' || a.state === 'Improving').length;

  return (
    <>
      <div className="view-head">
        <h1>Governance assurance</h1>
        <p>Internal indicators mapped to the five key questions. Not a rating.</p>
      </div>

      <StatRow>
        <Stat
          label="Key questions settled"
          value={<>{settled}<small>of {data.areas.length}</small></>}
          note="Stable or improving"
          tone={settled === data.areas.length ? 'good' : 'warn'}
          meter={data.areas.length ? settled / data.areas.length : 0}
        />
        <Stat
          label="Deteriorating"
          value={totalDeteriorating}
          note="Across all five questions"
          tone={totalDeteriorating ? 'bad' : 'good'}
        />
        <Stat label="On watch" value={totalWatch} note="One test only" tone={totalWatch ? 'warn' : 'plain'} />
        <Stat label="Indicators mapped" value={mapped} note="To a key question" tone="teal" />
        <Stat
          label="Weakest area"
          value={<span className="stat-word">{weakest.keyQuestion}</span>}
          note={`${weakest.deteriorating} deteriorating · ${weakest.watch} watch`}
          tone={toneOf(weakest.state) === 'bad' ? 'bad' : toneOf(weakest.state) === 'watch' ? 'warn' : 'good'}
        />
      </StatRow>

      <Panel title="Where attention sits, by key question">
        <BarList
          items={data.areas.map((a) => ({
            label: a.keyQuestion,
            value: a.deteriorating + a.watch,
            tone: (a.deteriorating ? 'bad' : a.watch ? 'warn' : 'good'),
          }))}
          emptyLabel="No indicator is currently outside its normal range."
        />
      </Panel>

      <AnswerBand
        tone={toneOf(weakest.state)}
        title="An internal view, not a rating"
        meta={[`Weakest area: ${weakest.keyQuestion}`, `Mapping version: ${dictionary.data?.mappingVersion ?? '—'}`]}
      >
        Internal indicators mapped to the five key questions used in adult social care assessment, so that
        management conversations line up with the structure the regulator uses. This is the organisation's own
        view of its own data. It is not a CQC rating, it does not predict one, and a stable internal indicator
        does not evidence compliance.
      </AnswerBand>

      <div className="grid g-3">
        {data.areas.map((area) => (
          <Panel
            key={area.keyQuestion}
            title={
              <>
                {area.keyQuestion} <span style={{ marginLeft: 6 }}><StatusChip status={area.state} /></span>
              </>
            }
          >
            <div className="stack gap-8">
              {area.members.map((member) => (
                <button
                  key={member.indicatorId}
                  type="button"
                  className="row gap-8"
                  style={{
                    justifyContent: 'space-between',
                    border: 0,
                    background: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                    width: '100%',
                  }}
                  onClick={() => void navigate(`/indicators/${member.indicatorId}`)}
                >
                  <span className="small">
                    <span className="mono tiny" style={{ color: 'var(--faint)' }}>
                      {member.indicatorId}
                    </span>{' '}
                    {member.indicator.short}
                  </span>
                  <StatusChip status={member.status} />
                </button>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        title="Regulatory mapping"
        tools={
          <span className="tiny muted">
            Versioned — a framework change must not alter what a historical report meant
          </span>
        }
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Key question</th>
                <th>Related regulation</th>
              </tr>
            </thead>
            <tbody>
              {(dictionary.data?.indicators ?? []).map((indicator) => (
                <tr key={indicator.id} className="tap" onClick={() => void navigate(`/indicators/${indicator.id}`)}>
                  <td>
                    <div className="ind-cell">
                      <span className="id">{indicator.id}</span>
                      <span className="nm">{indicator.short}</span>
                    </div>
                  </td>
                  <td className="small">{indicator.kloe}</td>
                  <td className="small muted">{indicator.reg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Notice variant="warn">
          <b>Wording held to deliberately.</b> No screen states that an incident will occur, that this home is
          unsafe, or what rating an inspection would produce. Where the mapping is shown, it is labelled as an
          internal governance view throughout.
        </Notice>
      </div>
    </>
  );
}

function rank(status: string): number {
  return ['Deteriorating', 'Watch', 'Stable', 'Improving', 'Insufficient data'].indexOf(status);
}
