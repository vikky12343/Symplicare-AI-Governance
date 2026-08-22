import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useCareHomes, useSelection } from '../lib/hooks.js';
import type { Status, Tone } from '@cgi/core';
import { toneOf } from '@cgi/core';

/* Status is always shape plus word, never colour alone. */
const GLYPH: Record<Tone, string> = { bad: '▲', watch: '◆', stable: '—', good: '▼', none: '·' };

export function StatusChip({ status }: { status: Status }) {
  const tone = toneOf(status);
  return (
    <span className={`chip st-${tone}`}>
      <i aria-hidden="true">{GLYPH[tone]}</i>
      {status}
    </span>
  );
}

export function Chip({ label, tone = 'stable' }: { label: string; tone?: Tone }) {
  return (
    <span className={`chip st-${tone}`}>
      <i aria-hidden="true">{GLYPH[tone]}</i>
      {label}
    </span>
  );
}

export function Tag({ children, brand }: { children: ReactNode; brand?: boolean }) {
  return <span className={`tag${brand ? ' brand' : ''}`}>{children}</span>;
}

export function Panel({
  title,
  tools,
  children,
  flush,
}: {
  title?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel">
      {title ? (
        <div className="panel-head">
          <h2>{title}</h2>
          {tools ? <div className="tools">{tools}</div> : null}
        </div>
      ) : null}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone | '';
  onClick?: () => void;
}) {
  const className = `kpi${tone ? ` st-${tone}` : ''}${onClick ? ' tap' : ''}`;
  const content = (
    <>
      <span className="k-lab">{label}</span>
      <span className="k-val">{value}</span>
      {sub ? <span className="k-sub">{sub}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} style={{ textAlign: 'left', border: '1px solid var(--line)' }}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Every screen opens by answering the question the screen exists for. */
export function AnswerBand({
  tone,
  title,
  children,
  meta,
}: {
  tone: Tone;
  title: string;
  children: ReactNode;
  meta?: string[];
}) {
  return (
    <div className={`answer st-${tone}`}>
      <h2>{title}</h2>
      <p>{children}</p>
      {meta?.length ? (
        <div className="answer-meta">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Notice({
  children,
  variant = 'plain',
}: {
  children: ReactNode;
  variant?: 'plain' | 'brand' | 'warn' | 'bad';
}) {
  return (
    <div className={`notice${variant === 'plain' ? '' : ` ${variant}`}`}>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="load-state" role="status">
      <div className="skeleton skeleton-panel" style={{ width: '100%' }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * A home with nothing filed against it yet.
 *
 * This is the state every workspace is in on its first day, so it is not an
 * error and must not look like one. It says what is missing and offers the one
 * action that fixes it.
 */
export function isNoData(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'no_data';
}

export function NoDataState({
  title = 'No data for this care home yet',
  body = 'Upload a month of indicator data and the trend engine will start reading it. Until then there is nothing to show here — which is different from everything being fine.',
  homeName,
}: {
  title?: string;
  body?: string;
  homeName?: string;
}) {
  return (
    <div className="nodata-state">
      <span className="nodata-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4M8 8l4-4 4 4" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </svg>
      </span>
      <h3>{homeName ? `${homeName} has no data yet` : title}</h3>
      <p>{body}</p>
      <div className="nodata-actions">
        <Link className="btn btn-primary btn-sm" to="/uploads">Upload data</Link>
        <Link className="btn btn-sm" to="/care-homes">Manage care homes</Link>
      </div>
    </div>
  );
}

/**
 * Screens that answer a question about one care home.
 *
 * The dashboard aggregates the organisation; signals, indicators, reports and
 * the rest are about a particular home, so when the workspace scope is "all"
 * they ask which one rather than guessing — picking silently would show a
 * manager one home's data under a heading that said "all".
 */
export function RequireHomeScope({ children }: { children: ReactNode }) {
  const selection = useSelection();
  const homes = useCareHomes();
  const list = homes.data?.careHomes ?? [];

  if (selection.careHomeId !== 'all') return <>{children}</>;
  if (homes.isLoading) return <Loading label="Loading your care homes" />;

  return (
    <div className="scope-prompt">
      <h2>Which care home?</h2>
      <p>
        This screen looks at one care home at a time. The dashboard is where the whole
        organisation is shown together.
      </p>
      <div className="scope-prompt-list">
        {list.map((home) => (
          <button key={home.id} type="button" onClick={() => selection.setCareHomeId(home.id)}>
            <b>{home.name}</b>
            {home.town ? <span>{home.town}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  /* "Nothing here yet" is not a failure, and a red alert would teach the
     manager to distrust the screen on the one day it is guaranteed to appear. */
  if (isNoData(error)) return <NoDataState />;

  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="error-state" role="alert">
      <h3>That did not load</h3>
      <p>{message}</p>
      {retry ? (
        <button type="button" className="btn btn-sm" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  error,
  children,
  wide,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

export function Legend() {
  const items: [Tone, string][] = [
    ['bad', 'Deteriorating'],
    ['watch', 'Watch'],
    ['stable', 'Stable'],
    ['good', 'Improving'],
    ['none', 'Insufficient data'],
  ];
  return (
    <div className="legend">
      {items.map(([tone, label]) => (
        <span key={tone}>
          <span className={`sw st-${tone}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="glass-overlay" onClick={onClose}>
      <div className="glass-modal animate-in" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{title}</h2>
          <div className="tools">
            <button type="button" onClick={onClose} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 24, color: 'var(--muted)' }}>
              &times;
            </button>
          </div>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
