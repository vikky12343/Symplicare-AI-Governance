import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/hooks.js';
import { Avatar } from './Avatar.js';

/**
 * Who is signed in, and everything that belongs to them.
 *
 * This lives in the top bar rather than the rail because it is about the
 * person, not about the governance work — and because the rail was carrying
 * sixteen destinations, which is more than anyone scans.
 *
 * The destinations are a grid of tiles rather than a list of rows: five short
 * labels read faster in two columns than in one long column, and the tiles
 * give the panel structure without needing dividers everywhere.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const TILES: { to: string; label: string; hint: string; icon: ReactNode }[] = [
  {
    to: '/profile',
    label: 'Your profile',
    hint: 'Name, photo, contact',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
  {
    to: '/care-homes',
    label: 'Care homes',
    hint: 'Add, edit, archive',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <path d="M4 20V9.6L12 4l8 5.6V20" />
        <path d="M9.5 20v-5h5v5" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    hint: 'Thresholds, team',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      </svg>
    ),
  },
  {
    to: '/build-rules',
    label: 'Build rules',
    hint: 'What the engine obeys',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    to: '/working-defaults',
    label: 'Working defaults',
    hint: 'The five open items',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <path d="M12 21s7.5-3.6 7.5-9.2V5.4L12 2.6 4.5 5.4v6.4C4.5 17.4 12 21 12 21z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

export function UserMenu() {
  const { user, organisation, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /* Close on a click elsewhere, on Escape, and whenever the route changes —
     a menu still hanging open over the page you just navigated to is the
     commonest way this pattern feels broken. */
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="usermenu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`usermenu-trigger${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {/* Name first, then the face: the trigger sits at the right edge of
            the bar, so reading inwards-to-outwards puts the avatar closest to
            the edge and the words where the eye lands first. */}
        <span className="usermenu-who">
          <span className="usermenu-name">{user.name}</span>
          <span className="usermenu-role">{user.managerRole ?? user.role}</span>
        </span>
        <Avatar size={30} />
        <span className="usermenu-caret" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="usermenu-panel" role="menu" aria-label="Account">
          <div className="usermenu-head">
            <Avatar size={42} />
            <span className="usermenu-head-text">
              <b>{user.name}</b>
              <span className="usermenu-email">{user.email}</span>
              <span className="usermenu-role-chip">{user.managerRole ?? user.role}</span>
            </span>
          </div>

          {organisation?.name ? (
            <Link to="/profile" className="usermenu-org" role="menuitem">
              <span className="usermenu-org-mark" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
                  <rect x="3.5" y="7" width="17" height="14" rx="2.2" />
                  <path d="M8 7V4.5h8V7M9.5 12h5M9.5 16h5" />
                </svg>
              </span>
              <span>
                <b>{organisation.name}</b>
                <span>Organisation</span>
              </span>
            </Link>
          ) : null}

          <div className="usermenu-grid">
            {TILES.map((t) => (
              <Link key={t.to} to={t.to} role="menuitem" className="usermenu-tile">
                <span className="usermenu-tile-icon">{t.icon}</span>
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </Link>
            ))}
          </div>

          <button type="button" role="menuitem" className="usermenu-signout" onClick={() => void signOut()}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
              <path d="M15 17l5-5-5-5M20 12H9M12 20H6.5A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4H12" />
            </svg>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
