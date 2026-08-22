import { useState, type FormEvent } from 'react';
import type { RuleSet } from '@cgi/core';
import { 
  useAuditLog, useAuth, useCan, useDictionary, useOrganisation, 
  useUpdateRules, useMembers, useInviteMember, useMfaSetup, 
  useMfaVerify, useDeleteOrganisation, useCareHomes, useArchiveCareHome
} from '../lib/hooks.js';
import { AnswerBand, Chip, ErrorState, Loading, Notice, Panel, Modal, Field } from '../components/ui.js';
import { text } from '../lib/forms.js';
import { ApiError } from '../lib/api.js';

const RULE_FIELDS: { key: keyof RuleSet; label: string; help: string; options: number[] }[] = [
  {
    key: 'baselineWindow',
    label: 'Baseline window',
    help: "Periods of the home's own history used for its baseline",
    options: [4, 6, 9, 12],
  },
  {
    key: 'baselineMin',
    label: 'Minimum periods',
    help: 'Fewest comparable periods before any status is calculated',
    options: [3, 4, 5, 6],
  },
  {
    key: 'bandSigma',
    label: 'Outside normal range',
    help: "Multiples of the home's normal spread before a reading counts as unusual",
    options: [1, 1.5, 2, 2.5],
  },
  {
    key: 'strongSigma',
    label: 'Large deviation',
    help: 'Where a single reading is treated as a strong signal',
    options: [2, 2.5, 3, 4],
  },
  {
    key: 'runDeteriorate',
    label: 'Sustained trend',
    help: 'Consecutive periods moving the same way before direction counts',
    options: [2, 3, 4, 5],
  },
  {
    key: 'materialPct',
    label: 'Material change',
    help: 'Percentage move against baseline before a change counts as material',
    options: [5, 10, 15, 20],
  },
  {
    key: 'convergeMin',
    label: 'Convergence',
    help: 'Related indicators that must move together to raise a combined signal',
    options: [2, 3, 4],
  },
  {
    key: 'smallNumberFloor',
    label: 'Small numbers floor',
    help: 'Below this many recorded events, an indicator is never escalated on its own',
    options: [0, 3, 5, 10],
  },
];

