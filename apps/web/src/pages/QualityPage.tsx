import { INDICATORS, parsePeriod } from '@cgi/core';
import { useDictionary, useQuality, useSelection } from '../lib/hooks.js';
import { AnswerBand, Chip, ErrorState, Loading, Notice, Panel } from '../components/ui.js';
import { Stat, StatRow } from '../components/stats.js';
import { Bars, Ring } from '../components/charts.js';

export function QualityPage() {
  const { careHomeId, period } = useSelection();
  const { data, isLoading, error, refetch } = useQuality(careHomeId, period);
  const dictionary = useDictionary();

  if (isLoading) return <Loading label="Loading data quality" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const { completeness, trend, issues } = data;
  const serious = issues.filter((i) => i.level === 'bad');
  const q13 = dictionary.data?.indicators.find((i) => i.id === 'Q13');
  const standardRule = dictionary.data?.indicators.find((i) => i.id === 'Q01')?.missing;
  const quarterlyIds = INDICATORS.filter((i) => i.period.includes('Quarterly')).map((i) => i.id);
  const byDenominator = (den: string) => INDICATORS.filter((i) => i.den === den).map((i) => i.id);
  const averageTwelve = trend.length ? Math.round(trend.reduce((a, t) => a + t.pct, 0) / trend.length) : 0;

  const worst = [...trend].sort((a, b) => a.pct - b.pct)[0];

  return (
    <>
      <div className="view-head">
        <h1>Data quality</h1>
        <p>Completeness, gaps, stale readings and denominator consistency.</p>
      </div>

      <StatRow>
        <Stat
          label="Completeness this period"
          value={<>{completeness.pct}<small>%</small></>}
          note={`${completeness.got} of ${completeness.due} due`}
          tone={completeness.pct === 100 ? 'good' : completeness.pct >= 80 ? 'warn' : 'bad'}
          meter={completeness.due ? completeness.got / completeness.due : 0}
        />
        <Stat
          label="Not submitted"
          value={completeness.due - completeness.got}
          note={completeness.due === completeness.got ? 'Nothing missing' : 'Recorded as gaps, never zero'}
          tone={completeness.due === completeness.got ? 'good' : 'warn'}
        />
        <Stat
          label="Repeated gaps"
          value={serious.length}
          note={serious.length ? 'Indicators with a pattern of gaps' : 'No repeated gaps'}
          tone={serious.length ? 'bad' : 'good'}
        />
        <Stat
          label="12-month average"
          value={<>{averageTwelve}<small>%</small></>}
          note={`${trend.length} periods`}
          tone="teal"
          spark={trend.map((t) => t.pct)}
        />
        <Stat
          label="Weakest period"
          value={worst ? <>{worst.pct}<small>%</small></> : '—'}
          note={worst ? parsePeriod(worst.period).label : 'No history yet'}
          tone={worst && worst.pct < 80 ? 'warn' : 'plain'}
        />
      </StatRow>

      <AnswerBand
        tone={serious.length ? 'bad' : completeness.pct < 100 ? 'watch' : 'good'}
        title="What can this data actually support?"
        meta={['A gap is shown as a gap', 'Q13 is the one documented carry-forward exception']}
      >
        {completeness.pct === 100 && serious.length === 0 ? (
          <>
            Every indicator due for {parsePeriod(data.period).label} was submitted. Where a home reports
            quarterly, the intervening months carry no value by design rather than by omission.
          </>
        ) : (
          <>
            <b>
              {completeness.due - completeness.got} of {completeness.due} indicators
            </b>{' '}
            due for {parsePeriod(data.period).label} have no submitted value, and {serious.length} indicator
            {serious.length === 1 ? ' has' : 's have'} repeated gaps across the history. A gap is never counted
            as zero, and never filled with the previous month.
          </>
        )}
      </AnswerBand>

      <div className="grid g-3">
        <Panel title="Completeness now">
          <div className="row gap-20" style={{ justifyContent: 'center', padding: '8px 0' }}>
            <Ring
              pct={completeness.pct}
              label={parsePeriod(data.period).label}
              tone={completeness.pct === 100 ? 'good' : 'watch'}
            />
            <Ring pct={averageTwelve} label="last 12 months" tone="stable" />
          </div>
        </Panel>

        <Panel title="Completeness over time">
          <Bars
            items={trend.map((t) => ({
              label: parsePeriod(t.period).short,
              value: t.pct,
              display: `${t.pct}%`,
              tone: t.pct === 100 ? 'good' : t.pct >= 80 ? 'watch' : 'bad',
            }))}
          />
        </Panel>

        <Panel title="This period">
          <dl className="kv">
            <dt>Indicators due</dt>
            <dd className="num">{completeness.due}</dd>
            <dt>Submitted</dt>
            <dd className="num">{completeness.got}</dd>
            <dt>Missing</dt>
            <dd>
              {completeness.missing.length === 0 ? (
                <span className="muted">None</span>
              ) : (
                completeness.missing.map((id) => (
                  <span className="tag" key={id}>
                    {id}
                  </span>
                ))
              )}
            </dd>
            <dt>Stale readings</dt>
            <dd className="num">{completeness.stale}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title="Data quality register" tools={<span className="tiny muted">{issues.length} entries</span>} flush>
        {issues.length === 0 ? (
          <div className="empty">No data quality issues recorded for this home.</div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th>Issue</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, i) => (
                  <tr key={`${issue.indicatorId}-${i}`}>
                    <td className="mono small">{issue.indicatorId}</td>
                    <td>
                      <Chip
                        label={issue.kind}
                        tone={issue.level === 'bad' ? 'bad' : issue.level === 'watch' ? 'watch' : 'none'}
                      />
                    </td>
                    <td className="small muted">{issue.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Both come straight from the Notes sheet. They govern whether rates
          are comparable at all, so they belong beside the completeness
          figures rather than in a document nobody opens. */}
      <Panel title="Denominator consistency">
        <p className="small">
          The dictionary identifies <b>resident-days</b> and <b>scheduled hours</b> as the two
          recurring denominators. Both must be sourced consistently — the same occupancy and rota
          data feeding every indicator that uses them — or rates across indicators will not be
          comparable with one another.
        </p>
        <div className="grid g-2" style={{ marginTop: 12 }}>
          <div>
            <div className="tiny muted">Resident-days</div>
            <div className="small">{byDenominator('Resident-days').join(', ') || '—'}</div>
          </div>
          <div>
            <div className="tiny muted">Scheduled / worked hours</div>
            <div className="small">{byDenominator('Scheduled hours').join(', ') || '—'}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Period and cadence rules">
        <p className="small">
          <b>Period.</b> A calendar month, first to last day, unless the home's own reporting cycle
          differs — in which case the home states its period start and end dates in the template
          rather than the system assuming month boundaries. Every indicator for a home must use the
          same boundaries so trends line up.
        </p>
        <p className="small" style={{ marginTop: 10 }}>
          <b>Cadence.</b> All fifteen report monthly by default. {quarterlyIds.join(', ')} may be
          set to quarterly per home where that matches how the home already collects them. A
          monthly indicator with nothing submitted is <b>insufficient data</b>; a quarterly one in
          a month it is not due is <b>off-cycle</b>. The engine does not interpolate, and does not
          wait for a late submission before evaluating everything else.
        </p>
      </Panel>

      <Panel title="The missing-data rule, as supplied">
        <Notice variant="brand">{standardRule}</Notice>
        <p className="small muted" style={{ marginTop: 12 }}>
          <b>The single exception.</b> {q13?.missing} Carried-forward readings are drawn as hollow points on
          every chart, so a stale value never looks like a fresh one.
        </p>
      </Panel>
    </>
  );
}
