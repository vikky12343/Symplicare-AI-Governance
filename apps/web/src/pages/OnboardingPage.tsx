import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ApiError,
  MANAGER_ROLES,
  ORGANISATION_TYPES,
  api,
  type CareHomeSummary,
  type OrganisationRecord,
  type SessionUser,
} from '../lib/api.js';
import { text } from '../lib/forms.js';
import { useAuth, useCareHomes, useWorkspaceRefresh } from '../lib/hooks.js';
import { BrandMark } from '../components/brand.js';
import { CareHomeForm } from '../components/CareHomeForm.js';
import { PhotoField } from '../components/PhotoField.js';
import '../styles/onboarding.css';

/**
 * First-time setup.
 *
 * Three things make this different from a wizard that merely looks finished:
 *
 *  1. Each step saves to the server as it is completed, so a closed browser
 *     costs the current step and nothing before it.
 *  2. The step the manager is on lives on their user record, not in this
 *     component, so signing in on another machine resumes in the same place.
 *  3. Completion is claimed only after the server agrees the workspace is
 *     actually set up. A failed save leaves setup open rather than dropping
 *     someone onto a dashboard with no care homes in it.
 */

const STEPS = ['You', 'Organisation', 'Care homes', 'Review', 'Done'] as const;
const LAST = STEPS.length;

export function OnboardingPage() {
  const { user, organisation, refresh } = useAuth();
  const refreshWorkspace = useWorkspaceRefresh();
  const homesQuery = useCareHomes();
  const navigate = useNavigate();

  const [step, setStep] = useState<number>(() => user?.onboarding.step ?? 1);
  const [resumed, setResumed] = useState(false);
  /* Completion flips the flag that sends anyone with it straight to the
     dashboard — including this component. Remember that we are the ones who
     just set it, so the last step gets to be seen. */
  const [justFinished, setJustFinished] = useState(false);

  /* A manager returning mid-setup is told so, once, rather than being dropped
     into step three with no explanation. */
  useEffect(() => {
    if (!user) return;
    if (!resumed && user.onboarding.step > 1 && !user.onboarding.completed) setResumed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return <div className="load-state">Checking your session…</div>;
  if (user.onboarding.completed && !justFinished) return <Navigate to="/dashboard" replace />;

  const homes = homesQuery.data?.careHomes ?? [];

  /** Records how far setup has got. Never blocks the manager if it fails. */
  async function advance(to: number) {
    setStep(to);
    try {
      await api.patch('/api/profile/onboarding', { step: Math.min(to, LAST) });
      await refresh();
    } catch {
      /* The step is a convenience, not the data. Losing it costs one click. */
    }
  }

  return (
    <div className="onb">
      <header className="onb-header">
        <BrandMark size={32} stacked to={null} />
        <span className="onb-steps" aria-label={`Step ${step} of ${LAST}`}>
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <span key={label} className={`onb-step${n === step ? ' on' : ''}${n < step ? ' done' : ''}`}>
                <span className="onb-step-dot">{n < step ? <Tick /> : n}</span>
                <span className="onb-step-label">{label}</span>
              </span>
            );
          })}
        </span>
      </header>

      <main className="onb-main">
        <div className="onb-card">
          {resumed && step > 1 && step < LAST ? (
            <div className="onb-resume" role="status">
              <b>Welcome back.</b> Let&rsquo;s finish setting up your workspace.
            </div>
          ) : null}

          {step === 1 ? <ProfileStep user={user} onDone={() => void advance(2)} /> : null}
          {step === 2 ? (
            <OrganisationStep
              organisation={organisation}
              onBack={() => setStep(1)}
              onDone={() => void advance(3)}
            />
          ) : null}
          {step === 3 ? (
            <HomesStep
              homes={homes}
              onAdded={refreshWorkspace}
              onBack={() => setStep(2)}
              onDone={() => void advance(4)}
            />
          ) : null}
          {step === 4 ? (
            <ReviewStep
              user={user}
              organisation={organisation}
              homes={homes}
              onBack={() => setStep(3)}
              onDone={() => {
                /* Flag first, then refresh: the refresh is what makes the
                   redirect guard true, so it must not win the race. */
                setJustFinished(true);
                setStep(5);
                void refresh();
              }}
            />
          ) : null}
          {step === 5 ? <DoneStep organisation={organisation} homes={homes} onGo={() => void navigate('/dashboard')} /> : null}
        </div>
      </main>
    </div>
  );
}

