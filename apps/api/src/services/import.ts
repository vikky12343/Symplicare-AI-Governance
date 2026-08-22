import { Types } from 'mongoose';
import { INDICATOR_BY_ID, isPeriodId, parsePeriod, periodLabel } from '@cgi/core';
import { Dataset, IndicatorValue } from '../models/index.js';
import { ApiError } from '../errors.js';

/**
 * CSV import.
 *
 * Nothing is written until the caller has seen the validation result and the
 * preview. Two rules from the source pack are enforced here and not merely
 * described:
 *
 *  - an empty value becomes "insufficient data", never zero;
 *  - `indicator_id` is the canonical key, so a home renaming its own measure
 *    cannot break its own history.
 */

/**
 * Column synonyms.
 *
 * Two templates exist in the wild: the one this service generates, and the
 * "MVP Data Template" that shipped with the product specification and went to
 * pilot homes first. A home that fills in the sheet it was given must be able
 * to upload it, so its column names are accepted as aliases of ours rather
 * than rejected as a malformed file.
 *
 * Aliases are resolved once, at header level. Every row rule below is
 * unchanged and still reads the canonical name.
 */
const COLUMN_ALIASES: Readonly<Record<string, string>> = {
  /* MVP Data Template -> canonical */
  reporting_period: 'reporting_period_start',
  period: 'reporting_period_start',
  care_home: 'care_home_id',
  care_home_code: 'care_home_id',
  indicator_value: 'value',
  data_source: 'source_system',
  source: 'source_system',
  /* Carried for provenance but never authoritative: the care home and
     organisation are established by the route, not by the file. */
  organisation_id: 'organisation_id',
};

/** Columns a file must carry. The rest are optional or derivable. */
const REQUIRED_COLUMNS = ['care_home_id', 'indicator_id', 'reporting_period_start'] as const;

export const TEMPLATE_COLUMNS = [
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
  'uploaded_by',
  'uploaded_at',
] as const;

export interface RowIssue {
  row: number;
  field: string;
  message: string;
}

export interface AcceptedRow {
  indicatorId: string;
  period: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unit: string;
  sourceSystem: string;
  notes: string;
}

export interface ImportPreview {
  filename: string;
  rowsRead: number;
  accepted: AcceptedRow[];
  errors: RowIssue[];
  warnings: RowIssue[];
  missingColumns: string[];
  ignoredColumns: string[];
  periods: string[];
  changes: {
    indicatorId: string;
    period: string;
    stored: number | null;
    incoming: number | null;
    isNew: boolean;
  }[];
}

/** RFC 4180-ish parsing: quoted fields, escaped quotes, no external dependency. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw ApiError.badRequest('The file is empty.');
  const header = parseCsvLine(lines[0] as string).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  return { header, rows };
}

/**
 * Reading a spreadsheet into the same rows a CSV would give.
 *
 * Managers keep this data in Excel. Insisting they export to CSV first is an
 * extra step that goes wrong — wrong delimiter, wrong encoding, a stray BOM —
 * so the workbook is read directly and everything downstream is unchanged.
 *
 * Only the first worksheet is read, and only its used range. A cell carrying a
 * formula contributes its cached result, because that is what the person
 * looking at the sheet sees.
 */
export async function readWorkbook(body: Buffer): Promise<{ header: string[]; rows: string[][] }> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(body as never);
  } catch {
    throw ApiError.badRequest('That workbook could not be opened. Re-save it as .xlsx and try again.');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('That workbook has no worksheets.');

  /* A cell can be a primitive, a Date, a rich-text run, or a formula object.
     Only these shapes carry text a person would read; anything else is empty. */
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
      if (o.result !== undefined) return cell(o.result); // a formula: its cached result
      if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('').trim();
      if (o.text !== undefined) return cell(o.text);
    }
    return '';
  };

  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    /* exceljs indexes columns from 1, so slot 0 is always empty. */
    table.push(values.slice(1).map(cell));
  });

  const header = table.shift() ?? [];
  return { header, rows: table.filter((r) => r.some((c) => c !== '')) };
}

/** A workbook begins with the ZIP magic number; a CSV never does. */
export function looksLikeWorkbook(body: Buffer): boolean {
  return body.length > 4 && body[0] === 0x50 && body[1] === 0x4b && (body[2] === 0x03 || body[2] === 0x05);
}

