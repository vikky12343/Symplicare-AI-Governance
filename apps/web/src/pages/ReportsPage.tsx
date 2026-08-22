import { useState } from 'react';
import {
  useApproveReport,
  useCan,
  useGenerateReport,
  useReport,
  useReports,
  useSelection,
} from '../lib/hooks.js';
import { AnswerBand, Chip, ErrorState, Field, Loading, Notice, Panel, StatusChip } from '../components/ui.js';
import { Stat, StatRow } from '../components/stats.js';
import { ApiError, type ReportRecord } from '../lib/api.js';
import { text } from '../lib/forms.js';

export function ReportsPage() {
  const { careHomeId, period } = useSelection();
  const can = useCan();
  const { data, isLoading, error, refetch } = useReports(careHomeId);
  const generate = useGenerateReport(careHomeId);
  const [viewing, setViewing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (isLoading) return <Loading label="Loading reports" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  async function submitGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      const result = await generate.mutateAsync({
        period: text(form, 'period'),
        commentary: text(form, 'commentary'),
      });
      setGenerating(false);
      setViewing(result.report.id);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not generate that report.');
    }
  }

  const reports = data.reports;
  const approved = reports.filter((r) => r.approvalStatus === 'Approved');
  const awaiting = reports.filter((r) => r.approvalStatus === 'Awaiting approval');
  const superseded = reports.filter((r) => r.approvalStatus === 'Superseded');
  const periodsCovered = new Set(reports.map((r) => r.period)).size;
  const corrected = reports.filter((r) => r.version > 1).length;

  return (
    <>
      <div className="view-head">
        <h1>Reports</h1>
        <p>Versioned history. A correction creates a version; the superseded one stays readable.</p>
      </div>

      <StatRow>
        <Stat label="Reports stored" value={reports.length} note={`${periodsCovered} period${periodsCovered === 1 ? '' : 's'} covered`} tone="teal" />
        <Stat
          label="Approved"
          value={approved.length}
          note={`${reports.length ? Math.round((approved.length / reports.length) * 100) : 0}% of the history`}
          tone="good"
          meter={reports.length ? approved.length / reports.length : 0}
        />
        <Stat
          label="Awaiting approval"
          value={awaiting.length}
          note={awaiting.length ? 'Needs a signature' : 'Nothing waiting'}
          tone={awaiting.length ? 'warn' : 'good'}
        />
        <Stat label="Superseded" value={superseded.length} note="Still readable" tone="plain" />
        <Stat
          label="Corrections issued"
          value={corrected}
          note={corrected ? 'A version, never an overwrite' : 'No corrections yet'}
          tone={corrected ? 'info' : 'plain'}
        />
      </StatRow>

      <AnswerBand
        tone="good"
        title="A report history that cannot be quietly rewritten"
        meta={[
          `${data.reports.length} report${data.reports.length === 1 ? '' : 's'} stored`,
          'Nothing is overwritten',
        ]}
      >
        Every report keeps the exact indicator values it was generated from, its data version, the thresholds in
        force at the time, its author and its approval state. That is what makes a governance record defensible
        months later.
      </AnswerBand>

      <Panel
        title="Report history"
        tools={
          can('generateReports') ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setGenerating(true)}>
              Generate report
            </button>
          ) : null
        }
        flush
      >
        {data.reports.length === 0 ? (
          <div className="empty">
            No reports yet. Generating one freezes the current period's numbers into a versioned record.
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Period</th>
                  <th>Version</th>
                  <th>Data version</th>
                  <th>Generated</th>
                  <th>Approval</th>
                  <th className="r" />
                </tr>
              </thead>
              <tbody>
                {data.reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <div className="ind-cell">
                        <span className="id">{report.reference}</span>
                        <span className="nm">{report.kind}</span>
                      </div>
                    </td>
                    <td className="mono small">{report.periodLabel}</td>
                    <td className="num small">v{report.version}</td>
                    <td className="mono tiny muted">{report.dataVersion}</td>
                    <td className="small muted">
                      {report.generatedAt ? new Date(report.generatedAt).toLocaleString('en-GB') : '—'}
                      <div className="tiny">{report.generatedByName}</div>
                    </td>
                    <td>
                      <Chip
                        label={report.approvalStatus}
                        tone={
                          report.approvalStatus === 'Approved'
                            ? 'good'
                            : report.approvalStatus === 'Superseded'
                              ? 'none'
                              : 'watch'
                        }
                      />
                      {report.approvedByName ? (
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          {report.approvedByName}
                        </div>
                      ) : null}
                    </td>
                    <td className="r">
                      <button type="button" className="btn btn-sm" onClick={() => setViewing(report.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {generating ? (
        <>
          <div className="overlay on" onClick={() => setGenerating(false)} />
          <aside className="drawer on" role="dialog" aria-modal="true" aria-label="Generate report">
            <div className="drawer-head">
              <div className="grow">
                <h2>Generate a governance report</h2>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setGenerating(false)}>
                Close
              </button>
            </div>
            <div className="drawer-body">
              <Notice variant="brand">
                The report freezes this period's values, statuses, signals and thresholds. Generating a second
                report for the same period creates version 2 and marks the earlier one superseded — it is never
                replaced.
              </Notice>
              <form onSubmit={(e) => void submitGenerate(e)} className="inline-form">
                <Field label="Reporting period">
                  <input name="period" defaultValue={period ?? ''} pattern="\d{4}-\d{2}" required />
                </Field>
                <Field label="Management commentary">
                  <textarea
                    name="commentary"
                    placeholder="What the management team wants on the record alongside the numbers."
                  />
                </Field>
                {message ? <Notice variant="bad">{message}</Notice> : null}
                <button
                  type="submit"
                  className={`btn btn-primary btn-sm${generate.isPending ? ' busy' : ''}`}
                  disabled={generate.isPending}
                >
                  Generate
                </button>
              </form>
            </div>
          </aside>
        </>
      ) : null}

      {viewing ? <ReportDrawer reportId={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function ReportDrawer({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const { careHomeId } = useSelection();
  const can = useCan();
  const { data, isLoading } = useReport(careHomeId, reportId);
  const approve = useApproveReport(careHomeId);
  const [message, setMessage] = useState<string | null>(null);

  const report: ReportRecord | undefined = data?.report;

  return (
    <>
      <div className="overlay on" onClick={onClose} />
      <aside className="drawer on" role="dialog" aria-modal="true" aria-label="Governance report">
        <div className="drawer-head">
          <div className="grow">
            <div className="row gap-8 wrap" style={{ marginBottom: 6 }}>
              <span className="mono tiny muted">{report?.reference}</span>
              {report ? <Chip label={`Version ${report.version}`} tone="stable" /> : null}
              {report ? (
                <Chip
                  label={report.approvalStatus}
                  tone={report.approvalStatus === 'Approved' ? 'good' : report.approvalStatus === 'Superseded' ? 'none' : 'watch'}
                />
              ) : null}
            </div>
            <h2>Governance report</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-body">
          {isLoading || !report ? (
            <Loading />
          ) : (
            <>
              <div className="doc" style={{ padding: 0, border: 0 }}>
                <div className="doc-head">
                  <h1>{report.kind}</h1>
                  <div className="small muted">{report.periodLabel}</div>
                  <div className="doc-meta">
                    <div>
                      <span>Report</span>
                      <span className="mono">
                        {report.reference} v{report.version}
                      </span>
                    </div>
                    <div>
                      <span>Data version</span>
                      <span className="mono">{report.dataVersion}</span>
                    </div>
                    <div>
                      <span>Generated</span>
                      <span>{report.generatedAt ? new Date(report.generatedAt).toLocaleString('en-GB') : '—'}</span>
                    </div>
                    <div>
                      <span>By</span>
                      <span>{report.generatedByName}</span>
                    </div>
                    <div>
                      <span>Approval</span>
                      <span>
                        {report.approvalStatus}
                        {report.approvedByName ? ` — ${report.approvedByName}` : ''}
                      </span>
                    </div>
                    <div>
                      <span>Completeness</span>
                      <span>
                        {report.snapshot?.quality.pct}% ({report.snapshot?.quality.got}/
                        {report.snapshot?.quality.due})
                      </span>
                    </div>
                  </div>
                </div>

                <h2>Position at the end of the period</h2>
                <p>
                  {report.snapshot?.counts.Deteriorating} indicator
                  {report.snapshot?.counts.Deteriorating === 1 ? '' : 's'} met the threshold for deterioration,{' '}
                  {report.snapshot?.counts.Watch} were on watch, {report.snapshot?.counts.Stable} sat within the
                  normal range for this home, {report.snapshot?.counts.Improving} improved and{' '}
                  {report.snapshot?.counts['Insufficient data']} could not be calculated. Each status was
                  measured against this home's own preceding {report.rules?.baselineWindow} periods.
                </p>

                <h2>Patterns raised for review</h2>
                {report.snapshot?.signals.length ? (
                  report.snapshot.signals.map((signal) => (
                    <div key={signal.id}>
                      <h3>
                        {signal.title} <StatusChip status={signal.severity} />
                      </h3>
                      <p>{signal.narrative}</p>
                    </div>
                  ))
                ) : (
                  <p>No pattern met its rule in this period.</p>
                )}

                <h2>Indicator table</h2>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Indicator</th>
                      <th className="r">Value</th>
                      <th className="r">Baseline</th>
                      <th className="r">Change</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.snapshot?.indicators.map((row) => (
                      <tr key={row.indicatorId}>
                        <td>{row.indicatorId}</td>
                        <td className="r num">{row.value ?? '—'}</td>
                        <td className="r num muted">{row.baseline?.toFixed(2) ?? '—'}</td>
                        <td className="r num">{row.changePct === null ? '—' : `${row.changePct}%`}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {report.commentary ? (
                  <>
                    <h2>Management commentary</h2>
                    <p>{report.commentary}</p>
                  </>
                ) : null}

                <div className="doc-sign">
                  Prepared from dataset {report.dataVersion} under the thresholds recorded with this version.
                  Signals in this report are prompts for governance review. They are not predictions, not a
                  statement about the safety of the service, and not a regulatory judgement.
                </div>
              </div>

              {message ? <Notice variant="bad">{message}</Notice> : null}

              <div className="row gap-8 no-print">
                <button type="button" className="btn btn-sm" onClick={() => window.print()}>
                  Print / save as PDF
                </button>
                {can('approveReports') && report.approvalStatus === 'Awaiting approval' ? (
                  <button
                    type="button"
                    className={`btn btn-sm btn-primary${approve.isPending ? ' busy' : ''}`}
                    disabled={approve.isPending}
                    onClick={() => void (async () => {
                      setMessage(null);
                      try {
                        await approve.mutateAsync(report.id);
                      } catch (err) {
                        setMessage(err instanceof ApiError ? err.message : 'Could not approve that report.');
                      }
                    })()}
                  >
                    Approve
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
