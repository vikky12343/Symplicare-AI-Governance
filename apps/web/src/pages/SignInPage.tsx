import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/hooks.js';
import { text } from '../lib/forms.js';
import {
  AuthAside,
  AuthField,
  BackHome,
  MailIcon,
  PasswordField,
  SsoBlock,
} from '../components/auth-parts.js';
import '../styles/auth.css';

const POINTS = [
  {
    num: '01',
    title: 'Signals that explain themselves.',
    desc: 'Every flag names the indicators, periods and baseline it was built from.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17l5-6 4 3.5L21 6" />
        <path d="M16 6h5v5" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'A record you can defend.',
    desc: 'Reports keep the values they were generated from; a correction creates a version rather than overwriting one.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Gaps stay visible.',
    desc: 'A missing period is never imputed, carried forward or counted as a good month.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
];

export function SignInPage() {
  const { user, loading, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (loading) return <div className="load-state">Checking your session…</div>;
  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const mfaToken = text(form, 'mfaToken') || undefined;

    try {
      const response = await api.post<{ mfaRequired?: boolean; message?: string }>('/api/auth/login', {
        email: text(form, 'email'),
        password: text(form, 'password'),
        mfaToken,
      });

      if (response.mfaRequired) {
        setMfaPending(true);
        setMessage(response.message ?? 'Enter the code from your authenticator app.');
        return;
      }

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
        title="Turn care home data into"
        highlight="better decisions."
        body="Quality and governance intelligence for UK care homes — identify emerging trends, understand the evidence behind them, and turn findings into measurable action."
        points={POINTS}
        image="/images/gallery/21_care_manager_resident_exterior.jpg"
        imageAlt=""
      />

      <main className="cgauth-main">
        <div className="cgauth-form-wrap">
          <BackHome />
          <h2 className="cgauth-title">Sign in</h2>
          <p className="cgauth-sub">Use your work email address.</p>

          {message ? <div className="cgauth-alert" role="alert">{message}</div> : null}

          <form onSubmit={(e) => void submit(e)} noValidate>
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

            <PasswordField
              label="Password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              error={fieldErrors.password}
            />

            {mfaPending ? (
              <AuthField
                label="Authenticator code"
                name="mfaToken"
                placeholder="6-digit code"
                autoComplete="one-time-code"
                error={fieldErrors.mfaToken}
                required
              />
            ) : null}

            <div className="cgauth-row">
              <label className="cgauth-check">
                <input type="checkbox" name="remember" /> Remember me
              </label>
              <a className="cgauth-link" href="#forgot">Forgot password?</a>
            </div>

            <button type="submit" className="cgauth-submit" disabled={busy}>
              {busy ? 'Signing in…' : mfaPending ? 'Verify and sign in' : 'Sign in'}
            </button>
          </form>

          <SsoBlock />

          <p className="cgauth-switch">
            No organisation yet? <Link className="cgauth-link" to="/sign-up">Create one</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
