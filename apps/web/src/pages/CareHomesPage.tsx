import { useMemo, useState } from 'react';
import { ApiError, CARE_HOME_TYPES, api, type CareHomeSummary } from '../lib/api.js';
import { useAuth, useCareHomes, useSelection, useWorkspaceRefresh } from '../lib/hooks.js';
import { CareHomeForm } from '../components/CareHomeForm.js';
import '../styles/onboarding.css';

/**
 * Every care home in the workspace, addable and editable at any time.
 *
 * This page is deliberately not part of setup. Acquiring a home two years in
 * is an ordinary Tuesday, not a reason to walk back through onboarding.
 */

type View = 'cards' | 'table';
type Status = 'active' | 'archived';
type Sort = 'name' | 'beds' | 'town' | 'type';

const PAGE_SIZE = 12;

export function CareHomesPage() {
  const { user } = useAuth();
  const selection = useSelection();
  const refreshWorkspace = useWorkspaceRefresh();

  const [status, setStatus] = useState<Status>('active');
  const homes = useCareHomes(status === 'archived');

  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('All');
  const [sort, setSort] = useState<Sort>('name');
  const [view, setView] = useState<View>('cards');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<CareHomeSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CareHomeSummary | null>(null);

  const canManage = user?.capabilities.includes('manageSettings') ?? false;
  const all = useMemo(() => homes.data?.careHomes ?? [], [homes.data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = all
      .filter((h) => (status === 'archived' ? Boolean(h.archivedAt) : !h.archivedAt))
      .filter((h) => (type === 'All' ? true : h.type === type))
      .filter((h) =>
        needle === ''
          ? true
          : [h.name, h.town, h.postcode, h.type, h.code].some((v) => (v ?? '').toLowerCase().includes(needle)),
      );

    return [...matches].sort((a, b) => {
      if (sort === 'beds') return (b.beds ?? 0) - (a.beds ?? 0);
      if (sort === 'town') return (a.town || '~').localeCompare(b.town || '~');
      if (sort === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [all, query, type, sort, status]);

  /* Fifty homes is a supported number, so the list is paged rather than
     rendered as one endless column. */
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  async function afterSave() {
    await refreshWorkspace();
    setAdding(false);
    setEditing(null);
  }

  return (
    <div className="cgpage">
      <header className="cgpage-head">
        <div>
          <h1 className="cgpage-title">Your care homes</h1>
          <p className="cgpage-sub">Manage all care homes connected to your governance workspace.</p>
        </div>
        <div className="cgpage-head-actions">
          <span className="cgcount">
            <b>{all.filter((h) => !h.archivedAt).length}</b> care {all.filter((h) => !h.archivedAt).length === 1 ? 'home' : 'homes'}
          </span>
          {canManage ? (
            <button type="button" className="cgbtn cgbtn-primary" onClick={() => setAdding(true)}>
              + Add care home
            </button>
          ) : null}
        </div>
      </header>

      <div className="cgtoolbar">
        <label className="cgsearch">
          <SearchIcon />
          <input
            type="search"
            value={query}
            placeholder="Search by name, town, postcode or type…"
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            aria-label="Search care homes"
          />
        </label>

        <div className="cgfilters">
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter by type">
            <option value="All">All types</option>
            {CARE_HOME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(1); }} aria-label="Filter by status">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>

          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="name">Sort: name</option>
            <option value="town">Sort: town</option>
            <option value="type">Sort: type</option>
            <option value="beds">Sort: beds</option>
          </select>

          <div className="cgtoggle" role="group" aria-label="View">
            <button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>Cards</button>
            <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
      </div>

      {homes.isLoading ? <p className="cgnote">Loading your care homes…</p> : null}

      {!homes.isLoading && filtered.length === 0 ? (
        <div className="cgempty">
          <p>
            {all.length === 0
              ? 'No care homes yet.'
              : 'No care homes match those filters.'}
          </p>
          {all.length === 0 && canManage ? (
            <button type="button" className="cgbtn cgbtn-primary" onClick={() => setAdding(true)}>
              + Add your first care home
            </button>
          ) : null}
        </div>
      ) : null}

      {view === 'cards' && shown.length > 0 ? (
        <div className="cghome-grid">
          {shown.map((home) => (
            <article key={home.id} className="cghome-card">
              <header>
                <h2>{home.name}</h2>
                <span className="cgtag">{home.type}</span>
              </header>
              <p className="cghome-where">{[home.town, home.postcode].filter(Boolean).join(' · ') || 'No address yet'}</p>
              <dl className="cghome-facts">
                <div><dt>Beds</dt><dd>{home.beds ?? '—'}</dd></div>
                <div><dt>Residents</dt><dd>{home.residents ?? '—'}</dd></div>
                <div><dt>Latest data</dt><dd>{home.latestPeriod ?? 'None yet'}</dd></div>
              </dl>
              <footer>
                <button
                  type="button"
                  className="cgbtn cgbtn-ghost sm"
                  onClick={() => { selection.setCareHomeId(home.id); window.location.href = '/dashboard'; }}
                  disabled={Boolean(home.archivedAt)}
                >
                  View
                </button>
                {canManage ? (
                  <>
                    <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => setEditing(home)}>Edit</button>
                    {home.archivedAt ? (
                      <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => void restore(home, refreshWorkspace)}>
                        Restore
                      </button>
                    ) : (
                      <button type="button" className="cgbtn cgbtn-ghost sm danger" onClick={() => setRemoving(home)}>
                        Remove
                      </button>
                    )}
                  </>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      {view === 'table' && shown.length > 0 ? (
        <div className="cgtable-wrap">
          <table className="cgtable">
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>Town</th><th>Postcode</th><th>Beds</th><th>Latest data</th><th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((home) => (
                <tr key={home.id}>
                  <td><b>{home.name}</b></td>
                  <td>{home.type}</td>
                  <td>{home.town || '—'}</td>
                  <td>{home.postcode || '—'}</td>
                  <td>{home.beds ?? '—'}</td>
                  <td>{home.latestPeriod ?? 'None yet'}</td>
                  <td className="cgtable-actions">
                    {canManage ? (
                      <>
                        <button type="button" className="cglink" onClick={() => setEditing(home)}>Edit</button>
                        {home.archivedAt ? (
                          <button type="button" className="cglink" onClick={() => void restore(home, refreshWorkspace)}>Restore</button>
                        ) : (
                          <button type="button" className="cglink danger" onClick={() => setRemoving(home)}>Remove</button>
                        )}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav className="cgpager" aria-label="Pages">
          <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => setPage(current - 1)} disabled={current === 1}>
            Previous
          </button>
          <span>Page {current} of {pages}</span>
          <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => setPage(current + 1)} disabled={current === pages}>
            Next
          </button>
        </nav>
      ) : null}

      {adding ? (
        <Drawer title="Add a care home" onClose={() => setAdding(false)}>
          <CareHomeForm onSaved={afterSave} onCancel={() => setAdding(false)} />
        </Drawer>
      ) : null}

      {editing ? (
        <Drawer title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <CareHomeForm home={editing} submitLabel="Save changes" onSaved={afterSave} onCancel={() => setEditing(null)} />
        </Drawer>
      ) : null}

      {removing ? (
        <RemoveDialog
          home={removing}
          onCancel={() => setRemoving(null)}
          onDone={async () => { await refreshWorkspace(); setRemoving(null); }}
        />
      ) : null}
    </div>
  );
}

async function restore(home: CareHomeSummary, refresh: () => Promise<void>) {
  await api.patch(`/api/care-homes/${home.id}/restore`);
  await refresh();
}

/* ── Remove: archive, with a confirmation and no surprises ────── */
function RemoveDialog({
  home,
  onCancel,
  onDone,
}: {
  home: CareHomeSummary;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/care-homes/${home.id}/archive`);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this care home.');
      setBusy(false);
    }
  }

  return (
    <Drawer title="Remove care home?" onClose={onCancel} narrow>
      <p className="cgnote">
        <b>{home.name}</b> will no longer appear in your active care-home workspace. Its data and
        reports are kept, and you can restore it from the Archived filter at any time.
      </p>
      {error ? <div className="cgform-alert" role="alert">{error}</div> : null}
      <div className="cgform-actions end">
        <button type="button" className="cgbtn cgbtn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="cgbtn cgbtn-danger" onClick={() => void remove()} disabled={busy}>
          {busy ? 'Removing…' : 'Remove care home'}
        </button>
      </div>
    </Drawer>
  );
}

function Drawer({
  title,
  children,
  onClose,
  narrow,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  narrow?: boolean;
}) {
  return (
    <div className="cgdrawer-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`cgdrawer${narrow ? ' narrow' : ''}`}>
        <header className="cgdrawer-head">
          <h2>{title}</h2>
          <button type="button" className="cgdrawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="cgdrawer-body">{children}</div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}
