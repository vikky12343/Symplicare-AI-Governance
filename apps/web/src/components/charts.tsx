import { useId } from 'react';
import type { Indicator, Reading, Status, Tone } from '@cgi/core';
import { fmtSigned, fmtUnit, parsePeriod, toneOf, unitSuffix } from '@cgi/core';

/**
 * Charts, as hand-built SVG.
 *
 * No chart library: the shapes here are simple, and owning them means the
 * baseline corridor and the gap handling behave exactly as the engine intends
 * rather than as a library's defaults allow.
 */

export interface Band {
  period: string;
  lo: number;
  hi: number;
  mid: number;
}

interface LineChartProps {
  readings?: Reading[];
  indicator: Indicator;
  status?: Status;
  corridor?: (Band | null)[];
  height?: number;
  showAxis?: boolean;
  marks?: number[];
}

export function LineChart({
  readings: input,
  indicator,
  status,
  corridor,
  height = 200,
  showAxis = false,
  marks = [],
}: LineChartProps) {
  const gradientId = useId();
  const W = 100;
  const H = height > 120 ? 34 : 24;
  const padTop = 3;
  const padBottom = showAxis ? 9 : 3;

  const readings = input ?? [];
  const values = readings.filter((r) => r.value !== null).map((r) => r.value as number);
  if (values.length === 0) {
    return <div className="chart-empty">No submitted values in this window</div>;
  }

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  for (const band of corridor ?? []) {
    if (!band) continue;
    lo = Math.min(lo, band.lo);
    hi = Math.max(hi, band.hi);
  }
  if (hi === lo) {
    const pad = Math.max(Math.abs(lo) * 0.1, 1);
    hi += pad;
    lo -= pad;
  }
  const pad = (hi - lo) * 0.14;
  lo -= pad;
  hi += pad;

  const x = (i: number) => (readings.length === 1 ? W / 2 : (i / (readings.length - 1)) * W);
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * (H - padTop - padBottom);

  /* Segments break wherever a period has no value — gaps are shown, not bridged. */
  const segments: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  readings.forEach((r, i) => {
    if (r.value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ i, v: r.value });
  });
  if (current.length) segments.push(current);

  /* The baseline is recomputed every period, so it is drawn as a moving
     corridor. A single flat band would imply a fixed target. */
  const corridorRuns: { i: number; band: Band }[][] = [];
  if (corridor) {
    let run: { i: number; band: Band }[] = [];
    corridor.forEach((band, i) => {
      if (!band) {
        if (run.length) corridorRuns.push(run);
        run = [];
        return;
      }
      run.push({ i, band });
    });
    if (run.length) corridorRuns.push(run);
  }

  const tone: Tone = status ? toneOf(status) : 'stable';
  const last = segments.at(-1)?.at(-1);

  return (
    <>
      <div className={`chart st-${tone}`} style={{ ['--chart-h' as string]: `${height}px` }}>
        <svg
          className="line-chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${indicator.short} over ${readings.length} periods`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="area-top" />
              <stop offset="100%" className="area-bottom" />
            </linearGradient>
          </defs>

          {corridorRuns.map((run, k) => {
            if (run.length < 2) return null;
            const up = run.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(p.band.hi).toFixed(2)}`).join(' ');
            const down = [...run].reverse().map((p) => `L${x(p.i).toFixed(2)} ${y(p.band.lo).toFixed(2)}`).join(' ');
            const mid = run.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(p.band.mid).toFixed(2)}`).join(' ');
            return (
              <g key={k}>
                <path className="band" d={`${up} ${down} Z`} />
                <path className="band-mid" d={mid} />
              </g>
            );
          })}

          {marks.map((i) => (
            <line key={i} className="mark" x1={x(i)} x2={x(i)} y1={padTop} y2={H - padBottom} />
          ))}

          {segments.map((segment, k) => {
            const d = segment.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(' ');
            if (segment.length === 1) {
              const only = segment[0]!;
              return <circle key={k} className="dot" cx={x(only.i)} cy={y(only.v)} r={0.9} />;
            }
            const first = segment[0]!;
            const end = segment.at(-1)!;
            return (
              <g key={k}>
                <path
                  className="area"
                  d={`${d} L${x(end.i).toFixed(2)} ${H - padBottom} L${x(first.i).toFixed(2)} ${H - padBottom} Z`}
                  fill={`url(#${gradientId})`}
                />
                <path className="line" d={d} />
              </g>
            );
          })}

          {/* A carried-forward reading is drawn hollow, so a stale value never
              looks like a fresh one. */}
          {readings.map((r, i) =>
            r.state === 'stale' && r.value !== null ? (
              <circle key={r.period} className="dot-stale" cx={x(i)} cy={y(r.value)} r={0.9} />
            ) : null,
          )}

          {last ? <circle className="dot-end" cx={x(last.i)} cy={y(last.v)} r={0.85} /> : null}
        </svg>

        <div className="chart-hover">
          {readings.map((r, i) => (
            <span
              key={r.period}
              className="ch-col"
              style={{ left: `${(i / readings.length) * 100}%`, width: `${100 / readings.length}%` }}
              title={`${parsePeriod(r.period).label} · ${
                r.value === null
                  ? r.state === 'off-cycle'
                    ? 'not due (quarterly)'
                    : 'no value submitted'
                  : `${fmtUnit(r.value, indicator)}${r.state === 'stale' ? ' (stale)' : ''}`
              }`}
            />
          ))}
        </div>
      </div>

      {showAxis ? <Axis readings={readings} /> : null}
    </>
  );
}

