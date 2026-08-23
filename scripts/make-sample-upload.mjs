/**
 * Generates a filled-in sample upload — the same sheet a care home would send.
 *
 *   node scripts/make-sample-upload.mjs --code CH-01 --name "Ashfield House"
 *
 * One file per reporting month, because that is how the service takes them —
 * each period gets its own dataset version, so a correction can supersede one
 * month without touching the rest. Both accepted formats are written:
 * samples/<code>/<code>-<period>.xlsx and the same again as .csv.
 *
 * The numbers are written by hand, not drawn at random, so the result is the
 * same on every run and the trend engine's verdict on it can be checked by
 * arithmetic. The story they tell is deliberate: eleven quiet months, then a
 * workforce strain in the last three — absence, agency use and overdue
 * supervisions rising together — which is the convergent pattern the service
 * exists to catch, while everything else stays inside its normal variation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { INDICATOR_BY_ID } from '../packages/core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const code = arg('--code', 'CH-01');
const name = arg('--name', 'Sample House');
const lastPeriod = arg('--period', '2026-08');
/* How many months to write, ending at --period. The engine needs at least
   four earlier periods before it will judge the latest one, so fewer than
   five months produces a set that reads "insufficient data" throughout. */
const count = Math.max(1, Math.min(12, Number(arg('--months', '12')) || 12));

/** The twelve months ending at --period, oldest first. */
function periods(end, count) {
  const [y, m] = end.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const months = periods(lastPeriod, count);
if (count < 5) {
  console.warn(`${count} months is below the baseline minimum — expect "insufficient data" on every indicator.`);
}

/** Month-end, so reporting_period_end is a real date rather than a guess. */
function endOf(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/*
 * One row per indicator: twelve values, oldest first. The last three months
 * carry the movement. Everything else oscillates within a tick or two of its
 * own level — real data is never flat, and a perfectly flat series would give
 * the engine a zero spread to divide by.
 */
const SERIES = {
  Q01: [3.1, 3.4, 3.0, 3.3, 3.2, 3.5, 3.1, 3.3, 3.2, 3.4, 3.3, 3.6],
  Q02: [1.2, 1.0, 1.3, 1.1, 1.2, 1.0, 1.3, 1.1, 1.2, 1.1, 1.3, 1.2],
  Q03: [0.4, 0.3, 0.5, 0.3, 0.4, 0.4, 0.3, 0.5, 0.4, 0.3, 0.4, 0.4],
  /* Absence: settled around 5%, then a clear climb. */
  Q04: [5.1, 4.8, 5.3, 4.9, 5.2, 5.0, 5.1, 4.9, 5.2, 6.4, 7.6, 8.9],
  /* Agency cover follows absence, as it does in practice. */
  Q05: [8.2, 7.9, 8.4, 8.0, 8.3, 8.1, 8.2, 7.8, 8.3, 10.1, 12.4, 14.8],
  Q06: [22.0, 21.4, 22.6, 21.8, 22.2, 21.9, 22.4, 21.6, 22.1, 22.8, 23.4, 24.1],
  Q07: [6.0, 5.4, 6.3, 5.8, 6.1, 5.6, 6.2, 5.9, 6.0, 6.4, 5.8, 6.2],
  /* Supervisions slip once the rota is under strain. */
  Q08: [9.0, 8.4, 9.3, 8.7, 9.1, 8.6, 9.2, 8.8, 9.0, 12.2, 15.6, 18.4],
  Q09: [11.0, 10.2, 11.6, 10.8, 11.2, 10.6, 11.4, 10.9, 11.1, 11.7, 11.0, 11.5],
  Q10: [2, 1, 2, 2, 1, 2, 1, 2, 2, 1, 2, 2],
  Q11: [0.8, 0.6, 0.9, 0.7, 0.8, 0.6, 0.9, 0.7, 0.8, 0.7, 0.9, 0.8],
  Q12: [1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 1, 2],
  /* Satisfaction is the one indicator where lower is worse. */
  Q13: [86, 87, 85, 88, 86, 87, 86, 88, 87, 86, 85, 84],
  Q14: [4.2, 3.8, 4.4, 4.0, 4.3, 3.9, 4.2, 4.1, 4.0, 4.5, 4.1, 4.4],
  Q15: [1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 2, 2],
};

const HEADER = [
  'reporting_period_start',
  'reporting_period_end',
  'care_home_id',
  'indicator_id',
  'indicator_name',
  'numerator',
  'denominator',
  'value',
  'unit',
  'source_system',
  'data_quality_status',
  'notes',
];

function rowsFor(period) {
  const rows = [];
  for (const [id, values] of Object.entries(SERIES)) {
    const indicator = INDICATOR_BY_ID.get(id);
    if (!indicator) throw new Error(`${id} is not in the indicator library.`);
    const value = values.slice(-months.length)[months.indexOf(period)];
    rows.push([
      `${period}-01`,
      endOf(period),
      code,
      id,
      indicator.name,
      '',
      '',
      value.toFixed(indicator.dp),
      indicator.unit,
      'Sample data',
      'Final',
      '',
    ]);
  }
  return rows;
}

const dir = resolve(root, 'samples', code);
mkdirSync(dir, { recursive: true });

for (const period of months) {
  const rows = rowsFor(period);

  /* CSV: every field quoted, so a comma inside a unit or a name cannot shift
     a column. */
  const csv = [HEADER, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  writeFileSync(resolve(dir, `${code}-${period}.csv`), `${csv}\n`, 'utf8');

  const book = new ExcelJS.Workbook();
  book.creator = 'Symplicare AI Governance';
  const sheet = book.addWorksheet(`Indicators ${period}`);
  sheet.addRow(HEADER);
  sheet.getRow(1).font = { name: 'Arial', bold: true };
  for (const r of rows) {
    /* Numbers go in as numbers, not text — that is how a real sheet arrives. */
    sheet.addRow(r.map((c, i) => (i === 7 ? Number(c) : c)));
  }
  sheet.columns = HEADER.map((h, i) => ({ width: i === 4 || i === 8 ? 34 : Math.max(14, h.length + 2) }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  await book.xlsx.writeFile(resolve(dir, `${code}-${period}.xlsx`));
}

console.log(`${name} (${code}) — ${months.length} months, ${months[0]} to ${months.at(-1)}`);
console.log(`${months.length * 2} files in ${dir}`);
