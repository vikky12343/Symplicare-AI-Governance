import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { parsePeriod } from '@cgi/core';
import { useAuth, useCan, useCareHomes, useOverview, useSelection } from '../lib/hooks.js';
import { LOGO_SRC } from './brand.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { HomeSwitcher } from './HomeSwitcher.js';
import { UserMenu } from './UserMenu.js';

const NAV_GROUPS: { group: string; items: { to: string; label: string; capability?: string }[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/signals', label: 'Signals' },
      { to: '/actions', label: 'Action centre' },
    ],
  },
  {
    group: 'Indicators',
    items: [
      { to: '/indicators', label: 'Indicator library' },
      { to: '/leading-lagging', label: 'Leading vs lagging' },
      { to: '/assurance', label: 'Governance assurance' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { to: '/reports', label: 'Reports' },
      { to: '/compare', label: 'Compare periods' },
      { to: '/evidence', label: 'Evidence library' },
    ],
  },
  {
    group: 'Data',
    items: [
      { to: '/uploads', label: 'Data uploads', capability: 'uploadData' },
      { to: '/quality', label: 'Data quality' },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { organisation } = useAuth();
  const can = useCan();
  const selection = useSelection();
  const location = useLocation();
  const homes = useCareHomes();
  /* One call serves both scopes. Asking the per-home routes for "all" would
     be asking for a care home that does not exist. */
  const overview = useOverview(selection.careHomeId, selection.period);

  /* Pick a home and a period as soon as we know what exists, so no screen has
     to cope with "nothing selected yet". */
  useEffect(() => {
    const list = homes.data?.careHomes ?? [];
    if (list.length === 0) return;
    /* "all" is a real scope — the whole organisation — not a missing
       selection, so it must survive this reconciliation. */
    if (selection.careHomeId === 'all') return;
    const stillExists = list.some((h) => h.id === selection.careHomeId);
    if (!stillExists) selection.setCareHomeId(list.length > 1 ? 'all' : list[0]!.id);
  }, [homes.data, selection]);

  useEffect(() => {
    const list = overview.data?.periods;
    if (!list) return;
    /* Switching to a home that has no data must not leave the previous home's
       month selected — every screen would then ask for a period this home has
       never reported. */
    if (list.length === 0) {
      if (selection.period) selection.setPeriod('');
      return;
    }
    /* A month the manager pinned stays selected for as long as the home still
       reports it. An unpinned selection follows the newest month, so uploading
       data lands the manager on what they just filed rather than stranding
       them on whichever month happened to be first.

       The newest month is taken from the list of periods, not from the
       response's own `period` — that one echoes whatever was asked for, so
       comparing against it would only ever confirm the current selection. */
    const newest = list.map((p) => p.id).sort().at(-1);
    if (selection.periodPinned && selection.period && list.some((p) => p.id === selection.period)) return;
    if (newest && newest !== selection.period) selection.setPeriod(newest);
  }, [overview.data, selection]);

  const raisedSignals = overview.data?.kpis?.openSignals.value ?? 0;

  return (
    <div className="app on">
      <aside className="rail">
        <div className="rail-top">
          <div className="logo">
            <img className="logo-mark" src={LOGO_SRC} alt="" width={26} height={26} />
            Symplicare AI
          </div>
        </div>

        <nav className="rail-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((i) => !i.capability || can(i.capability));
            if (items.length === 0) return null;
            return (
              <div className="rail-group" key={group.group}>
                <span className="eyebrow">{group.group}</span>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `rail-item${isActive ? ' on' : ''}`}
                  >
                    {item.label}
                    {item.to === '/signals' && raisedSignals > 0 ? (
                      <span className="count">{raisedSignals}</span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="rail-foot">
          <span className="rail-org">{organisation?.name}</span>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          {/* Which home and which month are the same kind of question — what
              the workspace is currently looking at — so they sit together on
              the left, away from the account controls on the right. */}
          <div className="topbar-context">
            <HomeSwitcher />
            <label className="periodpick">
              <span className="periodpick-icon" aria-hidden="true"><CalendarIcon /></span>
              <select
                aria-label="Reporting period"
                value={selection.period ?? ''}
                onChange={(e) => selection.setPeriod(e.target.value, true)}
              >
                {/* A home with nothing filed yet has no periods to choose
                    between, so the control says so instead of sitting blank. */}
                {(overview.data?.periods ?? []).length === 0 ? (
                  <option value="">No periods yet</option>
                ) : null}
                {(overview.data?.periods ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <span className="topbar-page" aria-hidden="true">{pageTitle(location.pathname)}</span>

          <div className="topbar-tools">
            {/* Not a notification bell — it is the live count of raised
                patterns, and it goes to the screen that explains them. */}
            <NavLink
              to="/signals"
              className="topbar-signals"
              aria-label={`${raisedSignals} open signal${raisedSignals === 1 ? '' : 's'}`}
              title={`${raisedSignals} open signal${raisedSignals === 1 ? '' : 's'}`}
            >
              <SignalIcon />
              {raisedSignals > 0 ? <span className="topbar-signals-count">{raisedSignals}</span> : null}
            </NavLink>
            <span className="topbar-rule" aria-hidden="true" />
            <UserMenu />
          </div>
        </div>

        {/* The cockpit manages its own padding so it can fill the viewport
            exactly; every other screen keeps the standard view gutters. */}
        <main className={`view${location.pathname === '/dashboard' ? ' view-flush' : ''}`}>
            {homes.isSuccess && homes.data.careHomes.length === 0 ? (
              <ErrorBoundary resetKey={location.pathname}>
                <div className="answer st-watch" style={{ marginTop: 40 }}>
                  <h2>Welcome to your workspace</h2>
                  <p>You need to add a care home to begin using Symplicare AI.</p>
                  <button className="btn btn-primary" onClick={() => window.location.href = '/care-homes'}>Add care home</button>
                </div>
              </ErrorBoundary>
            ) : (
              <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
            )}
        </main>
      </div>
    </div>
  );
}

/**
 * The name of the screen the manager is on.
 *
 * Read off the same navigation table the rail renders, so a heading can never
 * disagree with the menu item that led to it.
 */
const EXTRA_TITLES: Record<string, string> = {
  /* These live in the account menu rather than the rail, so the nav table
     does not carry them. */
  '/build-rules': 'Build rules',
  '/working-defaults': 'Working defaults',
  '/care-homes': 'Care homes',
  '/profile': 'Your profile',
  '/settings': 'Settings',
  '/onboarding': 'Set-up',
};

function pageTitle(pathname: string): string {
  const item = NAV_GROUPS.flatMap((g) => g.items).find(
    (i) => pathname === i.to || pathname.startsWith(`${i.to}/`),
  );
  if (item) return item.label;
  return EXTRA_TITLES[pathname] ?? '';
}

function SignalIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" />
      <path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 16.6a6.5 6.5 0 0 0 0-9.2" />
      <path d="M4.4 4.4a10.7 10.7 0 0 0 0 15.2M19.6 19.6a10.7 10.7 0 0 0 0-15.2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** Formats a period id for display, tolerating a missing one. */
export function periodLabelOf(period: string | null): string {
  return period ? parsePeriod(period).label : '—';
}
