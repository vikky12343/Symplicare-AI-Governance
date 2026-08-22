import type { Indicator } from './types.js';

/**
 * Number formatting. `fmtVal` is deliberately unit-free so a unit can never be
 * appended twice; anything that wants one asks for it explicitly.
 */

export function fmtVal(value: number | null | undefined, ind?: Indicator): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(ind ? ind.dp : 2);
}

export function unitSuffix(ind: Indicator): string {
  return ind.unit === '%' ? '%' : '';
}

export function fmtUnit(value: number | null | undefined, ind: Indicator): string {
  if (value === null || value === undefined) return '—';
  return fmtVal(value, ind) + unitSuffix(ind);
}

/**
 * A baseline is a median, so a whole-number indicator can still have a
 * fractional one. Showing 1.5 as "2" next to "+100%" would not add up.
 */
export function fmtBase(value: number | null | undefined, ind: Indicator): string {
  if (value === null || value === undefined) return '—';
  const dp = ind.dp === 0 && Math.abs(value - Math.round(value)) > 1e-9 ? 1 : ind.dp;
  return Number(value).toFixed(dp);
}

export function fmtSigned(value: number | null | undefined, dp = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(dp)}`;
}

/** The full unit, for places with room to print it. */
export function unitLabel(ind: Indicator): string {
  if (ind.unit === '%') return '%';
  if (ind.unit.includes('1,000')) return 'per 1,000 resident-days';
  if (ind.unit.startsWith('Score')) return 'score 0–100';
  return ind.unit.toLowerCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