function Axis({ readings }: { readings: Reading[] }) {
  const step = Math.ceil(readings.length / 6);
  return (
    <div className="chart-axis">
      {readings.map((r, i) => {
        if (i % step !== 0 && i !== readings.length - 1) return null;
        const style =
          i === 0
            ? { left: 0, transform: 'none' }
            : i === readings.length - 1
              ? { right: 0, left: 'auto', transform: 'none' }
              : { left: `${(i / (readings.length - 1)) * 100}%` };
        return (
          <span key={r.period} style={style}>
            {parsePeriod(r.period).short}
          </span>
        );
      })}
    </div>
  );
}

export function Sparkline({
  readings,
  status,
}: {
  readings?: { period: string; value: number | null; state?: Reading['state'] }[];
  status?: Status;
}) {
  /* A sparkline with nothing to draw is a dash, never a crash. */
  if (!readings?.length) return <span className="spark-empty">—</span>;
  const values = readings.filter((r) => r.value !== null).map((r) => r.value as number);
  if (values.length < 2) return <span className="spark-empty">—</span>;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const W = 60;
  const H = 18;
  const x = (i: number) => (i / (readings.length - 1)) * W;
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo)) * (H - 4);

  const segments: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  readings.forEach((r, i) => {
    if (r.value === null) {
      if (run.length) segments.push(run);
      run = [];
      return;
    }
    run.push({ i, v: r.value });
  });
  if (run.length) segments.push(run);

  const last = segments.at(-1)?.at(-1);

  return (
    <svg className={`spark st-${status ? toneOf(status) : 'stable'}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {segments.map((segment, k) =>
        segment.length < 2 ? null : (
          <path key={k} d={segment.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')} />
        ),
      )}
      {/* A missing month is drawn as a tick on the floor, never left invisible. */}
      {readings.map((r, i) =>
        r.value === null ? <line key={r.period} className="gap" x1={x(i)} x2={x(i)} y1={H - 2} y2={H - 4.5} /> : null,
      )}
      {last ? <circle cx={x(last.i)} cy={y(last.v)} r={1.6} /> : null}
    </svg>
  );
}

/** Month-on-month movement: above the line is toward harm. */
export function DeltaColumns({ readings, indicator }: { readings: Reading[]; indicator: Indicator }) {
  const sign = indicator.harm === 'Lower = worse' ? -1 : 1;
  const deltas: { period: string; d: number | null }[] = [];
  let previous: number | null = null;
  for (const r of readings) {
    if (r.value === null) {
      deltas.push({ period: r.period, d: null });
      continue;
    }
    deltas.push({ period: r.period, d: previous === null ? null : Number((r.value - previous).toFixed(3)) });
    previous = r.value;
  }

  const magnitudes = deltas.filter((d) => d.d !== null).map((d) => Math.abs(d.d as number));
  const max = Math.max(...magnitudes, 0.0001);

  return (
    <div className="delta-cols">
      {deltas.map((d) => {
        if (d.d === null) {
          return <span key={d.period} className="dc dc-none" title={`${parsePeriod(d.period).label} · not comparable`} />;
        }
        const harmful = Math.sign(d.d) === sign;
        const h = Math.max(2, (Math.abs(d.d) / max) * 46);
        return (
          <span
            key={d.period}
            className={`dc ${harmful ? 'dc-bad' : 'dc-good'}`}
            title={`${parsePeriod(d.period).label} · ${fmtSigned(d.d, indicator.dp)}${unitSuffix(indicator)} on the previous period`}
          >
            <b style={{ height: `${h.toFixed(1)}%`, ...(d.d * sign > 0 ? { bottom: '50%' } : { top: '50%' }) }} />
          </span>
        );
      })}
      <span className="dc-axis" />
    </div>
  );
}

export function Bars({
  items,
}: {
  items: { label: string; value: number; display?: string; tone?: Tone }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bars">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span className="bar-lab">{item.label}</span>
          <span className="bar-track">
            <span className={`bar-fill st-${item.tone ?? 'stable'}`} style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="bar-val mono">{item.display ?? item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Ring({ pct, label, tone = 'stable' }: { pct: number; label: string; tone?: Tone }) {
  const r = 15.9155;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring st-${tone}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="ring-bg" cx="20" cy="20" r={r} />
        <circle className="ring-fg" cx="20" cy="20" r={r} strokeDasharray={`${((c * pct) / 100).toFixed(2)} ${c.toFixed(2)}`} />
      </svg>
      <span className="ring-val mono">
        {pct}
        <i>%</i>
      </span>
      <span className="ring-lab">{label}</span>
    </div>
  );
}

/** Rows are indicators, columns are periods — two years on one screen. */
export function Heatmap({
  indicators,
  periods,
  statusAt,
  onSelect,
}: {
  indicators: { id: string; short: string }[];
  periods: string[];
  statusAt: (indicatorId: string, period: string) => Status;
  onSelect?: (indicatorId: string) => void;
}) {
  return (
    <div className="heat-scroll">
      <table className="heat">
        <thead>
          <tr>
            <th className="heat-lab">Indicator</th>
            {periods.map((p, k) => (
              <th key={p} className={`heat-per${parsePeriod(p).month === 1 ? ' year-edge' : ''}`}>
                <span>{k % 2 === 0 || k === periods.length - 1 ? parsePeriod(p).short : ''}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indicators.map((ind) => (
            <tr key={ind.id}>
              <th className="heat-lab">
                <button
                  type="button"
                  onClick={() => onSelect?.(ind.id)}
                  style={{ border: 0, background: 'none', cursor: onSelect ? 'pointer' : 'default', padding: 0, font: 'inherit', color: 'inherit' }}
                >
                  <span className="mono">{ind.id}</span> {ind.short}
                </button>
              </th>
              {periods.map((p) => {
                const status = statusAt(ind.id, p);
                const tone = toneOf(status);
                const tip = `${ind.id} · ${parsePeriod(p).label} · ${status}`;
                return (
                  <td
                    key={p}
                    className={`heat-cell st-${tone}${parsePeriod(p).month === 1 ? ' year-edge' : ''}`}
                    title={tip}
                    aria-label={tip}
                  >
                    <i>{tone === 'bad' ? '▲' : tone === 'watch' ? '◆' : tone === 'good' ? '▼' : tone === 'none' ? '·' : '—'}</i>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