export interface ValidateOptions {
  /** CSV text, or the raw bytes of a workbook. Exactly one is required. */
  text?: string;
  file?: Buffer;
  filename: string;
  careHomeCode: string;
  /** Accepted as an alternative to the code — see the check below. */
  careHomeName?: string;
  organisationId: Types.ObjectId;
  careHomeId: Types.ObjectId;
}

export async function validateImport(options: ValidateOptions): Promise<ImportPreview> {
  const { header, rows } = options.file
    ? await readWorkbook(options.file)
    : parseCsv(options.text ?? '');
  if (header.length === 0) throw ApiError.badRequest('The file is empty.');
  if (rows.length === 0) throw ApiError.badRequest('The file has a header but no data rows.');

  const lower = header.map((h) => h.trim().toLowerCase());
  const canonical = lower.map((h) => COLUMN_ALIASES[h] ?? h);
  const index = new Map<string, number>();
  canonical.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });

  /* Only the three columns a row cannot be placed without are required. The
     others are reported as absent so the manager knows what was not read,
     without the file being refused for lacking a column it never had. */
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  const ignoredColumns = lower.filter(
    (h, i) => !TEMPLATE_COLUMNS.includes(canonical[i] as never) && !(h in COLUMN_ALIASES),
  );

  if (missingColumns.length > 0) {
    throw ApiError.badRequest(
      `This file is missing ${missingColumns.join(', ')}. Download the template for this care home and fill that in.`,
    );
  }

  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const accepted: AcceptedRow[] = [];
  const seen = new Map<string, number>();
  const periods = new Set<string>();

  rows.forEach((cells, n) => {
    const rowNo = n + 2; // header is row 1
    const at = (col: string): string => {
      const i = index.get(col);
      return i === undefined ? '' : (cells[i] ?? '');
    };

    const indicatorId = at('indicator_id').toUpperCase();
    const indicator = INDICATOR_BY_ID.get(indicatorId);
    if (!indicator) {
      errors.push({
        row: rowNo,
        field: 'indicator_id',
        message: `"${indicatorId || 'empty'}" is not in the indicator library. indicator_id is the canonical key, so the row cannot be placed.`,
      });
      return;
    }

    /* The MVP template states the period as "2026-05"; ours states a date
       inside it. Both name the same calendar month. */
    const periodStart = at('reporting_period_start');
    const period = periodStart.slice(0, 7);
    if (!isPeriodId(period)) {
      errors.push({
        row: rowNo,
        field: 'reporting_period_start',
        message: `"${periodStart}" is not a reporting period. Expected a date inside a calendar month, such as 2026-06-01.`,
      });
      return;
    }

    const periodEnd = at('reporting_period_end');
    if (periodEnd && periodEnd.slice(0, 7) !== period) {
      errors.push({
        row: rowNo,
        field: 'reporting_period_end',
        message: `The period starts in ${periodLabel(period)} but ends in a different month. A period must be one reporting month.`,
      });
      return;
    }

    /* The route already established which home this import is for, so this
       column is a cross-check against filing one home's month against
       another — not the authority on where the rows go. The MVP template asks
       for the home's name where ours asks for its code, so either satisfies
       it. */
    const homeRef = at('care_home_id').trim().toUpperCase();
    const expected = [options.careHomeCode, options.careHomeName ?? '']
      .filter(Boolean)
      .map((v) => v.toUpperCase());
    if (homeRef && !expected.includes(homeRef)) {
      errors.push({
        row: rowNo,
        field: 'care_home_id',
        message: `"${at('care_home_id')}" does not match the care home you are importing into (${options.careHomeCode}${options.careHomeName ? ` — ${options.careHomeName}` : ''}).`,
      });
      return;
    }

    const key = `${period}|${indicatorId}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      errors.push({
        row: rowNo,
        field: 'indicator_id',
        message: `Duplicate row — ${indicatorId} already appears for this home and period on row ${previous}.`,
      });
      return;
    }
    seen.set(key, rowNo);
    periods.add(period);

    const rawValue = at('value');
    const rawNumerator = at('numerator');
    const rawDenominator = at('denominator');

    /* An empty value is a real answer: nothing was submitted. */
    if (rawValue === '') {
      warnings.push({
        row: rowNo,
        field: 'value',
        message: `${indicatorId} has no value. It will be recorded as insufficient data for this period, not as zero.`,
      });
      accepted.push({
        indicatorId,
        period,
        value: null,
        numerator: null,
        denominator: null,
        unit: at('unit'),
        sourceSystem: at('source_system'),
        notes: at('notes'),
      });
      return;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      errors.push({ row: rowNo, field: 'value', message: `"${rawValue}" is not a number.` });
      return;
    }
    if (value < 0) {
      errors.push({ row: rowNo, field: 'value', message: `A negative value is not possible for ${indicatorId}.` });
      return;
    }
    if (indicator.unit === '%' && value > 100) {
      errors.push({
        row: rowNo,
        field: 'value',
        message: `${indicatorId} is a percentage, so ${value} is outside the possible range of 0 to 100.`,
      });
      return;
    }
    if (indicator.unit.startsWith('Score') && value > 100) {
      errors.push({
        row: rowNo,
        field: 'value',
        message: `${indicatorId} is scored 0–100, so ${value} is out of range.`,
      });
      return;
    }

    const numerator = rawNumerator === '' ? null : Number(rawNumerator);
    const denominator = rawDenominator === '' ? null : Number(rawDenominator);
    if (numerator !== null && !Number.isFinite(numerator)) {
      errors.push({ row: rowNo, field: 'numerator', message: `"${rawNumerator}" is not a number.` });
      return;
    }
    if (denominator !== null && !Number.isFinite(denominator)) {
      errors.push({ row: rowNo, field: 'denominator', message: `"${rawDenominator}" is not a number.` });
      return;
    }

    /* Whether an indicator has a denominator comes from the dictionary, not
       from looking for a slash in the prose. */
    if (indicator.den && (numerator === null || denominator === null)) {
      warnings.push({
        row: rowNo,
        field: numerator === null ? 'numerator' : 'denominator',
        message: `${indicatorId} is ${indicator.num.toLowerCase()} over ${indicator.den.toLowerCase()}, and one of them is missing. The supplied value is kept, but the calculation cannot be re-derived or checked.`,
      });
    }

    if (indicator.den && numerator !== null && denominator !== null && denominator > 0) {
      const multiplier = indicator.unit.includes('1,000') ? 1000 : indicator.unit === '%' ? 100 : 1;
      const derived = (numerator / denominator) * multiplier;
      /* Tolerance allows for a numerator rounded to whole events: half an event
         is the smallest difference the source data can express. */
      const grain = (0.5 / denominator) * multiplier;
      if (Math.abs(derived - value) > Math.max(grain, Math.abs(value) * 0.03)) {
        warnings.push({
          row: rowNo,
          field: 'value',
          message: `${indicatorId} does not reconcile: ${numerator} ÷ ${denominator} × ${multiplier} = ${derived.toFixed(2)}, but the value column says ${value}.`,
        });
      }
    }

    const unit = at('unit');
    if (unit && unit.toLowerCase() !== indicator.unit.toLowerCase()) {
      warnings.push({
        row: rowNo,
        field: 'unit',
        message: `${indicatorId} is defined as "${indicator.unit}" but the file says "${unit}". The dictionary definition is used.`,
      });
    }

    accepted.push({
      indicatorId,
      period,
      value,
      numerator,
      denominator,
      unit: indicator.unit,
      sourceSystem: at('source_system'),
      notes: at('notes'),
    });
  });

  /* Denominator consistency: the same period must use one occupancy and rota
     source across every indicator that shares a denominator. */
  checkDenominatorConsistency(accepted, warnings);

  const changes = await previewChanges(options, accepted);

  return {
    filename: options.filename,
    rowsRead: rows.length,
    accepted,
    errors,
    warnings,
    missingColumns,
    ignoredColumns,
    periods: [...periods].sort(),
    changes,
  };
}

function checkDenominatorConsistency(accepted: AcceptedRow[], warnings: RowIssue[]): void {
  const residentDayIndicators = ['Q01', 'Q02', 'Q03', 'Q11'];
  const byPeriod = new Map<string, Map<string, number>>();

  for (const row of accepted) {
    if (!residentDayIndicators.includes(row.indicatorId) || row.denominator === null) continue;
    const bucket = byPeriod.get(row.period) ?? new Map<string, number>();
    bucket.set(row.indicatorId, row.denominator);
    byPeriod.set(row.period, bucket);
  }

  for (const [period, bucket] of byPeriod) {
    const values = [...bucket.values()];
    if (values.length < 2) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min > 0.5) {
      warnings.push({
        row: 0,
        field: 'denominator',
        message: `Resident-days differ between indicators in ${periodLabel(period)} (${min} to ${max}). They must come from one occupancy source, otherwise rates are not comparable with each other.`,
      });
    }
  }
}

async function previewChanges(
  options: ValidateOptions,
  accepted: AcceptedRow[],
): Promise<ImportPreview['changes']> {
  if (accepted.length === 0) return [];
  const periods = [...new Set(accepted.map((r) => r.period))];

  const existing = await IndicatorValue.find({
    organisationId: options.organisationId,
    careHomeId: options.careHomeId,
    period: { $in: periods },
    current: true,
  })
    .select('indicatorId period value')
    .lean();

  const stored = new Map(existing.map((r) => [`${r.indicatorId}|${r.period}`, r.value ?? null]));

  return accepted
    .map((row) => {
      const key = `${row.indicatorId}|${row.period}`;
      const has = stored.has(key);
      const before = stored.get(key) ?? null;
      return {
        indicatorId: row.indicatorId,
        period: row.period,
        stored: before,
        incoming: row.value,
        isNew: !has,
      };
    })
    .filter((c) => c.isNew || c.stored !== c.incoming);
}

export interface CommitOptions {
  preview: ImportPreview;
  organisationId: Types.ObjectId;
  careHomeId: Types.ObjectId;
  filename: string;
  userId: Types.ObjectId;
  quarterlyIndicators: string[];
}

/**
 * Commit an import as a new dataset version.
 *
 * The previous values are not deleted. They are marked `current: false` so the
 * history stays readable and any report generated from them can still be
 * reproduced.
 */
export async function commitImport(options: CommitOptions): Promise<{
  datasetId: Types.ObjectId;
  version: number;
  written: number;
}> {
  const { preview } = options;
  if (preview.accepted.length === 0) {
    throw ApiError.badRequest('There is nothing to commit — no row passed validation.');
  }

  const period = preview.periods[0] as string;
  if (preview.periods.length > 1) {
    throw ApiError.badRequest(
      `This file covers ${preview.periods.length} periods. Import one reporting period at a time so each has its own dataset version.`,
    );
  }

  const latest = await Dataset.findOne({
    organisationId: options.organisationId,
    careHomeId: options.careHomeId,
    period,
  })
    .sort({ version: -1 })
    .lean();

  const version = (latest?.version ?? 0) + 1;

  const dataset = await Dataset.create({
    organisationId: options.organisationId,
    careHomeId: options.careHomeId,
    period,
    version,
    source: 'csv',
    filename: options.filename,
    rowsAccepted: preview.accepted.length,
    rowsRejected: preview.errors.length,
    warnings: preview.warnings.length,
    uploadedBy: options.userId,
  });

  if (latest) {
    await Dataset.updateOne({ _id: latest._id }, { $set: { supersededAt: new Date() } });
  }

  /* Retire the values this import replaces, then write the new ones. */
  await IndicatorValue.updateMany(
    {
      organisationId: options.organisationId,
      careHomeId: options.careHomeId,
      period,
      indicatorId: { $in: preview.accepted.map((r) => r.indicatorId) },
      current: true,
    },
    { $set: { current: false } },
  );

  const quarterly = new Set(options.quarterlyIndicators);
  const docs = preview.accepted.map((row) => ({
    organisationId: options.organisationId,
    careHomeId: options.careHomeId,
    datasetId: dataset._id,
    period: row.period,
    indicatorId: row.indicatorId,
    value: row.value,
    numerator: row.numerator,
    denominator: row.denominator,
    state:
      row.value !== null
        ? ('ok' as const)
        : quarterly.has(row.indicatorId) && parsePeriod(row.period).month % 3 !== 0
          ? ('off-cycle' as const)
          : ('not-submitted' as const),
    unit: row.unit,
    sourceSystem: row.sourceSystem,
    notes: row.notes,
    current: true,
  }));

  await IndicatorValue.insertMany(docs);

  return { datasetId: dataset._id, version, written: docs.length };
}

/** The template a home downloads, pre-filled with the indicator library. */
export function templateCsv(careHomeCode: string, period: string): string {
  const { start, end } = parsePeriod(period);
  const lines = [TEMPLATE_COLUMNS.join(',')];
  for (const ind of INDICATOR_BY_ID.values()) {
    lines.push(
      [
        start,
        end,
        careHomeCode,
        ind.id,
        `"${ind.name}"`,
        '',
        '',
        '',
        `"${ind.unit}"`,
        `"${ind.source.split(';')[0]?.trim() ?? ''}"`,
        '',
        '',
        '',
        '',
      ].join(','),
    );
  }
  return lines.join('\n');
}
