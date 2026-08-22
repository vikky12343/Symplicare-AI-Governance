import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCareHomes, useSelection } from '../lib/hooks.js';

/**
 * Which care home the workspace is looking at.
 *
 * A native select was fine for three homes and unusable for thirty, so this is
 * a proper menu: searchable once the list is long enough to need it, with the
 * organisation-wide view as a first-class option rather than a row that looks
 * like the others.
 */

const SEARCH_FROM = 7;

export function HomeSwitcher() {
  const selection = useSelection();
  const homes = useCareHomes();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const list = useMemo(() => homes.data?.careHomes ?? [], [homes.data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((h) =>
      [h.name, h.town, h.postcode, h.code].some((v) => (v ?? '').toLowerCase().includes(needle)),
    );
  }, [list, query]);

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
    if (list.length >= SEARCH_FROM) search.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, list.length]);

  const isAll = selection.careHomeId === 'all';
  const current = list.find((h) => h.id === selection.careHomeId);

  function choose(id: string) {
    selection.setCareHomeId(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="homesw" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`homesw-trigger${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Care home"
      >
        <span className="homesw-mark" aria-hidden="true">
          {isAll ? <GridIcon /> : <HomeIcon />}
        </span>
        <span className="homesw-text">
          <span className="homesw-label">{isAll ? 'All care homes' : current?.name ?? 'Select a home'}</span>
          <span className="homesw-sub">
            {isAll
              ? `${list.length} home${list.length === 1 ? '' : 's'} · organisation view`
              : current?.town || 'Care home'}
          </span>
        </span>
        <span className="homesw-caret" aria-hidden="true"><CaretIcon /></span>
      </button>

      {open ? (
        <div className="homesw-panel" role="menu" aria-label="Choose a care home">
          {list.length >= SEARCH_FROM ? (
            <div className="homesw-search">
              <SearchIcon />
              <input
                ref={search}
                type="search"
                value={query}
                placeholder="Search homes…"
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search care homes"
              />
            </div>
          ) : null}

          <button
            type="button"
            role="menuitemradio"
            aria-checked={isAll}
            className={`homesw-item wide${isAll ? ' on' : ''}`}
            onClick={() => choose('all')}
          >
            <span className="homesw-item-mark"><GridIcon /></span>
            <span>
              <b>All care homes</b>
              <span>Aggregated across the organisation</span>
            </span>
            {isAll ? <TickIcon /> : null}
          </button>

          <div className="homesw-list">
            {filtered.map((h) => (
              <button
                key={h.id}
                type="button"
                role="menuitemradio"
                aria-checked={h.id === selection.careHomeId}
                className={`homesw-item${h.id === selection.careHomeId ? ' on' : ''}`}
                onClick={() => choose(h.id)}
              >
                <span className="homesw-item-mark"><HomeIcon /></span>
                <span>
                  <b>{h.name}</b>
                  <span>
                    {[h.town, h.beds ? `${h.beds} beds` : ''].filter(Boolean).join(' · ') || h.type}
                  </span>
                </span>
                {h.id === selection.careHomeId ? <TickIcon /> : null}
              </button>
            ))}
            {filtered.length === 0 ? <p className="homesw-none">No home matches “{query}”.</p> : null}
          </div>

          <button
            type="button"
            className="homesw-add"
            onClick={() => {
              setOpen(false);
              void navigate('/care-homes');
            }}
          >
            <PlusIcon /> Add or manage care homes
          </button>
        </div>
      ) : null}
    </div>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 20V9.6L12 4l8 5.6V20" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}
function CaretIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.4}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function TickIcon() {
  return (
    <svg className="homesw-tick" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.6}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
