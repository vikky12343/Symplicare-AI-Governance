import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCareHomes, useOverview, useSelection } from '../lib/hooks.js';
import { isNoData } from '../components/ui.js';

/**
 * The manager's opening screen.
 *
 * One viewport, read top to bottom: how are the homes, what is getting worse,
 * what is outstanding, which home needs me, what has been filed. Every figure
 * comes from the overview endpoint, which computes it from the same
 * evaluations the indicator screens use — nothing here is decorative.
 *
 * Density is deliberate. A governance review happens with the screen open and
 * people waiting, so having to scroll to find the number you are being asked
 * about is worse than a slightly smaller number.
 */

const TILES = [
  { key: 'governanceHealth', label: 'Governance health', suffix: '%', tone: 'teal' },
  { key: 'openSignals', label: 'Open signals', suffix: '', tone: 'plain' },
  { key: 'criticalSignals', label: 'Critical signals', suffix: '', tone: 'critical' },
  { key: 'openActions', label: 'Open actions', suffix: '', tone: 'amber' },
  { key: 'reports', label: 'Reports this month', suffix: '', tone: 'info' },
] as const;

export function DashboardPage() {
  const selection = useSelection();
  const homes = useCareHomes();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useOverview(selection.careHomeId, selection.period);

  if (isLoading) return <CockpitSkeleton />;
  if (error && !isNoData(error)) return <SectionError onRetry={() => void refetch()} />;

  const list = homes.data?.careHomes ?? [];
  const nothingYet = !data?.period;

  return (
    <div className="cockpit">
      <header className="ck-head">
        <div className="ck-head-text">
          <h1>{greeting()}</h1>
          <p>
            {nothingYet
              ? 'Upload a month of indicator data to start building your governance trend.'
              : data.scope.kind === 'all'
                ? `Across ${data.scope.homeCount} care home${data.scope.homeCount === 1 ? '' : 's'} · ${data.periodLabel}`
                : `${data.scope.name} · ${data.periodLabel}`}
          </p>
        </div>
        <button type="button" className="ck-refresh" onClick={() => void refetch()}>
          <RefreshIcon /> Refresh
        </button>
      </header>

      {nothingYet ? (
        <EmptyCockpit homeCount={list.length} />
      ) : (
        <div className="ck-grid">
          <section className="ck-kpis" aria-label="Headline figures">
            {TILES.map((tile) => {
              const kpi = data.kpis?.[tile.key];
              return (
                <Kpi
                  key={tile.key}
                  label={tile.label}
                  value={kpi?.value ?? null}
                  previous={kpi?.previous ?? null}
                  suffix={tile.suffix}
                  tone={tile.tone}
                  spark={tile.key === 'governanceHealth' ? data.trend.map((t) => t.value) : []}
                />
              );
            })}
          </section>

          <section className="ck-card ck-trend" aria-label="Governance health trend">
            <div className="ck-card-head">
              <h2>
                Governance health trend
                <Explain>
                  The share of indicators that could be read and are inside their normal range.
                  Not a quality score — count the statuses on the indicator list and you get the
                  same number.
                </Explain>
              </h2>
              <span className="ck-chip">{data.trend.filter((t) => t.value !== null).length} months</span>
            </div>
            <TrendChart points={data.trend} />
          </section>

          <section className="ck-card ck-signals" aria-label="Top signals">
            <div className="ck-card-head">
              <h2>Top signals</h2>
              <Link to="/signals">View all</Link>
            </div>
            {data.topSignals.length ? (
              <ul className="ck-signal-list">
                {data.topSignals.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selection.setCareHomeId(s.careHomeId);
                        void navigate('/signals');
                      }}
                    >
                      <span className={`ck-dot ${severityClass(s.severity)}`} aria-hidden="true" />
                      <span className="ck-signal-text">
                        <span className="ck-signal-title">{s.title}</span>
                        <span className="ck-signal-meta">
                          <span className={`ck-sev ${severityClass(s.severity)}`}>{s.severity}</span>
                          {data.scope.kind === 'all' ? (
                            <span className="ck-signal-home">{s.careHomeName}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="ck-signal-n">{s.indicators}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ck-quiet">
                No pattern currently meets its rule. Individual indicators are still on the{' '}
                <Link to="/indicators">indicator library</Link>.
              </p>
            )}
          </section>

          <section className="ck-card ck-actions" aria-label="Actions snapshot">
            <div className="ck-card-head">
              <h2>Actions snapshot</h2>
            </div>
            <Donut
              total={data.actions.total}
              slices={[
                { label: 'Overdue', n: data.actions.overdue, colour: 'var(--bad)' },
                { label: 'In progress', n: data.actions.inProgress, colour: 'var(--brand)' },
                { label: 'Due soon', n: data.actions.dueSoon, colour: 'var(--watch)' },
              ]}
            />
            <Link className="ck-more" to="/actions">
              View action centre <span aria-hidden="true">→</span>
            </Link>
          </section>

          <section className="ck-card ck-homes" aria-label="Care home performance">
            <div className="ck-card-head">
              <h2>Care home performance</h2>
              <Link to="/care-homes">View all</Link>
            </div>
            <div className="ck-table-wrap">
              <table className="ck-table">
                <thead>
                  <tr>
                    <th>Care home</th>
                    <th>Health</th>
                    <th>Trend</th>
                    <th>Signals</th>
                    <th>Actions</th>
                    <th>Last report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.homes.slice(0, 5).map((h) => (
                    <tr
                      key={h.id}
                      tabIndex={0}
                      onClick={() => selection.setCareHomeId(h.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') selection.setCareHomeId(h.id);
                      }}
                    >
                      <td className="ck-home-name">{h.name}</td>
                      <td className={healthClass(h.health)}>{h.health === null ? '—' : `${h.health}%`}</td>
                      <td><Spark values={h.sparkline} /></td>
                      <td>{h.openSignals ?? '—'}</td>
                      <td>{h.openActions}</td>
                      <td className="ck-quiet-cell">{h.lastReport ? shortDate(h.lastReport) : 'None yet'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ck-card ck-reports" aria-label="Recent reports">
            <div className="ck-card-head">
              <h2>Recent reports</h2>
              <Link to="/reports">View all</Link>
            </div>
            {data.reports.length ? (
              <ul className="ck-report-list">
                {data.reports.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <span className="ck-report-icon" aria-hidden="true"><DocIcon /></span>
                    <span className="ck-report-text">
                      <span className="ck-report-title">{r.kind} · {r.periodLabel}</span>
                      <span className="ck-report-home">{r.careHomeName}</span>
                    </span>
                    <span className="ck-report-date">{r.at ? shortDate(r.at) : ''}</span>
                    <button
                      type="button"
                      className="ck-mini-btn"
                      onClick={() => {
                        selection.setCareHomeId(r.careHomeId);
                        void navigate('/reports');
                      }}
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ck-quiet">
                No reports yet. <Link to="/reports">Generate the first one</Link> once a month of data is in.
              </p>
            )}
          </section>

          <section className="ck-quick" aria-label="Quick actions">
            {[
              { to: '/uploads', title: 'Upload data', sub: 'Add your monthly indicator data', icon: <UploadIcon /> },
              { to: '/signals', title: 'View signals', sub: 'See what needs attention', icon: <SignalIcon /> },
              { to: '/actions', title: 'Action centre', sub: 'Track and resolve actions', icon: <ListIcon /> },
              { to: '/reports', title: 'Generate report', sub: 'Create a governance report', icon: <DocIcon /> },
              { to: '/compare', title: 'Compare periods', sub: 'Compare performance over time', icon: <BarsIcon /> },
            ].map((q) => (
              <Link key={q.to} to={q.to} className="ck-quick-card">
                <span className="ck-quick-icon">{q.icon}</span>
                <span className="ck-quick-text">
                  <span className="ck-quick-title">{q.title}</span>
                  <span className="ck-quick-sub">{q.sub}</span>
                </span>
              </Link>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

/* ── Tiles ────────────────────────────────────────────────────── */
function Kpi({
  label,
  value,
  previous,
  suffix,
  tone,
  spark,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  suffix: string;
  tone: string;
  spark: (number | null)[];
}) {
  const shown = useCountUp(value);
  const delta = value !== null && previous !== null ? value - previous : null;
  const values = spark.filter((n): n is number => n !== null);

  return (
    <article className={`ck-kpi tone-${tone}`}>
      <span className="ck-kpi-label">{label}</span>
      <span className="ck-kpi-value">
        {value === null ? '—' : `${shown}${suffix}`}
      </span>
      <span className="ck-kpi-foot">
        {delta === null ? (
          <span className="ck-quiet-cell">No comparison yet</span>
        ) : delta === 0 ? (
          <span className="ck-quiet-cell">No change</span>
        ) : (
          <span className={delta > 0 ? 'up' : 'down'}>
            <span aria-hidden="true">{delta > 0 ? '↑' : '↓'}</span> {Math.abs(delta)}
            {suffix} vs last period
          </span>
        )}
        {values.length > 1 ? <Spark values={values} /> : null}
      </span>
    </article>
  );
}

/** A number that settles rather than snapping, unless motion is unwelcome. */
function useCountUp(target: number | null): number {
  const [n, setN] = useState(target ?? 0);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 550);
      setN(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target]);

  return target === null ? 0 : n;
}

/* ── Charts ───────────────────────────────────────────────────── */
function TrendChart({ points }: { points: { period: string; label: string; value: number | null }[] }) {
  const usable = points.filter((p): p is { period: string; label: string; value: number } => p.value !== null);
  const [hover, setHover] = useState<number | null>(null);

  if (usable.length < 2) {
    return <p className="ck-quiet">A trend needs at least two periods of data.</p>;
  }

  const W = 720;
  const H = 150;
  const pad = 12;
  const step = W / (usable.length - 1);
  const y = (v: number) => pad + (1 - v / 100) * (H - pad * 2);
  const line = usable
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const at = hover === null ? usable[usable.length - 1]! : usable[hover]!;

  return (
    <div className="ck-chart">
      <div className="ck-chart-read">
        <b>{at.value}%</b> <span>{at.label}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Governance health from ${usable[0]!.label} to ${usable[usable.length - 1]!.label}, currently ${at.value} per cent`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ckFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((g) => (
          <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} className="ck-gridline" />
        ))}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#ckFill)" />
        <path d={line} className="ck-line" />
        {usable.map((p, i) => (
          <circle
            key={p.period}
            cx={i * step}
            cy={y(p.value)}
            r={hover === i ? 5 : 3}
            className="ck-point"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="ck-chart-x" aria-hidden="true">
        {usable.map((p) => (
          <span key={p.period}>{p.label.slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
}

function Donut({ total, slices }: { total: number; slices: { label: string; n: number; colour: string }[] }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="ck-donut-row">
      <svg width="86" height="86" viewBox="0 0 86 86" role="img" aria-label={`${total} open actions`}>
        <circle cx="43" cy="43" r={r} className="ck-donut-track" />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.n / total) * c;
            const el = (
              <circle
                key={s.label}
                cx="43"
                cy="43"
                r={r}
                fill="none"
                stroke={s.colour}
                strokeWidth="10"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 43 43)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="43" y="42" textAnchor="middle" className="ck-donut-n">{total}</text>
        <text x="43" y="54" textAnchor="middle" className="ck-donut-cap">Total open</text>
      </svg>
      <ul className="ck-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="ck-legend-dot" style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
            <b>{s.n}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="ck-quiet-cell">—</span>;
  const W = 58;
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
    <svg className={`ck-spark ${rising ? 'up' : 'down'}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ── States ───────────────────────────────────────────────────── */
function CockpitSkeleton() {
  return (
    <div className="cockpit" aria-busy="true">
      <header className="ck-head">
        <div className="ck-head-text">
          <div className="sk" style={{ width: 240, height: 26 }} />
          <div className="sk" style={{ width: 340, height: 13, marginTop: 9 }} />
        </div>
      </header>
      <div className="ck-grid">
        <section className="ck-kpis">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="ck-kpi">
              <div className="sk" style={{ width: '62%', height: 10 }} />
              <div className="sk" style={{ width: '46%', height: 24, marginTop: 10 }} />
              <div className="sk" style={{ width: '78%', height: 10, marginTop: 12 }} />
            </div>
          ))}
        </section>
        {['ck-trend', 'ck-signals', 'ck-actions', 'ck-homes', 'ck-reports'].map((cls) => (
          <section key={cls} className={`ck-card ${cls}`}>
            <div className="sk sk-fill" />
          </section>
        ))}
      </div>
    </div>
  );
}

/** One section failing must not take the screen with it. */
function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="cockpit">
      <div className="ck-card ck-section-error" role="alert">
        <p>Unable to load this section.</p>
        <button type="button" className="ck-mini-btn" onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}

function EmptyCockpit({ homeCount }: { homeCount: number }) {
  return (
    <div className="ck-card ck-empty">
      <span className="ck-empty-mark" aria-hidden="true"><UploadIcon /></span>
      <div>
        <h2>No governance data yet</h2>
        <p>
          Upload your first month of indicator data to start building your governance trend.
          {homeCount > 1 ? ` You have ${homeCount} care homes set up and ready.` : ''}
        </p>
      </div>
      <div className="ck-empty-actions">
        <Link className="ck-btn primary" to="/uploads">Upload data</Link>
        <Link className="ck-btn" to="/care-homes">Manage care homes</Link>
      </div>
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────── */
function Explain({ children }: { children: ReactNode }) {
  return (
    <span className="ck-explain" tabIndex={0} role="note">
      <InfoIcon />
      <span className="ck-explain-body">{children}</span>
    </span>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function severityClass(severity: string): string {
  if (severity === 'Deteriorating') return 'critical';
  if (severity === 'Watch') return 'warn';
  if (severity === 'Improving') return 'good';
  return 'plain';
}

function healthClass(health: number | null): string {
  if (health === null) return 'ck-quiet-cell';
  if (health >= 85) return 'ck-health good';
  if (health >= 70) return 'ck-health warn';
  return 'ck-health critical';
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M20 11A8 8 0 1 0 18 16.5" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}
function SignalIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 16.5a6.4 6.4 0 0 0 0-9" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M5 20V11M12 20V4M19 20v-7" />
    </svg>
  );
}
