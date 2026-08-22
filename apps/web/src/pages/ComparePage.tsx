import { useState } from 'react';
import { fmtSigned, shiftPeriod } from '@cgi/core';
import { useComparison, useSelection } from '../lib/hooks.js';
import { AnswerBand, ErrorState, Loading, Panel, StatusChip, Tag } from '../components/ui.js';
import { BarList, Donut, Stat, StatRow, TONE_COLOUR } from '../components/stats.js';

const MODES: { key: string; label: string; months: number }[] = [
  { key: 'prev-month', label: 'Previous month', months: 1 },
  { key: 'prev-quarter', label: 'Three months back', months: 3 },
  { key: 'six-months', label: 'Six months back', months: 6 },
  { key: 'year', label: 'Same month last year', months: 12 },
];

export function ComparePage() {
  const { careHomeId, period } = useSelection();
  const [mode, setMode] = useState(MODES[0]!);

  const to = period;
  const from = period ? shiftPeriod(period, -mode.months) : null;
  const { data, isLoading, error, refetch } = useComparison(careHomeId, from, to);

  if (isLoading) return <Loading label="Comparing periods" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const tone = data.deteriorated.length > data.improved.length ? 'bad' : data.improved.length ? 'good' : 'watch';
  const short = (id: string) => data.indicators[id]?.short ?? id;

  /* The single biggest mover, so the headline names it rather than making
     the manager scan the table for it. */
  const movers = data.rows
    .filter((r) => r.pct !== null)
    .sort((a, b) => Math.abs(b.pct as number) - Math.abs(a.pct as number));
  const biggest = movers[0];
  const qualityShift = data.quality.to.pct - data.quality.from.pct;

  return (
    <>
      <div className="view-head">
        <h1>Compare periods</h1>
        <p>Any two comparable periods, with the movement rule stated.</p>
      </div>

      <StatRow>
        <Stat
          label="Deteriorated"
          value={data.deteriorated.length}
          note={`of ${data.rows.length} indicators`}
          tone={data.deteriorated.length ? 'bad' : 'good'}
          meter={data.rows.length ? data.deteriorated.length / data.rows.length : 0}
        />
        <Stat
          label="Improved"
          value={data.improved.length}
          note="Moved the helpful way"
          tone={data.improved.length ? 'good' : 'plain'}
          meter={data.rows.length ? data.improved.length / data.rows.length : 0}
        />
        <Stat label="Broadly stable" value={data.stable.length} note="Inside ordinary variation" tone="plain" />
        <Stat
          label="Not comparable"
          value={data.notComparable.length}
          note={data.notComparable.length ? 'A gap in one period' : 'Every indicator comparable'}
          tone={data.notComparable.length ? 'info' : 'good'}
        />
        <Stat
          label="Biggest mover"
          value={biggest ? <span className="stat-word">{short(biggest.indicatorId)}</span> : '—'}
          note={
            biggest
              ? `${(biggest.pct as number) > 0 ? '+' : ''}${Math.round(biggest.pct as number)}% · ${biggest.movement}`
              : 'Nothing comparable'
          }
          tone={biggest && data.deteriorated.includes(biggest.indicatorId) ? 'bad' : 'teal'}
        />
      </StatRow>

      <div className="grid g-2">
        <Panel title="How the fifteen moved">
          <Donut
            slices={[
              { label: 'Deteriorated', value: data.deteriorated.length, colour: TONE_COLOUR.bad as string },
              { label: 'Improved', value: data.improved.length, colour: TONE_COLOUR.good as string },
              { label: 'Broadly stable', value: data.stable.length, colour: TONE_COLOUR.plain as string },
              { label: 'Not comparable', value: data.notComparable.length, colour: TONE_COLOUR.info as string },
            ]}
            caption="indicators"
          />
        </Panel>
        <Panel title="Signals and data between the two periods">
          <BarList
            items={[
              { label: 'New signals', value: data.newSignals.length, tone: 'bad' },
              { label: 'Resolved', value: data.resolvedSignals.length, tone: 'good' },
              {
                label: `Completeness ${qualityShift >= 0 ? '+' : ''}${qualityShift}pp`,
                value: data.quality.to.pct,
                tone: qualityShift >= 0 ? 'good' : 'warn',
              },
            ]}
          />
        </Panel>
      </div>

      <AnswerBand
        tone={tone}
        title={`${data.fromLabel} compared with ${data.toLabel}`}
        meta={[
          `${data.newSignals.length} new signal${data.newSignals.length === 1 ? '' : 's'}`,
          `${data.resolvedSignals.length} resolved`,
          `Data completeness ${data.quality.from.pct}% → ${data.quality.to.pct}%`,
        ]}
      >
        <b>{data.deteriorated.length} deteriorated</b>, {data.improved.length} improved, {data.stable.length}{' '}
        broadly stable and {data.notComparable.length} not comparable. A movement only counts when it clears
        both a material percentage against the earlier value and the indicator's own normal spread — otherwise
        it is ordinary variation.
      </AnswerBand>

      <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`btn btn-sm${mode.key === m.key ? ' btn-primary' : ''}`}
            onClick={() => setMode(m)}
          >
            {m.label}
          </button>
        ))}
        <span className="grow" />
        <span className="tiny muted mono">
          {data.fromPeriod} → {data.toPeriod}
        </span>
      </div>

      <div className="grid g-3">
        {(
          [
            ['Deteriorated', data.deteriorated, 'bad'],
            ['Improved', data.improved, 'good'],
            ['Broadly stable', [...data.stable, ...data.notComparable], 'stable'],
          ] as const
        ).map(([title, ids, chipTone]) => (
          <Panel
            key={title}
            title={
              <>
                {title}{' '}
                <span className={`chip st-${chipTone}`} style={{ marginLeft: 6 }}>
                  {ids.length}
                </span>
              </>
            }
          >
            {ids.length === 0 ? (
              <div className="empty">None.</div>
            ) : (
              <div className="stack gap-8">
                {ids.map((id) => {
                  const row = data.rows.find((r) => r.indicatorId === id);
                  return (
                    <div className="row gap-8" key={id} style={{ justifyContent: 'space-between' }}>
                      <span className="small">
                        <span className="mono tiny" style={{ color: 'var(--faint)' }}>
                          {id}
                        </span>{' '}
                        {short(id)}
                      </span>
                      <span className="num small">
                        {row?.pct === null || row?.pct === undefined ? '—' : `${fmtSigned(row.pct, 0)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Panel
        title="Executive comparison"
        tools={
          <button type="button" className="btn btn-sm no-print" onClick={() => window.print()}>
            Print / save as PDF
          </button>
        }
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Indicator</th>
                <th className="r">{data.fromLabel}</th>
                <th className="r">{data.toLabel}</th>
                <th className="r">Change</th>
                <th className="r">%</th>
                <th>Movement</th>
                <th>Status now</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const dp = data.indicators[row.indicatorId]?.dp ?? 2;
                return (
                  <tr key={row.indicatorId}>
                    <td>
                      <div className="ind-cell">
                        <span className="id">{row.indicatorId}</span>
                        <span className="nm">{short(row.indicatorId)}</span>
                      </div>
                    </td>
                    <td className="r num muted">{row.from === null ? '—' : row.from.toFixed(dp)}</td>
                    <td className="r num">{row.to === null ? '—' : row.to.toFixed(dp)}</td>
                    <td className="r num">{row.delta === null ? <span className="muted">—</span> : fmtSigned(row.delta, dp)}</td>
                    <td className="r num">{row.pct === null ? <span className="muted">—</span> : `${fmtSigned(row.pct, 0)}%`}</td>
                    <td>
                      <Tag>{row.movement}</Tag>
                    </td>
                    <td>
                      <StatusChip status={row.statusNow} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {data.newSignals.length || data.resolvedSignals.length ? (
        <div className="grid g-2e" style={{ marginTop: 14 }}>
          <Panel title={`New signals in ${data.toLabel}`}>
            {data.newSignals.length ? (
              <div className="stack gap-10">
                {data.newSignals.map((signal) => (
                  <div key={signal.id}>
                    <div className="row gap-8">
                      <StatusChip status={signal.severity} />
                      <b className="small">{signal.title}</b>
                    </div>
                    <p className="tiny muted" style={{ marginTop: 4 }}>
                      {signal.narrative}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">None.</div>
            )}
          </Panel>

          <Panel title="Signals no longer raised">
            {data.resolvedSignals.length ? (
              <div className="stack gap-8">
                {data.resolvedSignals.map((signal) => (
                  <div className="row gap-8" key={signal.id}>
                    <StatusChip status="Improving" />
                    <b className="small">{signal.title}</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">None.</div>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
