import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from './brand.js';

/* ── Small line icons ─────────────────────────────────────────── */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/* This is good */
export function MailIcon() {
  return (
    <svg className="lead" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3 6.5l9 6 9-6" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="lead" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg className="lead" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function BuildingIcon() {
  return (
    <svg className="lead" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 21V6.5L12 3l8 3.5V21" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 10h1.5M13.5 10H15" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.4}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ShieldIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 21s7.5-3.6 7.5-9.2V5.4L12 2.6 4.5 5.4v6.4C4.5 17.4 12 21 12 21z" />
    </svg>
  );
}

/* ── Back to homepage ─────────────────────────────────────────── */
export function BackHome() {
  return (
    <Link to="/" className="cgauth-back">
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <path d="M15 19l-7-7 7-7" />
      </svg>
      Back to homepage
    </Link>
  );
}

/* ── Text field ───────────────────────────────────────────────── */
export function AuthField({
  label,
  name,
  type = 'text',
  placeholder,
  autoComplete,
  icon,
  error,
  required,
  minLength,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: 'text' | 'email';
  placeholder?: string;
  autoComplete?: string;
  icon?: ReactNode;
  error?: string;
  required?: boolean;
  minLength?: number;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="cgauth-field">
      <label className="cgauth-label" htmlFor={id}>{label}</label>
      <div className="cgauth-input-wrap">
        {icon}
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      </div>
      {error ? <p className="cgauth-error">{error}</p> : null}
    </div>
  );
}

/* ── Password field, with a reveal toggle ─────────────────────── */
export function PasswordField({
  label,
  name,
  placeholder,
  autoComplete,
  error,
  value,
  onChange,
}: {
  label: string;
  name: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="cgauth-field">
      <label className="cgauth-label" htmlFor={id}>{label}</label>
      <div className="cgauth-input-wrap">
        <LockIcon />
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
        <button
          type="button"
          className="cgauth-reveal"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
        >
          {shown ? (
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" />
              <path d="M9.4 5.3A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.3 3.3M6.3 6.8C3.9 8.3 3 10.6 3 12c0 2.5 4 7 9 7a9 9 0 0 0 3.6-.75" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
              <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          )}
        </button>
      </div>
      {error ? <p className="cgauth-error">{error}</p> : null}
    </div>
  );
}

/* ── "or continue with" + Microsoft ───────────────────────────── */
export function SsoBlock() {
  return (
    <>
      <div className="cgauth-divider">or continue with</div>
      <button type="button" className="cgauth-sso">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="0" y="0" width="7" height="7" fill="#F25022" />
          <rect x="9" y="0" width="7" height="7" fill="#7FBA00" />
          <rect x="0" y="9" width="7" height="7" fill="#00A4EF" />
          <rect x="9" y="9" width="7" height="7" fill="#FFB900" />
        </svg>
        Continue with Microsoft
      </button>
    </>
  );
}

/* ── The dark left-hand panel, shared by both screens ─────────── */
export function AuthAside({
  title,
  highlight,
  body,
  points,
  image,
  imageAlt,
}: {
  title: string;
  highlight: string;
  body?: string;
  points: { num?: string; icon?: ReactNode; title: string; desc: string }[];
  image: string;
  imageAlt: string;
}) {
  return (
    <aside className="cgauth-aside">
      <div className="cgauth-aside-bg" aria-hidden="true">
        <img src={image} alt={imageAlt} width="820" height="900" loading="eager" />
      </div>

      <BrandMark size={30} />

      <div>
        <h1 className="cgauth-aside-title">
          {title} <span className="land-text-teal">{highlight}</span>
        </h1>
        {body ? <p className="cgauth-aside-body">{body}</p> : null}

        <div className="cgauth-points">
          {points.map((p) => (
            <div key={p.title} className="cgauth-point">
              <div className="cgauth-point-icon">{p.icon ?? <CheckIcon />}</div>
              <div>
                <p className="cgauth-point-title">
                  {p.num ? <span className="cgauth-point-num">{p.num}</span> : null}
                  {p.title}
                </p>
                <p className="cgauth-point-desc">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="cgauth-disclaimer">
        <ShieldIcon size={16} />
        Not affiliated with, endorsed by or operated by the Care Quality Commission.
      </p>
    </aside>
  );
}
