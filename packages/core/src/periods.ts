/**
 * Reporting periods.
 *
 * A period is a calendar month identified as `YYYY-MM`. The source Notes sheet
 * allows a home to declare its own cycle; when it does, its declared start and
 * end dates travel with the dataset rather than being inferred here.
 */

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface Period {
  id: string;
  year: number;
  month: number;
  days: number;
  start: string;
  end: string;
  quarter: number;
  quarterId: string;
  label: string;
  short: string;
}

export function isPeriodId(id: string): boolean {
  return PERIOD_RE.test(id);
}

export function parsePeriod(id: string): Period {
  const m = PERIOD_RE.exec(id);
  if (!m) throw new Error(`Not a reporting period id: "${id}" (expected YYYY-MM)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const quarter = Math.ceil(month / 3);
  return {
    id,
    year,
    month,
    days,
    start: `${id}-01`,
    end: `${id}-${String(days).padStart(2, '0')}`,
    quarter,
    quarterId: `${year}-Q${quarter}`,
    label: `${MONTH_ABBR[month - 1]} ${year}`,
    short: `${MONTH_ABBR[month - 1]} ${String(year).slice(2)}`,
  };
}

export function periodLabel(id: string): string {
  return parsePeriod(id).label;
}

/** Steps a period id by whole months, forwards or backwards. */
export function shiftPeriod(id: string, months: number): string {
  const { year, month } = parsePeriod(id);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** Inclusive range of period ids. */
export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  const guard = 1200; // a century of months is far past any real use
  for (let i = 0; i < guard; i++) {
    out.push(cur);
    if (cur === to) return out;
    cur = shiftPeriod(cur, 1);
  }
  throw new Error(`Period range ${from}..${to} is implausibly long`);
}

/** The last `count` periods ending at `to`, oldest first. */
export function lastPeriods(to: string, count: number): string[] {
  return periodRange(shiftPeriod(to, -(count - 1)), to);
}

export function comparePeriodIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The period a date falls in, from an ISO date or a Date. */
export function periodOf(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${String(date)}`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The months belonging to a quarter, oldest first. */
export function quarterMonths(year: number, quarter: number): string[] {
  const first = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map((k) => `${year}-${String(first + k).padStart(2, '0')}`);
}

export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, '0')}`);
}

/** Whether an indicator that reports quarterly is due in this month. */
export function isQuarterEnd(periodId: string): boolean {
  return [3, 6, 9, 12].includes(parsePeriod(periodId).month);
}
