import { useRef, useState } from 'react';
import { useCan, useEvidence, useSelection } from '../lib/hooks.js';
import { AnswerBand, Chip, ErrorState, Loading, Notice, Panel } from '../components/ui.js';
import { BarList, Stat, StatRow } from '../components/stats.js';
import { ApiError, api } from '../lib/api.js';

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EvidencePage() {
  const { careHomeId } = useSelection();
  const can = useCan();
  const { data, isLoading, error, refetch } = useEvidence(careHomeId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'bad' | 'good' } | null>(null);

  if (isLoading) return <Loading label="Loading the evidence library" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  async function upload(file: File | undefined) {
    if (!file || !careHomeId) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'Supporting document');

    try {
      const result = await api.upload<{ evidence: { reference: string; scanStatus: string } }>(
        `/api/care-homes/${careHomeId}/evidence`,
        form,
      );
      await refetch();
      setMessage(
        result.evidence.scanStatus === 'quarantined'
          ? {
              text: `${result.evidence.reference} was stored but quarantined by the scanner. It cannot be downloaded until it is cleared.`,
              tone: 'bad',
            }
          : { text: `Uploaded as ${result.evidence.reference}.`, tone: 'good' },
      );
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : 'That file could not be uploaded.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  const items = data?.evidence ?? [];
  const clean = items.filter((e) => e.scanStatus === 'clean');
  const pending = items.filter((e) => e.scanStatus === 'pending');
  const blocked = items.filter((e) => e.scanStatus !== 'clean' && e.scanStatus !== 'pending');
  const totalBytes = items.reduce((n, e) => n + (e.sizeBytes ?? 0), 0);
  const byKind = [...new Set(items.map((e) => e.kind))].map((kind) => ({
    label: kind || 'Unclassified',
    value: items.filter((e) => e.kind === kind).length,
    tone: 'teal' as const,
  }));
  const newest = [...items].sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''))[0];

  return (
    <>
      <div className="view-head">
        <h1>Evidence library</h1>
        <p>Documents linked to the signals, actions and indicators they support.</p>
      </div>

      <StatRow>
        <Stat label="Documents" value={items.length} note={`${(totalBytes / 1024 / 1024).toFixed(1)} MB stored`} tone="teal" />
        <Stat
          label="Scanned clean"
          value={clean.length}
          note={items.length ? `${Math.round((clean.length / items.length) * 100)}% of the library` : 'Nothing uploaded yet'}
          tone="good"
          meter={items.length ? clean.length / items.length : 0}
        />
        <Stat
          label="Awaiting scan"
          value={pending.length}
          note={pending.length ? 'Held until it passes' : 'Nothing queued'}
          tone={pending.length ? 'warn' : 'plain'}
        />
        <Stat
          label="Quarantined"
          value={blocked.length}
          note={blocked.length ? 'Refused by the scanner' : 'None'}
          tone={blocked.length ? 'bad' : 'good'}
        />
        <Stat
          label="Most recent"
          value={newest ? <span className="stat-word">{new Date(newest.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> : '—'}
          note={newest ? newest.uploadedByName : 'No uploads yet'}
          tone="plain"
        />
      </StatRow>

      {byKind.length ? (
        <Panel title="What the library holds">
          <BarList items={byKind} />
        </Panel>
      ) : null}

      <AnswerBand
        tone="good"
        title="Evidence, linked to the thing it evidences"
        meta={[
          `${data.evidence.length} items visible to this home`,
          'Uploads are scanned and quarantined before they can be retrieved',
        ]}
      >
        A document is only useful in governance if you can find it from the signal, action or indicator it
        belongs to. Every item here carries its links, its uploader and its date.
      </AnswerBand>

      <Panel
        title="Documents"
        tools={
          can('manageEvidence') ? (
            <>
              <button
                type="button"
                className={`btn btn-sm btn-primary${busy ? ' busy' : ''}`}
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                Upload evidence
              </button>
              <input
                ref={fileInput}
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </>
          ) : null
        }
        flush
      >
        {message ? (
          <div style={{ padding: 16, paddingBottom: 0 }}>
            <Notice variant={message.tone === 'bad' ? 'bad' : 'brand'}>{message.text}</Notice>
          </div>
        ) : null}

        {data.evidence.length === 0 ? (
          <div className="empty">
            No evidence yet. Audit reports, minutes, policies and action plans belong here so a signal can point
            at them.
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Scan</th>
                  <th>Added by</th>
                  <th className="r">Size</th>
                  <th className="r" />
                </tr>
              </thead>
              <tbody>
                {data.evidence.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <b className="small">{item.filename}</b>
                      <div className="tiny muted mono">
                        {item.reference}
                        {item.organisationWide ? ' · organisation-wide' : ''}
                      </div>
                    </td>
                    <td className="small">{item.kind}</td>
                    <td>
                      <Chip
                        label={item.scanStatus}
                        tone={item.scanStatus === 'clean' ? 'good' : item.scanStatus === 'pending' ? 'watch' : 'bad'}
                      />
                    </td>
                    <td className="small muted">
                      {item.uploadedByName}
                      <div className="tiny">{new Date(item.uploadedAt).toLocaleDateString('en-GB')}</div>
                    </td>
                    <td className="r num muted small">{readableSize(item.sizeBytes)}</td>
                    <td className="r">
                      {item.scanStatus === 'clean' ? (
                        <a
                          className="btn btn-sm"
                          href={`/api/care-homes/${careHomeId}/evidence/${item.id}/download`}
                        >
                          Download
                        </a>
                      ) : (
                        <span className="tiny muted">Not retrievable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Notice>
          <b>How uploads are handled.</b> Extension and MIME must agree, a size ceiling is enforced before the
          file is read, the content is scanned and quarantined on suspicion, the stored name is generated rather
          than taken from the upload, and retrieval is always an attachment with sniffing disabled. Every upload
          and every download is written to the audit log.
        </Notice>
      </div>
    </>
  );
}
