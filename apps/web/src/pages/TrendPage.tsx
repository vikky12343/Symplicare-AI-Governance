import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fmtBase, fmtSigned, fmtUnit, parsePeriod, toneOf } from '@cgi/core';
import { useCan, useIndicatorDetail, useRecordContext, useSelection } from '../lib/hooks.js';
import { AnswerBand, ErrorState, Field, Kpi, Loading, Notice, Panel, StatusChip, Tag } from '../components/ui.js';
import { DeltaColumns, LineChart } from '../components/charts.js';
import { ApiError } from '../lib/api.js';
import { text } from '../lib/forms.js';

export function TrendPage() {
  const { indicatorId } = useParams();
  const { careHomeId, period } = useSelection();
  const navigate = useNavigate();
  const can = useCan();
  const [window, setWindow] = useState(24);
  const [addingContext, setAddingContext] = useState(false);

  const { data, isLoading, error, refetch } = useIndicatorDetail(careHomeId, indicatorId ?? null, period);

  if (isLoading) return <Loading label="Loading the indicator" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const { indicator, evaluation, readings, corridor, comparisons } = data;
  const shown = readings.slice(-window);
  const shownCorridor = corridor.slice(-window);

  return (
    <>
      <div className="view-head">
        <div className="row gap-12" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>{indicator.name}</h1>
            <p>
              {indicator.domain} · {indicator.unit} · {indicator.harm}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void navigate('/indicators')}>
            Back to library
          </button>
        </div>
      </div>

      <AnswerBand
        tone={toneOf(evaluation.status)}
        title={`${indicator.short} — ${parsePeriod(data.period).label}`}
        meta={[indicator.unit, indicator.harm, indicator.type, indicator.id]}
      >
        {evaluation.why}
      </AnswerBand>

      <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
        {[6, 12, 24].map((n) => (
          <button
            key={n}
            type="button"
            className={`btn btn-sm${window === n ? ' btn-primary' : ''}`}
            onClick={() => setWindow(n)}
          >
            {n} months
          </button>
        ))}
        <span className="grow" />
        {can('reviewSignals') ? (
          <button type="button" className="btn btn-sm" onClick={() => setAddingContext(true)}>
            Record known context
          </button>
        ) : null}
      </div>

      <div className="kpis">
        <Kpi
          label="Current"
          value={fmtUnit(evaluation.value, indicator)}
          sub={parsePeriod(data.period).label}
          tone={toneOf(evaluation.status)}
        />
        <Kpi label="Baseline" value={fmtBase(evaluation.baseline, indicator)} sub={`median of ${evaluation.baselinePeriods} periods`} />
        <Kpi
          label="vs baseline"
          value={evaluation.changePct === null ? '—' : `${fmtSigned(evaluation.changePct, 0)}%`}
          sub={evaluation.changeAbs === null ? '' : `${fmtSigned(evaluation.changeAbs, indicator.dp)} absolute`}
        />
        <Kpi
          label="Month on month"
          value={comparisons.monthOnMonth === null ? '—' : fmtSigned(comparisons.monthOnMonth, indicator.dp)}
          sub={evaluation.momFrom ? `from ${parsePeriod(evaluation.momFrom).short}` : ''}
        />
        <Kpi
          label="Year on year"
          value={comparisons.yearOnYear === null ? '—' : fmtSigned(comparisons.yearOnYear, indicator.dp)}
          sub="same month last year"
        />
        <Kpi
          label="This quarter"
          value={fmtBase(comparisons.thisQuarter.value, indicator)}
          sub={`${comparisons.thisQuarter.monthsUsed}/${comparisons.thisQuarter.monthsExpected} months`}
        />
        <Kpi label="Rolling 3" value={fmtBase(comparisons.rolling3, indicator)} sub="3-period average" />
        <Kpi label="Rolling 6" value={fmtBase(comparisons.rolling6, indicator)} sub="6-period average" />
        <Kpi
          label="Consecutive periods"
          value={evaluation.harmfulRun || evaluation.helpfulRun || 0}
          sub={evaluation.harmfulRun ? 'moving toward harm' : evaluation.helpfulRun ? 'moving away from harm' : 'no run'}
          tone={evaluation.harmfulRun >= 3 ? 'bad' : ''}
        />
      </div>

      <Panel
        title={`${window}-month trend`}
        tools={
          <>
            <StatusChip status={evaluation.status} />
            <span className="tiny muted">
              Shaded corridor is this home's own baseline, recalculated every period
            </span>
          </>
        }
      >
        <LineChart
          readings={shown}
          indicator={indicator}
          status={evaluation.status}
          corridor={shownCorridor}
          height={240}
          showAxis
        />
      </Panel>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Panel
          title="Month-on-month movement"
          tools={<span className="tiny muted">Above the line moves toward harm</span>}
        >
          <DeltaColumns readings={shown} indicator={indicator} />
        </Panel>

        <Panel title="Period comparisons">
          <table className="tbl">
            <tbody>
              {[
                ['This quarter', comparisons.thisQuarter.value],
                ['Previous quarter', comparisons.previousQuarter.value],
                ['Same quarter last year', comparisons.sameQuarterLastYear.value],
                ['This year to date', comparisons.thisYear.value],
                ['Previous year', comparisons.previousYear.value],
              ].map(([label, value]) => (
                <tr key={label as string}>
                  <td className="small">{label as string}</td>
                  <td className="r num">
                    {value === null || value === undefined ? (
                      <span className="muted">—</span>
                    ) : (
                      fmtBase(value as number, indicator)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Why this status" tools={<span className="tiny muted">Every test that crossed its threshold</span>}>
        {evaluation.reasons.length === 0 ? (
          <div className="empty">
            No test crossed its threshold for this period. The indicator is inside its normal range.
          </div>
        ) : (
          <div className="tests">
            {evaluation.reasons.map((reason, i) => (
              <div className="test" key={i}>
                <span className="t-name">{reason.test}</span>
                <span className="t-body">{reason.text}</span>
              </div>
            ))}
            {evaluation.context.map((note, i) => (
              <div className="test" key={`c${i}`}>
                <span className="t-name">Recorded context</span>
                <span className="t-body">
                  “{note.text}” — {note.by}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Definition as supplied" tools={<Tag>Source data dictionary</Tag>}>
        <dl className="kv">
          <dt>Calculation</dt>
          <dd>{indicator.calc}</dd>
          <dt>Unit</dt>
          <dd>{indicator.unit}</dd>
          <dt>Reporting period</dt>
          <dd>{indicator.period}</dd>
          <dt>Data source</dt>
          <dd>{indicator.source}</dd>
          <dt>Direction of harm</dt>
          <dd>{indicator.harm}</dd>
          <dt>Type</dt>
          <dd>{indicator.type}</dd>
          <dt>Missing-data rule</dt>
          <dd>{indicator.missing}</dd>
          <dt>Notes and edge cases</dt>
          <dd>{indicator.notes}</dd>
          <dt>Regulatory mapping</dt>
          <dd>
            {indicator.reg} · CQC key question: {indicator.kloe}
          </dd>
          {indicator.example ? (
            <>
              <dt>Worked example</dt>
              <dd>{indicator.example}</dd>
            </>
          ) : null}
        </dl>
      </Panel>

      <Panel title="Every period" flush>
        <div className="tbl-scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Period</th>
                {indicator.den ? (
                  <>
                    <th className="r">{indicator.num}</th>
                    <th className="r">{indicator.den}</th>
                  </>
                ) : null}
                <th className="r">Value</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((r) => (
                <tr key={r.period}>
                  <td className="mono small">{parsePeriod(r.period).label}</td>
                  {indicator.den ? (
                    <>
                      <td className="r num small muted">{r.numerator ?? '—'}</td>
                      <td className="r num small muted">{r.denominator?.toLocaleString() ?? '—'}</td>
                    </>
                  ) : null}
                  <td className="r num">
                    {r.value === null ? <span className="muted">—</span> : fmtBase(r.value, indicator)}
                  </td>
                  <td className="small">
                    {r.state === 'ok' ? (
                      <span className="muted">submitted</span>
                    ) : r.state === 'stale' ? (
                      <span className="chip st-none">
                        <i>·</i>stale
                      </span>
                    ) : r.state === 'off-cycle' ? (
                      <span className="muted">not due</span>
                    ) : (
                      <span className="chip st-none">
                        <i>·</i>no value
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {addingContext ? (
        <ContextDrawer
          indicatorId={indicator.id}
          indicatorName={indicator.short}
          period={data.period}
          onClose={() => setAddingContext(false)}
        />
      ) : null}
    </>
  );
}

/** The seventh test: a manager-recorded explanation travels with the period. */
function ContextDrawer({
  indicatorId,
  indicatorName,
  period,
  onClose,
}: {
  indicatorId: string;
  indicatorName: string;
  period: string;
  onClose: () => void;
}) {
  const { careHomeId } = useSelection();
  const record = useRecordContext(careHomeId);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      await record.mutateAsync({
        period: text(form, 'period'),
        indicatorIds: [indicatorId],
        text: text(form, 'text'),
      });
      onClose();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save that note.');
    }
  }

  return (
    <>
      <div className="overlay on" onClick={onClose} />
      <aside className="drawer on" role="dialog" aria-modal="true" aria-label="Record context">
        <div className="drawer-head">
          <div className="grow">
            <h2>Record known context</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <Notice variant="brand">
            Context does not change the arithmetic. It travels with the period so that whoever reads this
            indicator later sees what the management team already knew at the time.
          </Notice>
          <form onSubmit={(e) => void submit(e)} className="inline-form">
            <Field label="Indicator">
              <input value={`${indicatorId} ${indicatorName}`} readOnly />
            </Field>
            <Field label="Period">
              <input name="period" defaultValue={period} pattern="\d{4}-\d{2}" required />
            </Field>
            <Field label="What the management team already knows">
              <textarea
                name="text"
                required
                minLength={3}
                placeholder="For example: two long-term sickness cases from April onwards, both expected to return in September."
              />
            </Field>
            {message ? <Notice variant="bad">{message}</Notice> : null}
            <button
              type="submit"
              className={`btn btn-primary btn-sm${record.isPending ? ' busy' : ''}`}
              disabled={record.isPending}
            >
              Save context
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
