import { Link } from 'react-router-dom';

/**
 * The one place the logo file is named.
 *
 * Every surface that shows the mark — the rail, both auth screens, the landing
 * header and footer, the browser tab — resolves to this file, so replacing it
 * changes the brand everywhere at once.
 */
export const LOGO_SRC = '/brand/logo.svg';

/**
 * The Symplicare AI lockup: the mark and the name.
 * One component so the header, the footer and both auth screens can never
 * drift apart.
 */
export function BrandMark({
  size = 34,
  stacked = false,
  light = true,
  to = '/',
}: {
  size?: number;
  /** Two lines ("Care Governance" / "Intelligence") instead of one. */
  stacked?: boolean;
  /** Light text, for the dark surfaces. */
  light?: boolean;
  to?: string | null;
}) {
  const inner = (
    <>
      <img
        className="cg-mark"
        src={LOGO_SRC}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: Math.round(size * 0.26) }}
      />
      <span className={`cg-mark-name${stacked ? ' stacked' : ''}`} style={{ color: light ? '#F7FAF9' : '#0B1F27' }}>
        {stacked ? (
          <>
            <span>Symplicare AI</span>
            <span className="cg-mark-sub">Governance Intelligence</span>
          </>
        ) : (
          'Symplicare AI Governance Intelligence'
        )}
      </span>
    </>
  );

  if (!to) return <span className="cg-brand">{inner}</span>;
  return (
    <Link to={to} className="cg-brand" aria-label="Symplicare AI Governance Intelligence — home">
      {inner}
    </Link>
  );
}
