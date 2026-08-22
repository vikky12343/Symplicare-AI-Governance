import type { ReactNode } from 'react';

/**
 * The stat furniture every screen shares.
 *
 * A manager moving between Signals, Actions and Reports should not have to
 * relearn where the headline numbers are. One strip, one shape, one place —
 * and a tone that says what the number means rather than leaving the colour
 * to do it alone.
 */

export type StatTone = 'plain' | 'teal' | 'good' | 'warn' | 'bad' | 'info';

export interface StatProps {
  label: string;
  value: ReactNode;
  /** One line under the number: what it is measured against. */
  note?: ReactNode;
  tone?: StatTone;
  /** Values for a sparkline, oldest first. */
  spark?: number[];
  /** Proportion 0-1, drawn as a meter under the number. */
  meter?: number | null;
  onClick?: () => void;
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="statrow">{children}</div>;
}

export function Stat({ label, value, note, tone = 'plain', spark, meter, onClick }: StatProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`stat tone-${tone}${onClick ? ' tappable' : ''}`}
      {...(onClick ? { type: 'button' as const, onClick } : {})}
    >
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {meter !== undefined && meter !== null ? (
        <span className="stat-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }} />
        </span>
      ) : null}
      <span className="stat-note">
        {note}
        {spark && spark.length > 1 ? <MiniSpark values={spark} /> : null}
      </span>
    </Tag>
  );
}

/** A sparkline small enough to sit inside a stat's footer. */
export function MiniSpark({ values }: { values: number[] }) {
  const W = 56;
  const H = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(' ');
  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  return (
    <svg className={`mini-spark ${rising ? 'up' : 'down'}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * A horizontal bar chart for a handful of labelled counts.
 *
 * Horizontal because the labels are words — domains, owners, key questions —
 * and rotated text is a tax on every reading.
 */
export function BarList({
  items,
  total,
  emptyLabel = 'Nothing to show yet.',
}: {
  items: { label: string; value: number; tone?: StatTone; onClick?: () => void }[];
  /** Defaults to the largest value, so the longest bar fills the track. */
  total?: number;
  emptyLabel?: string;
}) {
  const max = total ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="stat-empty">{emptyLabel}</p>;

  return (
    <ul className="barlist">
      {items.map((i) => {
        const body = (
          <>
            <span className="barlist-label">{i.label}</span>
            <span className="barlist-track" aria-hidden="true">
              <i className={`tone-${i.tone ?? 'teal'}`} style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="barlist-value">{i.value}</span>
          </>
        );
        return (
          <li key={i.label}>
            {i.onClick ? (
              <button type="button" onClick={i.onClick}>{body}</button>
            ) : (
              <span className="barlist-row">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A ring for one proportion, with the figure in the middle. */
export function Donut({
  slices,
  total,
  caption,
  size = 96,
}: {
  slices: { label: string; value: number; colour: string }[];
  total?: number;
  caption?: string;
  size?: number;
}) {
  const sum = total ?? slices.reduce((n, s) => n + s.value, 0);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-row">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${sum} ${caption ?? 'total'}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="donut-track" strokeWidth="11" />
        {sum > 0 &&
          slices.map((s) => {
            const len = (s.value / sum) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.colour}
                strokeWidth="11"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
        <text x={size / 2} y={size / 2 - 1} textAnchor="middle" className="donut-n">{sum}</text>
        {caption ? (
          <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="donut-cap">{caption}</text>
        ) : null}
      </svg>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="donut-dot" style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const TONE_COLOUR: Record<string, string> = {
  bad: 'var(--bad)',
  warn: 'var(--watch)',
  good: 'var(--good)',
  teal: 'var(--brand)',
  info: 'var(--none)',
  plain: 'var(--faint)',
};