export function SettingsPage() {
  const { user, organisation, signOut } = useAuth();
  const can = useCan();
  const org = useOrganisation();
  const dictionary = useDictionary();
  const updateRules = useUpdateRules();
  const audit = useAuditLog(can('readAuditLog'));

  const careHomes = useCareHomes();
  const archiveCareHome = useArchiveCareHome();

  const members = useMembers(can('manageMembers'));
  const inviteMember = useInviteMember();
  const mfaSetup = useMfaSetup();
  const mfaVerify = useMfaVerify();
  const deleteOrg = useDeleteOrganisation();

  const [message, setMessage] = useState<string | null>(null);

  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ token: string; email: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaData, setMfaData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState('');

  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState('');
  const [dangerBusy, setDangerBusy] = useState(false);

  if (org.isLoading) return <Loading label="Loading settings" />;
  if (org.error) return <ErrorState error={org.error} retry={() => void org.refetch()} />;
  if (!org.data) return null;

  const rules = org.data.organisation.rules;

  async function setRule(key: keyof RuleSet, value: number) {
    setMessage(null);
    try {
      const result = await updateRules.mutateAsync({ [key]: value });
      setMessage(result.note);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save that threshold.');
    }
  }

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteBusy(true);
    const form = new FormData(e.currentTarget);
    const email = text(form, 'email');
    const role = text(form, 'role');
    try {
      const res = await inviteMember.mutateAsync({ email, role });
      setInviteResult({ token: res.token, email });
      void members.refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleMfaStart() {
    setMfaBusy(true);
    try {
      const res = await mfaSetup.mutateAsync();
      setMfaData(res);
      setMfaModalOpen(true);
    } catch (err) {
      alert('Could not start MFA setup');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleMfaVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMfaBusy(true);
    try {
      await mfaVerify.mutateAsync({ token: mfaToken });
      setMfaModalOpen(false);
      setMfaData(null);
      alert('MFA successfully enabled!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleDeleteOrg() {
    if (dangerConfirm !== organisation?.name) return;
    setDangerBusy(true);
    try {
      await deleteOrg.mutateAsync();
      await signOut();
    } catch (err) {
      alert('Could not delete organisation');
    } finally {
      setDangerBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>Settings</h1>
        <p>Reporting cycle, trend rule configuration, source pack and security posture.</p>
      </div>

      <AnswerBand
        tone="good"
        title="The rules are configuration, not opinion"
        meta={['Changes recalculate every status', 'Reports keep the thresholds they were generated with']}
      >
        Every threshold the trend engine uses is listed here and can be changed. The source pack is explicit
        that these values are a starting point to be validated against real homes rather than assumed to be
        universally correct — so they are exposed, not buried.
      </AnswerBand>

      <Panel title="Security & Authentication">
        <div className="row gap-16" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b className="small">Two-Factor Authentication</b>
            <div className="tiny muted" style={{ marginTop: 2 }}>Protect your account with an authenticator app (TOTP).</div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void handleMfaStart()} disabled={mfaBusy}>
            Setup MFA
          </button>
        </div>
      </Panel>

      {can('manageMembers') && (
        <Panel title="Team Management" tools={<button className="btn btn-primary btn-sm" onClick={() => { setInviteModalOpen(true); setInviteResult(null); }}>Invite Member</button>}>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.members?.map((m) => (
                  <tr key={m.id}>
                    <td className="small">{m.name || <span className="muted">Pending</span>}</td>
                    <td className="small muted">{m.email}</td>
                    <td><Chip label={m.role ?? 'No role'} tone="stable" /></td>
                    <td><Chip label={m.disabled ? 'Disabled' : m.emailVerified ? 'Active' : 'Pending'} tone={m.disabled ? 'bad' : m.emailVerified ? 'good' : 'watch'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {can('manageSettings') && (
        <Panel title="Care Homes Management">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Care Home Name</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {careHomes.data?.careHomes?.map((h) => (
                  <tr key={h.id}>
                    <td className="small">{h.name}</td>
                    <td><Chip label="Active" tone="good" /></td>
                    <td>
                      <button 
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          if (confirm(`Are you sure you want to archive ${h.name}?`)) {
                            archiveCareHome.mutate(h.id);
                          }
                        }}
                        disabled={archiveCareHome.isPending}
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid g-2">
        <Panel
          title="Trend rule configuration"
          tools={
            can('manageSettings') ? null : (
              <span className="tiny muted">Your role can view these but not change them</span>
            )
          }
        >
          <div className="stack gap-14">
            {RULE_FIELDS.map((field) => (
              <div
                className="row gap-12"
                key={field.key}
                style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
              >
                <div style={{ maxWidth: '36em' }}>
                  <b className="small">{field.label}</b>
                  <div className="tiny muted">{field.help}</div>
                </div>
                <select
                  className="select"
                  value={String(rules[field.key])}
                  disabled={!can('manageSettings') || updateRules.isPending}
                  onChange={(e) => void setRule(field.key, Number(e.target.value))}
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {message ? (
            <div style={{ marginTop: 14 }}>
              <Notice variant="brand">{message}</Notice>
            </div>
          ) : null}
        </Panel>

        <div className="stack gap-14">
          <Panel title="Organisation">
            <dl className="kv">
              <dt>Name</dt>
              <dd>{organisation?.name}</dd>
              <dt>Signed in as</dt>
              <dd>
                {user?.name} · {user?.role}
              </dd>
              <dt>Period definition</dt>
              <dd>Calendar month, first to last day</dd>
              <dt>Cadence</dt>
              <dd>Monthly, with Q06, Q10, Q13 and Q15 permitted quarterly per home</dd>
              <dt>Missing monthly submission</dt>
              <dd>Insufficient data — never interpolated</dd>
              <dt>Mapping version</dt>
              <dd className="mono">{dictionary.data?.mappingVersion}</dd>
            </dl>
          </Panel>

          <Panel title="Your capabilities" tools={<span className="tiny muted">Enforced server-side</span>}>
            <div className="row gap-6 wrap">
              {(user?.capabilities ?? []).map((capability) => (
                <Chip key={capability} label={capability} tone="stable" />
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              The interface hides what your role cannot do, but the check that matters is the one the API makes
              on every request. A capability missing here is refused there too.
            </p>
          </Panel>
        </div>
      </div>

      {can('readAuditLog') ? (
        <Panel title="Audit log" tools={<span className="tiny muted">Append-only</span>} flush>
          {audit.isLoading ? (
            <Loading />
          ) : (
            <div className="tbl-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Outcome</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(audit.data?.entries ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono tiny muted">{new Date(entry.at).toLocaleString('en-GB')}</td>
                      <td className="small">{entry.userName}</td>
                      <td className="mono tiny">{entry.action}</td>
                      <td>
                        <Chip
                          label={entry.outcome}
                          tone={entry.outcome === 'success' ? 'good' : entry.outcome === 'denied' ? 'bad' : 'watch'}
                        />
                      </td>
                      <td className="tiny muted" style={{ maxWidth: '40ch' }}>
                        {Object.entries(entry.detail ?? {})
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      <Panel title="Security posture" tools={<span className="tiny muted">What this build does and does not do</span>}>
        <div className="grid g-2e">
          <div>
            <h3 style={{ fontSize: 12, marginBottom: 8 }}>Implemented</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {[
                'Server-side sessions with organisation and care-home isolation',
                'Object-level authorisation on every tenant-owned route',
                'scrypt password hashing, login throttling and account lockout',
                'CSRF double-submit tokens plus SameSite=strict cookies',
                'Append-only audit log covering successful and refused attempts',
                'Upload allowlist, MIME agreement, size ceiling, scan and quarantine',
              ].map((item) => (
                <li className="small muted" key={item} style={{ margin: '3px 0' }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: 12, marginBottom: 8 }}>Not claimed</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {[
                'No certification of any kind is claimed',
                'Malware scanning is a placeholder that fails closed — wire a real scanner before production',
                'No independent penetration test has been run against this build',
                'The trend rules are a candidate method awaiting pilot validation',
                'Nothing here is a CQC rating, a prediction of one, or clinical advice',
              ].map((item) => (
                <li className="small muted" key={item} style={{ margin: '3px 0' }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      {can('manageSettings') && (
        <div className="danger-zone" style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8, fontWeight: 600 }}>Danger Zone</h3>
          <p className="small" style={{ marginBottom: 16 }}>Deleting this organisation is irreversible. All care homes, reports, and indicators will be immediately archived. All active sessions will be terminated.</p>
          <button className="btn btn-sm" style={{ background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }} onClick={() => setDangerModalOpen(true)}>
            Delete Organisation
          </button>
        </div>
      )}

      {/* Modals */}
      <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite Team Member">
        {!inviteResult ? (
          <form className="stack gap-16" onSubmit={(e) => void handleInvite(e)}>
            <Field label="Email Address">
              <input name="email" type="email" required />
            </Field>
            <Field label="Role">
              <select name="role" required>
                {members.data?.roles?.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <div style={{ textAlign: 'right' }}>
              <button type="submit" className={`btn btn-primary${inviteBusy ? ' busy' : ''}`} disabled={inviteBusy}>Send Invitation</button>
            </div>
          </form>
        ) : (
          <div className="stack gap-16" style={{ textAlign: 'center' }}>
            <Notice variant="brand">
              Invitation generated for <b>{inviteResult.email}</b>
            </Notice>
            <p className="small muted">Send them this link to accept the invitation:</p>
            <div className="code" style={{ userSelect: 'all', wordBreak: 'break-all' }}>
              {window.location.origin}/auth/accept?token={inviteResult.token}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={mfaModalOpen} onClose={() => { setMfaModalOpen(false); setMfaToken(''); }} title="Setup Authenticator App">
        {mfaData && (
          <form className="stack gap-16" onSubmit={(e) => void handleMfaVerify(e)}>
            <p className="small">1. Scan this QR code with your authenticator app (Google Authenticator, Authy, etc).</p>
            <div style={{ textAlign: 'center', background: '#fff', padding: 16, borderRadius: 8, width: 'fit-content', margin: '0 auto' }}>
              <img src={mfaData.qrCodeUrl} alt="MFA QR Code" width="200" height="200" />
            </div>
            <p className="small">2. Enter the 6-digit code generated by your app.</p>
            <Field label="Authenticator Code">
              <input type="text" value={mfaToken} onChange={e => setMfaToken(e.target.value)} required minLength={6} maxLength={6} placeholder="000000" style={{ fontSize: 24, letterSpacing: '0.2em', textAlign: 'center', fontFamily: 'var(--mono)' }} />
            </Field>
            <div style={{ textAlign: 'right' }}>
              <button type="submit" className={`btn btn-primary${mfaBusy ? ' busy' : ''}`} disabled={mfaBusy}>Verify and Enable</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={dangerModalOpen} onClose={() => setDangerModalOpen(false)} title="Delete Organisation">
        <div className="stack gap-16">
          <Notice variant="bad">
            This action <b>cannot</b> be undone. This will permanently delete the <b>{organisation?.name}</b> organisation.
          </Notice>
          <Field label={`Please type "${organisation?.name}" to confirm`}>
            <input type="text" value={dangerConfirm} onChange={e => setDangerConfirm(e.target.value)} />
          </Field>
          <div style={{ textAlign: 'right' }}>
            <button className={`btn${dangerBusy ? ' busy' : ''}`} style={{ background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }} onClick={() => void handleDeleteOrg()} disabled={dangerConfirm !== organisation?.name || dangerBusy}>
              I understand, delete this organisation
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
