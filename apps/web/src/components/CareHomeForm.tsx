import { useState, type FormEvent } from 'react';
import { ApiError, CARE_HOME_TYPES, api, type CareHomeSummary } from '../lib/api.js';

/**
 * Add or edit a care home.
 *
 * The same form serves first-time setup and the care-homes page, because they
 * collect exactly the same thing — and a manager who has done it once should
 * recognise it the second time.
 */

export type CareHomeDraft = Partial<CareHomeSummary> & { name?: string };

const EMPTY: CareHomeDraft = {
  name: '',
  type: 'Residential',
  addressLine1: '',
  addressLine2: '',
  town: '',
  county: '',
  postcode: '',
  beds: null,
  residents: null,
  cqcLocationId: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
};

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function textOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function CareHomeForm({
  home,
  submitLabel = 'Save care home',
  onSaved,
  onCancel,
}: {
  /** Present when editing; absent when adding. */
  home?: CareHomeSummary | null;
  submitLabel?: string;
  onSaved: (saved: CareHomeSummary) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const initial = home ?? EMPTY;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      name: textOf(form, 'name'),
      type: textOf(form, 'type'),
      addressLine1: textOf(form, 'addressLine1'),
      addressLine2: textOf(form, 'addressLine2'),
      town: textOf(form, 'town'),
      county: textOf(form, 'county'),
      postcode: textOf(form, 'postcode'),
      beds: numberOrNull(form.get('beds')),
      residents: numberOrNull(form.get('residents')),
      cqcLocationId: textOf(form, 'cqcLocationId'),
      contactName: textOf(form, 'contactName'),
      contactPhone: textOf(form, 'contactPhone'),
      contactEmail: textOf(form, 'contactEmail'),
      notes: textOf(form, 'notes'),
    };

    try {
      const response = home
        ? await api.patch<{ careHome: CareHomeSummary }>(`/api/care-homes/${home.id}`, payload)
        : await api.post<{ careHome: CareHomeSummary }>('/api/care-homes', payload);
      await onSaved(response.careHome);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields?.length) {
          setFieldErrors(Object.fromEntries(error.fields.map((f) => [f.path, f.message])));
          setMessage('Some fields need attention.');
        } else {
          setMessage(error.message);
        }
      } else {
        setMessage('Could not reach the server. Your changes have not been saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cgform" onSubmit={(e) => void submit(e)} noValidate>
      {message ? <div className="cgform-alert" role="alert">{message}</div> : null}

      <label className="cgfield">
        <span className="cgfield-label">Care home name</span>
        <input name="name" defaultValue={initial.name ?? ''} placeholder="Ashgrove Care Home" required maxLength={200} />
        {fieldErrors.name ? <span className="cgfield-error">{fieldErrors.name}</span> : null}
      </label>

      <label className="cgfield">
        <span className="cgfield-label">Care home type</span>
        <select name="type" defaultValue={initial.type ?? 'Residential'}>
          {CARE_HOME_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label className="cgfield">
        <span className="cgfield-label">Address line 1</span>
        <input name="addressLine1" defaultValue={initial.addressLine1 ?? ''} placeholder="123 Care Street" maxLength={200} />
      </label>

      <label className="cgfield">
        <span className="cgfield-label">Address line 2 <em>Optional</em></span>
        <input name="addressLine2" defaultValue={initial.addressLine2 ?? ''} maxLength={200} />
      </label>

      <div className="cgform-row">
        <label className="cgfield">
          <span className="cgfield-label">Town or city</span>
          <input name="town" defaultValue={initial.town ?? ''} placeholder="Manchester" maxLength={120} />
        </label>
        <label className="cgfield">
          <span className="cgfield-label">County <em>Optional</em></span>
          <input name="county" defaultValue={initial.county ?? ''} maxLength={120} />
        </label>
      </div>

      <div className="cgform-row">
        <label className="cgfield">
          <span className="cgfield-label">Postcode</span>
          <input name="postcode" defaultValue={initial.postcode ?? ''} placeholder="M12 4AB" maxLength={16} />
        </label>
        <label className="cgfield">
          <span className="cgfield-label">CQC location ID <em>Optional</em></span>
          <input name="cqcLocationId" defaultValue={initial.cqcLocationId ?? ''} placeholder="1-234567890" maxLength={64} />
        </label>
      </div>

      <div className="cgform-row">
        <label className="cgfield">
          <span className="cgfield-label">Number of beds</span>
          <input name="beds" type="number" inputMode="numeric" min={1} max={2000} defaultValue={initial.beds ?? ''} placeholder="42" />
          {fieldErrors.beds ? <span className="cgfield-error">{fieldErrors.beds}</span> : null}
        </label>
        <label className="cgfield">
          <span className="cgfield-label">Number of residents</span>
          <input name="residents" type="number" inputMode="numeric" min={0} max={2000} defaultValue={initial.residents ?? ''} placeholder="39" />
        </label>
      </div>

      <div className="cgform-row">
        <label className="cgfield">
          <span className="cgfield-label">Contact name <em>Optional</em></span>
          <input name="contactName" defaultValue={initial.contactName ?? ''} maxLength={200} />
        </label>
        <label className="cgfield">
          <span className="cgfield-label">Contact phone <em>Optional</em></span>
          <input name="contactPhone" defaultValue={initial.contactPhone ?? ''} maxLength={40} />
        </label>
      </div>

      <label className="cgfield">
        <span className="cgfield-label">Contact email <em>Optional</em></span>
        <input name="contactEmail" type="email" defaultValue={initial.contactEmail ?? ''} maxLength={254} />
        {fieldErrors.contactEmail ? <span className="cgfield-error">{fieldErrors.contactEmail}</span> : null}
      </label>

      <label className="cgfield">
        <span className="cgfield-label">Notes <em>Optional</em></span>
        <textarea name="notes" defaultValue={initial.notes ?? ''} rows={3} maxLength={2000} />
      </label>

      <div className="cgform-actions">
        {onCancel ? (
          <button type="button" className="cgbtn cgbtn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="cgbtn cgbtn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
