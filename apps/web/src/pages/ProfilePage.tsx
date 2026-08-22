import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  MANAGER_ROLES,
  ORGANISATION_TYPES,
  api,
} from '../lib/api.js';
import { text } from '../lib/forms.js';
import { useAuth, useCareHomes } from '../lib/hooks.js';
import { Avatar } from '../components/Avatar.js';
import { PhotoField } from '../components/PhotoField.js';
import '../styles/onboarding.css';

/**
 * The manager's permanent account page.
 *
 * Everything setup asked for lives here afterwards, editable, forever. Nobody
 * is ever sent back through onboarding to change a phone number or a photo.
 */

type Section = 'profile' | 'organisation' | 'security';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'profile', label: 'My profile' },
  { id: 'organisation', label: 'Organisation' },
  { id: 'security', label: 'Security' },
];

/** Saving state, so a change is never quietly lost. */
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function SaveNote({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'saving') return <span className="cgsave">Saving…</span>;
  if (state.kind === 'saved') return <span className="cgsave ok">Saved ✓</span>;
  return (
    <span className="cgsave bad" role="alert">
      {state.message}
      {onRetry ? (
        <button type="button" className="cglink" onClick={onRetry}>Retry</button>
      ) : null}
    </span>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const homes = useCareHomes();
  const [section, setSection] = useState<Section>('profile');

  if (!user) return <div className="load-state">Loading…</div>;

  const completion = [
    { label: 'Name', done: Boolean(user.firstName && user.lastName) },
    { label: 'Email', done: Boolean(user.email) },
    { label: 'Phone', done: Boolean(user.phone) },
    { label: 'Job title', done: Boolean(user.jobTitle) },
    { label: 'Role', done: Boolean(user.managerRole) },
    { label: 'Profile photo', done: Boolean(user.avatarUrl) },
  ];
  const percent = Math.round((completion.filter((c) => c.done).length / completion.length) * 100);

  return (
    <div className="cgpage">
      <header className="cgpage-head">
        <div>
          <h1 className="cgpage-title">Your profile</h1>
          <p className="cgpage-sub">Manage your personal information and workspace preferences.</p>
        </div>
      </header>

      <div className="cgpage-card cgprofile-hero">
        <Avatar size={64} />
        <div className="cgprofile-hero-text">
          <h2>{user.name}</h2>
          <p>{user.managerRole ?? user.role}</p>
          <p className="muted">{user.email}</p>
        </div>
        <div className="cgprofile-completion" aria-label={`Profile completion ${percent} percent`}>
          <span className="cglabel">Profile completion</span>
          <span className="cgprofile-percent">{percent}%</span>
          <span className="cgmeter"><i style={{ width: `${percent}%` }} /></span>
          <ul className="cgprofile-checks">
            {completion.map((c) => (
              <li key={c.label} className={c.done ? 'done' : undefined}>
                <span aria-hidden="true">{c.done ? '✓' : '○'}</span> {c.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="cgpage-split">
        <nav className="cgside" aria-label="Profile sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cgside-item${section === s.id ? ' on' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
          <Link className="cgside-item" to="/care-homes">
            Care homes <span className="cgside-count">{homes.data?.careHomes.length ?? 0}</span>
          </Link>
          <Link className="cgside-item" to="/settings">Notifications &amp; preferences</Link>
        </nav>

        <div>
          {section === 'profile' ? <PersonalSection /> : null}
          {section === 'organisation' ? <OrganisationSection homeCount={homes.data?.careHomes.length ?? 0} /> : null}
          {section === 'security' ? <SecuritySection /> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Personal information ─────────────────────────────────────── */
function PersonalSection() {
  const { user, refresh } = useAuth();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: 'saving' });
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const read = (name: string) => text(form, name);

    try {
      await api.patch('/api/profile', {
        firstName: read('firstName'),
        lastName: read('lastName'),
        phone: read('phone'),
        jobTitle: read('jobTitle'),
        managerRole: read('managerRole') || null,
      });
      await refresh();
      setState({ kind: 'saved' });
    } catch (error) {
      if (error instanceof ApiError && error.fields?.length) {
        setFieldErrors(Object.fromEntries(error.fields.map((f) => [f.path, f.message])));
      }
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to save. Check your connection.',
      });
    }
  }

  if (!user) return null;

  return (
    <Card title="Personal information" note={<SaveNote state={state} />}>
      <PhotoField onSaved={() => void refresh()} />

      <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
        <div className="cgform-row">
          <label className="cgfield">
            <span className="cgfield-label">First name</span>
            <input name="firstName" defaultValue={user.firstName} required maxLength={100} />
            {fieldErrors.firstName ? <span className="cgfield-error">{fieldErrors.firstName}</span> : null}
          </label>
          <label className="cgfield">
            <span className="cgfield-label">Last name</span>
            <input name="lastName" defaultValue={user.lastName} required maxLength={100} />
            {fieldErrors.lastName ? <span className="cgfield-error">{fieldErrors.lastName}</span> : null}
          </label>
        </div>

        <label className="cgfield">
          <span className="cgfield-label">Email</span>
          <input value={user.email} readOnly />
          <span className="cgfield-hint">Changing your sign-in address is handled in Settings.</span>
        </label>

        <div className="cgform-row">
          <label className="cgfield">
            <span className="cgfield-label">Phone <em>Optional</em></span>
            <input name="phone" defaultValue={user.phone} maxLength={40} />
          </label>
          <label className="cgfield">
            <span className="cgfield-label">Job title <em>Optional</em></span>
            <input name="jobTitle" defaultValue={user.jobTitle} maxLength={120} />
          </label>
        </div>

        <label className="cgfield">
          <span className="cgfield-label">Manager role</span>
          <select name="managerRole" defaultValue={user.managerRole ?? 'Registered Manager'}>
            {MANAGER_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <span className="cgfield-hint">
            Your permissions come from your workspace role ({user.role}), which only an owner can change.
          </span>
        </label>

        <div className="cgform-actions end">
          <button type="submit" className="cgbtn cgbtn-primary" disabled={state.kind === 'saving'}>
            {state.kind === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/* ── Organisation ─────────────────────────────────────────────── */
function OrganisationSection({ homeCount }: { homeCount: number }) {
  const { organisation, refresh, user } = useAuth();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const canEdit = user?.capabilities.includes('manageSettings') ?? false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: 'saving' });
    const form = new FormData(event.currentTarget);
    const read = (name: string) => text(form, name);

    try {
      await api.patch('/api/profile/organisation', {
        name: read('name'),
        type: read('type'),
        addressLine1: read('addressLine1'),
        addressLine2: read('addressLine2'),
        town: read('town'),
        county: read('county'),
        postcode: read('postcode'),
      });
      await refresh();
      setState({ kind: 'saved' });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to save. Check your connection.',
      });
    }
  }

  return (
    <>
      <Card title="Organisation" note={<SaveNote state={state} />}>
        {!canEdit ? (
          <p className="cgnote">Your role can view these details but not change them.</p>
        ) : null}

        <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
          <fieldset disabled={!canEdit} className="cgfieldset">
            <label className="cgfield">
              <span className="cgfield-label">Organisation name</span>
              <input name="name" defaultValue={organisation?.name ?? ''} required minLength={2} maxLength={200} />
            </label>

            <label className="cgfield">
              <span className="cgfield-label">Organisation type</span>
              <select name="type" defaultValue={organisation?.type ?? 'Care Provider'}>
                {ORGANISATION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label className="cgfield">
              <span className="cgfield-label">Address line 1 <em>Optional</em></span>
              <input name="addressLine1" defaultValue={organisation?.addressLine1 ?? ''} maxLength={200} />
            </label>
            <label className="cgfield">
              <span className="cgfield-label">Address line 2 <em>Optional</em></span>
              <input name="addressLine2" defaultValue={organisation?.addressLine2 ?? ''} maxLength={200} />
            </label>

            <div className="cgform-row">
              <label className="cgfield">
                <span className="cgfield-label">Town or city <em>Optional</em></span>
                <input name="town" defaultValue={organisation?.town ?? ''} maxLength={120} />
              </label>
              <label className="cgfield">
                <span className="cgfield-label">County <em>Optional</em></span>
                <input name="county" defaultValue={organisation?.county ?? ''} maxLength={120} />
              </label>
            </div>

            <label className="cgfield">
              <span className="cgfield-label">Postcode <em>Optional</em></span>
              <input name="postcode" defaultValue={organisation?.postcode ?? ''} maxLength={16} />
            </label>

            {canEdit ? (
              <div className="cgform-actions end">
                <button type="submit" className="cgbtn cgbtn-primary" disabled={state.kind === 'saving'}>
                  {state.kind === 'saving' ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            ) : null}
          </fieldset>
        </form>
      </Card>

      <Card title="Care homes">
        <div className="cgshortcut">
          <div>
            <b>{organisation?.name}</b>
            <span className="muted">{homeCount} {homeCount === 1 ? 'care home' : 'care homes'}</span>
          </div>
          <Link className="cgbtn cgbtn-ghost" to="/care-homes">Manage care homes</Link>
        </div>
      </Card>
    </>
  );
}

/* ── Security ─────────────────────────────────────────────────── */
function SecuritySection() {
  const { user } = useAuth();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: 'saving' });
    const form = new FormData(event.currentTarget);
    const currentPassword = text(form, 'currentPassword');
    const newPassword = text(form, 'newPassword');
    const confirm = text(form, 'confirmPassword');

    if (newPassword !== confirm) {
      setState({ kind: 'error', message: 'Both new passwords must match.' });
      return;
    }

    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      (event.target as HTMLFormElement).reset();
      setState({ kind: 'saved' });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to change your password.',
      });
    }
  }

  return (
    <>
      <Card title="Change password" note={<SaveNote state={state} />}>
        <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
          <label className="cgfield">
            <span className="cgfield-label">Current password</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <div className="cgform-row">
            <label className="cgfield">
              <span className="cgfield-label">New password</span>
              <input name="newPassword" type="password" autoComplete="new-password" required />
            </label>
            <label className="cgfield">
              <span className="cgfield-label">Confirm new password</span>
              <input name="confirmPassword" type="password" autoComplete="new-password" required />
            </label>
          </div>
          <p className="cgfield-hint">
            At least 12 characters, with an uppercase letter, a lowercase letter and a number.
          </p>
          <div className="cgform-actions end">
            <button type="submit" className="cgbtn cgbtn-primary" disabled={state.kind === 'saving'}>
              {state.kind === 'saving' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </Card>

      <Card title="Account security">
        <dl className="cgfacts">
          <div>
            <dt>Two-factor authentication</dt>
            <dd>{user?.mfaEnabled ? 'On' : 'Off — set it up in Settings'}</dd>
          </div>
          <div>
            <dt>Email verified</dt>
            <dd>{user?.emailVerified ? 'Yes' : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>
              Your session lives on the server, so signing out ends it everywhere it is used.
              Settings has &ldquo;sign out of all sessions&rdquo;.
            </dd>
          </div>
        </dl>
      </Card>
    </>
  );
}

function Card({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="cgpage-card">
      <div className="cgpage-card-head">
        <h2>{title}</h2>
        {note}
      </div>
      {children}
    </section>
  );
}