/* ── Step 1 — the manager ─────────────────────────────────────── */
function ProfileStep({ user, onDone }: { user: SessionUser; onDone: () => void }) {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
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
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.fields?.length) {
        setFieldErrors(Object.fromEntries(error.fields.map((f) => [f.path, f.message])));
        setMessage('Some fields need attention.');
      } else {
        setMessage(error instanceof ApiError ? error.message : 'We could not save that. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  /* Signup only asked for a full name, so seed the parts from it. */
  const [first = '', ...rest] = (user.firstName ? [user.firstName] : user.name.split(/\s+/)).filter(Boolean);
  const last = user.lastName || rest.join(' ');

  return (
    <>
      <StepHead
        title="Tell us about yourself"
        body="Create your manager profile so your governance workspace is personalised to you."
      />

      <PhotoField onSaved={() => void refresh()} />

      <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
        {message ? <div className="cgform-alert" role="alert">{message}</div> : null}

        <div className="cgform-row">
          <label className="cgfield">
            <span className="cgfield-label">First name</span>
            <input name="firstName" defaultValue={first} autoComplete="given-name" required maxLength={100} />
            {fieldErrors.firstName ? <span className="cgfield-error">{fieldErrors.firstName}</span> : null}
          </label>
          <label className="cgfield">
            <span className="cgfield-label">Last name</span>
            <input name="lastName" defaultValue={last} autoComplete="family-name" required maxLength={100} />
            {fieldErrors.lastName ? <span className="cgfield-error">{fieldErrors.lastName}</span> : null}
          </label>
        </div>

        <label className="cgfield">
          <span className="cgfield-label">Work email</span>
          <input value={user.email} readOnly aria-describedby="email-note" />
          <span id="email-note" className="cgfield-hint">This is the address you sign in with.</span>
        </label>

        <div className="cgform-row">
          <label className="cgfield">
            <span className="cgfield-label">Phone number <em>Optional</em></span>
            <input name="phone" defaultValue={user.phone} autoComplete="tel" maxLength={40} placeholder="07123 456789" />
          </label>
          <label className="cgfield">
            <span className="cgfield-label">Job title <em>Optional</em></span>
            <input name="jobTitle" defaultValue={user.jobTitle} maxLength={120} placeholder="Registered Manager" />
          </label>
        </div>

        <label className="cgfield">
          <span className="cgfield-label">Manager role</span>
          <select name="managerRole" defaultValue={user.managerRole ?? 'Registered Manager'}>
            {MANAGER_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        <div className="cgform-actions end">
          <button type="submit" className="cgbtn cgbtn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </>
  );
}

/* ── Step 2 — the organisation ────────────────────────────────── */
function OrganisationStep({
  organisation,
  onBack,
  onDone,
}: {
  organisation: OrganisationRecord | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const read = (name: string) => text(form, name);

    try {
      await api.patch('/api/profile/organisation', {
        name: read('name'),
        type: read('type'),
        addressLine1: read('addressLine1'),
        town: read('town'),
        county: read('county'),
        postcode: read('postcode'),
      });
      await refresh();
      onDone();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'We could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHead
        title="Your organisation"
        body="This is the provider your care homes belong to. Everything you upload and report on is filed under it."
      />

      <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
        {message ? <div className="cgform-alert" role="alert">{message}</div> : null}

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
          <span className="cgfield-label">Address <em>Optional</em></span>
          <input name="addressLine1" defaultValue={organisation?.addressLine1 ?? ''} maxLength={200} />
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

        <p className="onb-note">
          You can add as many care homes as you like, now or at any time afterwards.
        </p>

        <div className="cgform-actions">
          <button type="button" className="cgbtn cgbtn-ghost" onClick={onBack} disabled={busy}>Back</button>
          <button type="submit" className="cgbtn cgbtn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </>
  );
}

/* ── Step 3 — the care homes ──────────────────────────────────── */
function HomesStep({
  homes,
  onAdded,
  onBack,
  onDone,
}: {
  homes: CareHomeSummary[];
  onAdded: () => Promise<void>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(homes.length === 0);

  return (
    <>
      <StepHead
        title="Add your care homes"
        body="Add the first one now. You can add, edit or archive homes at any time from Care Homes — you will never come back through setup to do it."
      />

      {homes.length > 0 ? (
        <ul className="onb-homes">
          {homes.map((h) => (
            <li key={h.id}>
              <span className="onb-home-name">{h.name}</span>
              <span className="onb-home-meta">
                {h.type}
                {h.beds ? ` · ${h.beds} beds` : ''}
                {h.town ? ` · ${h.town}` : ''}
              </span>
              <Tick />
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <CareHomeForm
          submitLabel="Save care home"
          onSaved={async () => {
            await onAdded();
            setAdding(false);
          }}
          onCancel={homes.length > 0 ? () => setAdding(false) : undefined}
        />
      ) : (
        <button type="button" className="cgbtn cgbtn-ghost wide" onClick={() => setAdding(true)}>
          + Add another care home
        </button>
      )}

      {!adding ? (
        <div className="cgform-actions">
          <button type="button" className="cgbtn cgbtn-ghost" onClick={onBack}>Back</button>
          <button type="button" className="cgbtn cgbtn-primary" onClick={onDone} disabled={homes.length === 0}>
            Continue
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ── Step 4 — review, then commit ─────────────────────────────── */
function ReviewStep({
  user,
  organisation,
  homes,
  onBack,
  onDone,
}: {
  user: SessionUser;
  organisation: OrganisationRecord | null;
  homes: CareHomeSummary[];
  onBack: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/profile/onboarding/complete');
      onDone();
    } catch (error) {
      /* Setup stays open. Nobody reaches a dashboard with no homes in it
         because a save failed quietly. */
      setMessage(
        error instanceof ApiError
          ? error.message
          : "We couldn't save your setup yet. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHead title="Check it over" body="Everything here stays editable afterwards." />

      <dl className="onb-review">
        <div>
          <dt>You</dt>
          <dd>
            {user.name}
            {user.managerRole ? <span> · {user.managerRole}</span> : null}
            <span className="onb-review-sub">{user.email}</span>
          </dd>
        </div>
        <div>
          <dt>Organisation</dt>
          <dd>
            {organisation?.name ?? '—'}
            <span className="onb-review-sub">{organisation?.type}</span>
          </dd>
        </div>
        <div>
          <dt>Care homes</dt>
          <dd>
            {homes.length} {homes.length === 1 ? 'home' : 'homes'}
            <span className="onb-review-sub">{homes.map((h) => h.name).join(', ')}</span>
          </dd>
        </div>
      </dl>

      {message ? (
        <div className="cgform-alert" role="alert">
          {message}
          <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => void complete()} disabled={busy}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="cgform-actions">
        <button type="button" className="cgbtn cgbtn-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="cgbtn cgbtn-primary" onClick={() => void complete()} disabled={busy}>
          {busy ? 'Setting up…' : 'Finish setup'}
        </button>
      </div>
    </>
  );
}

/* ── Step 5 — done ────────────────────────────────────────────── */
function DoneStep({
  organisation,
  homes,
  onGo,
}: {
  organisation: OrganisationRecord | null;
  homes: CareHomeSummary[];
  onGo: () => void;
}) {
  return (
    <div className="onb-done">
      <span className="onb-done-mark"><Tick size={26} /></span>
      <h1 className="onb-title">All set</h1>
      <p className="onb-body">
        Your workspace is ready. Upload your first month of data and the trend engine will start
        reading it.
      </p>

      <dl className="onb-review compact">
        <div>
          <dt>Organisation</dt>
          <dd>{organisation?.name ?? '—'}</dd>
        </div>
        <div>
          <dt>Care homes</dt>
          <dd>{homes.length}</dd>
        </div>
      </dl>

      <button type="button" className="cgbtn cgbtn-primary wide" onClick={onGo}>Go to dashboard</button>
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────── */
function StepHead({ title, body }: { title: string; body: string }) {
  return (
    <header className="onb-head">
      <h1 className="onb-title">{title}</h1>
      <p className="onb-body">{body}</p>
    </header>
  );
}

function Tick({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
