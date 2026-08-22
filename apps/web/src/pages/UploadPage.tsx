import { useRef, useState } from 'react';
import { parsePeriod } from '@cgi/core';
import { useCareHomes, useDatasets, useInvalidateAnalysis, useSelection } from '../lib/hooks.js';
import { AnswerBand, Notice, Panel } from '../components/ui.js';
import { Stat, StatRow } from '../components/stats.js';
import { ApiError, api, type ImportResult } from '../lib/api.js';

const STEPS = ['Upload', 'Validate', 'Preview', 'Commit'];

/** The period a first upload almost always covers. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function UploadPage() {
  const selection = useSelection();
  const { careHomeId, period } = selection;
  const homes = useCareHomes();
  const datasets = useDatasets(careHomeId);
  const invalidate = useInvalidateAnalysis();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'bad' | 'good' } | null>(null);
  const [dragging, setDragging] = useState(false);

  const sets = datasets.data?.datasets ?? [];
  const periodsFiled = new Set(sets.map((d) => d.period)).size;
  const rowsAccepted = sets.reduce((n, d) => n + d.rowsAccepted, 0);
  const rowsRejected = sets.reduce((n, d) => n + d.rowsRejected, 0);
  const warnings = sets.reduce((n, d) => n + d.warnings, 0);
  const corrections = sets.filter((d) => d.version > 1).length;
  const latest = sets[0];

  async function handleFile(file: File | undefined) {
    if (!file || !careHomeId) return;
    setMessage(null);
    setResult(null);
    setBusy(true);
    setStage(1);

    const form = new FormData();
    form.append('file', file);

    try {
      const validated = await api.upload<ImportResult>(
        `/api/care-homes/${careHomeId}/imports/validate`,
        form,
      );
      setResult(validated);
      setStage(2);
    } catch (err) {
      setStage(0);
      setMessage({
        text: err instanceof ApiError ? err.message : 'That file could not be read.',
        tone: 'bad',
      });
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!result || !careHomeId) return;
    setBusy(true);
    setMessage(null);
    try {
      const committed = await api.post<{ version: number; valuesWritten: number; period: string }>(
        `/api/care-homes/${careHomeId}/imports/commit`,
        { ticket: result.ticket },
      );
      setStage(3);
      setResult(null);
      invalidate();
      setMessage({
        text: `Committed ${committed.valuesWritten} values as version ${committed.version} of ${parsePeriod(committed.period).label}. Every status has been recalculated.`,
        tone: 'good',
      });
    } catch (err) {
      setMessage({
        text: err instanceof ApiError ? err.message : 'That import could not be committed.',
        tone: 'bad',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>Data uploads</h1>
        <p>Excel and CSV against the standard template, validated before anything is written.</p>
      </div>

      <StatRow>
        <Stat
          label="Submissions filed"
          value={sets.length}
          note={`${periodsFiled} period${periodsFiled === 1 ? '' : 's'} covered`}
          tone="teal"
        />
        <Stat
          label="Rows accepted"
          value={rowsAccepted.toLocaleString('en-GB')}
          note={rowsRejected ? `${rowsRejected} rejected` : 'None rejected'}
          tone="good"
        />
        <Stat
          label="Corrections"
          value={corrections}
          note={corrections ? 'A new version each time' : 'No file superseded yet'}
          tone={corrections ? 'info' : 'plain'}
        />
        <Stat
          label="Warnings"
          value={warnings}
          note={warnings ? 'Accepted with a note' : 'Nothing flagged'}
          tone={warnings ? 'warn' : 'good'}
        />
        <Stat
          label="Last upload"
          value={latest?.uploadedAt
            ? <span className="stat-word">{new Date(latest.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
            : '—'}
          note={latest ? `${parsePeriod(latest.period).label} by ${latest.uploadedBy}` : 'Nothing filed yet'}
          tone="plain"
        />
      </StatRow>

      <AnswerBand
        tone="good"
        title="Bring a month of data in, and see exactly what will change"
        meta={['Canonical key: indicator_id', 'Missing values are never converted to zero']}
      >
        Nothing is written until you have seen the validation result and the preview. A file that does not match
        the template produces a list of errors you can act on, not a silent partial import.
      </AnswerBand>

      {/* Which home this file belongs to is stated before the file is chosen.
          A misfiled month is far harder to notice than a refused upload. */}
      <Panel>
        <div className="upload-target">
          <label htmlFor="upload-home">
            <b>Upload data for</b>
            <span className="small muted">Every row in this file is filed against the home you pick here.</span>
          </label>
          <select
            id="upload-home"
            value={careHomeId ?? ''}
            onChange={(e) => selection.setCareHomeId(e.target.value)}
          >
            {(homes.data?.careHomes ?? []).map((home) => (
              <option key={home.id} value={home.id}>
                {home.name}
                {home.town ? ` · ${home.town}` : ''}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <div className="steps-bar">
        {STEPS.map((label, i) => (
          <div key={label} className={`step${i === stage ? ' on' : i < stage ? ' done' : ''}`}>
            <span className="n">{i < stage ? '✓' : i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      <div className="grid g-2">
        <Panel>
          <div
            className={`dropzone${dragging ? ' over' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFile(e.dataTransfer.files[0]);
            }}
          >
            <h3>Drop an Excel workbook or CSV here, or choose a file</h3>
            <p>
              Accepts .xlsx and .csv. Columns are detected and mapped before anything is validated. Only the
              rows that pass are offered for commit, and you see the difference they would make first.
            </p>
            <p style={{ marginTop: 12 }}>
              <span className="btn btn-primary btn-sm">Choose file</span>
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </div>

          {/* A home with no data yet has no reported period to pre-fill from,
              which is exactly when the template is needed most. Fall back to
              the current month rather than hiding the link. */}
          {careHomeId ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              Need the template?{' '}
              <a href={`/api/care-homes/${careHomeId}/template?period=${period ?? thisMonth()}`}>
                Download it pre-filled for {parsePeriod(period ?? thisMonth()).label}
              </a>
              .
            </p>
          ) : null}

          {message ? (
            <div style={{ marginTop: 14 }}>
              <Notice variant={message.tone === 'bad' ? 'bad' : 'brand'}>{message.text}</Notice>
            </div>
          ) : null}

          {result ? <ValidationResult result={result} busy={busy} onCommit={() => void commit()} onDiscard={() => { setResult(null); setStage(0); }} /> : null}
        </Panel>

        <Panel title="The input contract">
          <div className="code">
            reporting_period_start,reporting_period_end,care_home_id,{'\n'}
            indicator_id,indicator_name,numerator,denominator,value,{'\n'}
            unit,source_system,data_quality_status,notes,uploaded_by,uploaded_at
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            <b>indicator_id</b> is the canonical key. Indicator names are free text and are never used as the
            primary key, so a home renaming its own measure cannot break its history.
          </p>

          <h3 style={{ fontSize: 12, margin: '14px 0 6px' }}>Checked on every row</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {[
              'Unknown or misspelled indicator_id',
              'A period that is not one whole reporting month',
              'Rows belonging to a different care home',
              'Duplicate rows for the same home, period and indicator',
              'Values that are not numbers, or are negative',
              'Percentages and scores outside 0–100',
              'A missing numerator or denominator where the definition needs one',
              'A value that does not reconcile with its own numerator ÷ denominator',
              'Resident-days that differ between indicators in the same period',
            ].map((check) => (
              <li className="small muted" key={check} style={{ margin: '3px 0' }}>
                {check}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* The API has kept every submission since the first upload; until now
          nothing showed them. A correction is a new version, so the file it
          replaced stays on this list rather than disappearing. */}
      <Panel title="Submission history" tools={<span className="tiny muted">{sets.length} filed</span>} flush>
        {sets.length === 0 ? (
          <div className="empty">No data has been submitted for this care home yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Version</th>
                  <th>File</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Warnings</th>
                  <th>Uploaded by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {sets.slice(0, 14).map((d) => (
                  <tr key={d.id} className={d.superseded ? 'is-superseded' : undefined}>
                    <td><b>{parsePeriod(d.period).label}</b></td>
                    <td className="mono">
                      v{d.version}
                      {d.superseded ? <span className="tiny muted"> superseded</span> : null}
                    </td>
                    <td className="truncate">{d.filename ?? d.source}</td>
                    <td className="mono">{d.rowsAccepted}</td>
                    <td className="mono">{d.rowsRejected || '—'}</td>
                    <td className="mono">{d.warnings || '—'}</td>
                    <td>{d.uploadedBy}</td>
                    <td className="tiny muted">
                      {d.uploadedAt
                        ? new Date(d.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Notice variant="warn">
          <b>Use synthetic or properly governed de-identified data for testing.</b> The trend rules in this
          build are a candidate method awaiting pilot validation — not a validated clinical or regulatory risk
          model.
        </Notice>
      </div>
    </>
  );
}

function ValidationResult({
  result,
  busy,
  onCommit,
  onDiscard,
}: {
  result: ImportResult;
  busy: boolean;
  onCommit: () => void;
  onDiscard: () => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <Notice variant={result.errors.length ? 'bad' : 'brand'}>
        <b>{result.filename}</b> — {result.rowsRead} rows read, {result.acceptedCount} accepted,{' '}
        {result.errors.length} rejected, {result.warnings.length} warnings.
        {result.missingColumns.length ? (
          <>
            <br />
            Missing columns: <span className="mono tiny">{result.missingColumns.join(', ')}</span>
          </>
        ) : null}
        {result.ignoredColumns.length ? (
          <>
            <br />
            Ignored columns: <span className="mono tiny">{result.ignoredColumns.join(', ')}</span>
          </>
        ) : null}
      </Notice>

      {result.errors.length ? (
        <>
          <h3 style={{ fontSize: 12, margin: '14px 0 6px' }}>Rows that cannot be imported</h3>
          <table className="tbl">
            <tbody>
              {result.errors.map((issue, i) => (
                <tr key={i}>
                  <td className="mono small" style={{ width: 60 }}>
                    row {issue.row}
                  </td>
                  <td className="mono tiny muted" style={{ width: 150 }}>
                    {issue.field}
                  </td>
                  <td className="small">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {result.warnings.length ? (
        <>
          <h3 style={{ fontSize: 12, margin: '14px 0 6px' }}>Accepted with a warning</h3>
          <table className="tbl">
            <tbody>
              {result.warnings.map((issue, i) => (
                <tr key={i}>
                  <td className="mono small" style={{ width: 60 }}>
                    {issue.row ? `row ${issue.row}` : '—'}
                  </td>
                  <td className="mono tiny muted" style={{ width: 150 }}>
                    {issue.field}
                  </td>
                  <td className="small">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3 style={{ fontSize: 12, margin: '16px 0 6px' }}>Preview — what committing would change</h3>
      {result.changes.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Period</th>
              <th className="r">Stored</th>
              <th className="r">Incoming</th>
            </tr>
          </thead>
          <tbody>
            {result.changes.map((change) => (
              <tr key={`${change.indicatorId}-${change.period}`}>
                <td className="small">{change.indicatorId}</td>
                <td className="mono small muted">{parsePeriod(change.period).label}</td>
                <td className="r num muted">{change.isNew ? 'new' : (change.stored ?? '—')}</td>
                <td className="r num">
                  <b>{change.incoming === null ? 'insufficient data' : change.incoming}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">Nothing would change — every accepted row matches the stored value.</div>
      )}

      <div className="row gap-8" style={{ marginTop: 14 }}>
        <button
          type="button"
          className={`btn btn-primary btn-sm${busy ? ' busy' : ''}`}
          disabled={busy || result.acceptedCount === 0}
          onClick={onCommit}
        >
          Commit {result.acceptedCount} rows
        </button>
        <button type="button" className="btn btn-sm" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}
