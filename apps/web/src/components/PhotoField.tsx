import { useRef, useState } from 'react';
import { ApiError, api, type SessionUser } from '../lib/api.js';
import { useAuth } from '../lib/hooks.js';
import { Avatar } from './Avatar.js';

/**
 * Upload, replace or remove the manager's photograph.
 *
 * The preview is a local object URL so the crop is visible before anything is
 * sent, and the upload is a separate deliberate step — a file chooser closing
 * is not consent to publish the file it selected.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 2 * 1024 * 1024;

export function PhotoField({ onSaved }: { onSaved: (profile: SessionUser) => void | Promise<void> }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;

    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 2MB.`);
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setPending(file);
  }

  function discard() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPending(null);
    if (input.current) input.current.value = '';
  }

  async function upload() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('photo', pending);
      const response = await api.upload<{ profile: SessionUser }>('/api/profile/photo', form);
      discard();
      await onSaved(response.profile);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photo could not be uploaded. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.delete<{ profile: SessionUser }>('/api/profile/photo');
      discard();
      await onSaved(response.profile);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photo could not be removed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photofield">
      <div className="photofield-frame">
        {preview ? (
          <img className="avatar-img" style={{ width: 84, height: 84 }} src={preview} alt="Your new profile photo" />
        ) : (
          <Avatar size={84} />
        )}
      </div>

      <div className="photofield-controls">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
        />

        {pending ? (
          <>
            <button type="button" className="cgbtn cgbtn-primary sm" onClick={() => void upload()} disabled={busy}>
              {busy ? 'Uploading…' : 'Save photo'}
            </button>
            <button type="button" className="cgbtn cgbtn-ghost sm" onClick={discard} disabled={busy}>
              Discard
            </button>
          </>
        ) : (
          <>
            <button type="button" className="cgbtn cgbtn-ghost sm" onClick={() => input.current?.click()} disabled={busy}>
              <PhotoIcon /> {user?.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {user?.avatarUrl ? (
              <button type="button" className="cgbtn cgbtn-ghost sm danger" onClick={() => void remove()} disabled={busy}>
                Remove
              </button>
            ) : null}
          </>
        )}

        <p className="photofield-hint">JPG, PNG or WebP, up to 2MB. Without one, your initials are shown.</p>
        {error ? <p className="cgfield-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function PhotoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}
