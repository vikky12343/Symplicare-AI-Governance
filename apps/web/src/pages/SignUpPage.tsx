import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/hooks.js';
import { text } from '../lib/forms.js';
import {
  AuthAside,
  AuthField,
  BackHome,
  CheckIcon,
  MailIcon,
  PasswordField,
  SsoBlock,
  UserIcon,
} from '../components/auth-parts.js';
import '../styles/auth.css';

const POINTS = [
  {
    title: 'Secure & private',
    desc: 'Your data is encrypted and never shared.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 21s7.5-3.6 7.5-9.2V5.4L12 2.6 4.5 5.4v6.4C4.5 17.4 12 21 12 21z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Insightful',
    desc: 'Turn complex data into clear, actionable insights.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 20V11M12 20V5M19 20v-6" />
      </svg>
    ),
  },
  {
    title: 'Built for care',
    desc: 'Designed with care professionals, for care professionals.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-1.8a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 19.2V21" />
        <circle cx="10.5" cy="8" r="3.4" />
        <path d="M19 11h3M20.5 9.5v3" />
      </svg>
    ),
  },
];

/* The rules the API actually enforces, so the checklist and the server
   never disagree. See passwordRules in apps/api/src/routes/auth.ts. */
const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One number', test: (v) => /[0-9]/.test(v) },
];

export function SignUpPage() {
  const { user, loading, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (loading) return <div className="load-state">Checking your session…</div>;
  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    if (password !== confirm) {
      setFieldErrors({ confirmPassword: 'Both passwords must match.' });
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = text(form, 'email');
    setBusy(true);

    try {
      await api.post('/api/auth/signup', {
        name: text(form, 'name'),
        email,
        password,
      });
      await api.post('/api/auth/login', { email, password });
      await refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields?.length) {
          setFieldErrors(Object.fromEntries(error.fields.map((f) => [f.path, f.message])));
          setMessage('Some fields need attention.');
        } else {
          setMessage(error.message);
        }
      } else {
        setMessage('Could not reach the server. Check that the API is running.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cgauth">
      <AuthAside
        title="Create your account and"
        highlight="get started."
        body="Start your journey to clearer governance and better outcomes for your homes."
        points={POINTS}
        image="/images/gallery/22_care_manager_resident_indoor.jpg"
        imageAlt=""
      />

      <main className="cgauth-main">
        <div className="cgauth-form-wrap wide">
          <BackHome />
          <h2 className="cgauth-title">Sign up</h2>
          <p className="cgauth-sub">Create your governance workspace.</p>

          {message ? <div className="cgauth-alert" role="alert">{message}</div> : null}

          <form onSubmit={(e) => void submit(e)} noValidate>
            <AuthField
              label="Full name"
              name="name"
              placeholder="Enter your full name"
              autoComplete="name"
              icon={<UserIcon />}
              error={fieldErrors.name}
              required
              minLength={2}
            />

            <AuthField
              label="Work email"
              name="email"
              type="email"
              placeholder="you@organisation.co.uk"
              autoComplete="email"
              icon={<MailIcon />}
              error={fieldErrors.email}
              required
            />

            <div className="cgauth-pair">
              <PasswordField
                label="Password"
                name="password"
                placeholder="Create a password"
                autoComplete="new-password"
                error={fieldErrors.password}
                value={password}
                onChange={setPassword}
              />
              <PasswordField
                label="Confirm password"
                name="confirmPassword"
                placeholder="Repeat it"
                autoComplete="new-password"
                error={fieldErrors.confirmPassword}
                value={confirm}
                onChange={setConfirm}
              />
            </div>

            <ul className="cgauth-rules" aria-label="Password requirements" aria-live="polite">
              {RULES.map((r) => (
                <li key={r.label} className={r.test(password) ? 'met' : undefined}>
                  <CheckIcon size={12} />
                  {r.label}
                </li>
              ))}
            </ul>

            <label className="cgauth-terms">
              <input type="checkbox" name="terms" required />
              <span>
                I agree to the <a className="cgauth-link" href="#terms">Terms</a> &amp;{' '}
                <a className="cgauth-link" href="#privacy">Privacy Policy</a>
              </span>
            </label>

            <button type="submit" className="cgauth-submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account'}
            </button>
          </form>

          <SsoBlock />

          <p className="cgauth-switch">
            Already have an account? <Link className="cgauth-link" to="/sign-in">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
