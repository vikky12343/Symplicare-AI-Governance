import { useAuth } from '../lib/hooks.js';

/**
 * The manager's avatar.
 *
 * One component, reading one field on the session, so the rail, the profile
 * page and every other place that shows who is signed in can never disagree
 * about which photograph is current. When there is no photograph it falls back
 * to initials rather than to a placeholder silhouette.
 */

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export function Avatar({
  size = 32,
  name,
  src,
  className,
}: {
  size?: number;
  /** Defaults to the signed-in manager. */
  name?: string;
  src?: string | null;
  className?: string;
}) {
  const { user } = useAuth();
  const label = name ?? user?.name ?? '';
  const photo = src === undefined ? user?.avatarUrl ?? null : src;

  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };

  if (photo) {
    return (
      <img
        className={`avatar-img${className ? ` ${className}` : ''}`}
        style={style}
        src={photo}
        alt=""
        width={size}
        height={size}
      />
    );
  }

  return (
    <span className={`avatar${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      {initialsOf(label)}
    </span>
  );
}
