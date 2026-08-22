/**
 * Reading values out of a form.
 *
 * `FormData.get()` returns `string | File | null`. Calling `String()` on it
 * looks harmless and works until the form gains a file input, at which point the
 * field silently becomes the text "[object File]" and is submitted as if it were
 * real. These helpers return a string only when the value actually is one.
 */

export function text(form: FormData, name: string, fallback = ''): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : fallback;
}

/** For fields the API requires; throws rather than posting an empty string. */
export function required(form: FormData, name: string): string {
  const value = text(form, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function number(form: FormData, name: string): number | null {
  const value = text(form, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function file(form: FormData, name: string): File | null {
  const value = form.get(name);
  return value instanceof File ? value : null;
}
