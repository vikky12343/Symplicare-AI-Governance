import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { INDICATORS } from '@cgi/core';
import { Client, clearDatabase, signUpOrganisation, startDatabase, stopDatabase } from './setup.js';

/**
 * The governance workflow end to end:
 * upload → validate → commit → analyse → signal → action → report → compare.
 */

let app: Express;
let client: Client;
let homeId: string;

const HEADER =
  'reporting_period_start,reporting_period_end,care_home_id,indicator_id,indicator_name,numerator,denominator,value,unit,source_system,data_quality_status,notes,uploaded_by,uploaded_at';

/** A month of data for one home, with agency dependence set by the caller. */
function monthCsv(period: string, agency: number, absence: number, supervisions: number): string {
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year as number, month as number, 0)).getUTCDate();
  const end = `${period}-${String(days).padStart(2, '0')}`;
  const rows = [
    ['Q01', 14.2, 18, 1270, 'Rate per 1,000 resident-days'],
    ['Q02', 1.6, 2, 1270, 'Rate per 1,000 resident-days'],
    ['Q03', 0.9, 1, 1270, 'Rate per 1,000 resident-days'],
    ['Q04', absence, Math.round((absence * 14500) / 100), 14500, '%'],
    ['Q05', agency, Math.round((agency * 13900) / 100), 13900, '%'],
    ['Q06', 1.8, 1, 42, '%'],
    ['Q07', 3.1, 14, 460, '%'],
    ['Q08', supervisions, Math.round((supervisions * 48) / 100), 48, '%'],
    ['Q09', 6.2, 2, 26, '%'],
    ['Q11', 2.1, 3, 1270, 'Rate per 1,000 resident-days'],
    ['Q14', 3.2, 10, 310, '%'],
  ];
  const lines = [HEADER];
  for (const [id, value, numerator, denominator, unit] of rows) {
    lines.push(
      `${period}-01,${end},CH-W1,${id},"Indicator ${id}",${numerator},${denominator},${value},"${unit}",Rota,submitted,,tester,2026-07-01`,
    );
  }
  return lines.join('\n');
}

/** Rewrites the `value` column of one indicator's row, addressed by id. */
function setValue(csv: string, indicatorId: string, value: string): string {
  return csv
    .split('\n')
    .map((line) => {
      const cells = line.split(',');
      if (cells[3] !== indicatorId) return line;
      cells[7] = value;
      return cells.join(',');
    })
    .join('\n');
}

/** The CSV line for one indicator, for tests that duplicate or corrupt a row. */
function lineFor(csv: string, indicatorId: string): string {
  return csv.split('\n').find((l) => l.split(',')[3] === indicatorId) as string;
}

async function upload(period: string, agency: number, absence: number, supervisions: number) {
  const csv = monthCsv(period, agency, absence, supervisions);
  const validate = await client.attach(
    `/api/care-homes/${homeId}/imports/validate`,
    'file',
    Buffer.from(csv),
    `${period}.csv`,
    'text/csv',
  );
  if (validate.status !== 200) throw new Error(JSON.stringify(validate.body));
  const commit = await client.post(`/api/care-homes/${homeId}/imports/commit`, {
    ticket: validate.body.ticket,
  });
  if (commit.status !== 201) throw new Error(JSON.stringify(commit.body));
  return { validate: validate.body, commit: commit.body };
}

beforeAll(async () => {
  await startDatabase();
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  const org = await signUpOrganisation(app, {
    email: 'workflow@example.com',
    organisationName: 'Workflow Care Group',
  });
  client = org.client;
  const created = await client.post('/api/care-homes', {
    code: 'CH-W1',
    name: 'Workflow House',
    town: 'Sheffield',
    beds: 48,
  });
  homeId = created.body.careHome.id;
});

describe('import', () => {
  it('rejects rows for a different care home', async () => {
    const csv = monthCsv('2026-01', 12, 3.4, 4.0).replace(/CH-W1/g, 'CH-OTHER');
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'wrong-home.csv',
      'text/csv',
    );
    expect(res.status).toBe(200);
    expect(res.body.acceptedCount).toBe(0);
    expect(res.body.errors[0].message).toMatch(/does not match the care home/);
  });

  it('rejects an unknown indicator id, a duplicate and an impossible percentage', async () => {
    const base = setValue(monthCsv('2026-01', 12, 3.4, 4.0), 'Q05', '187'); // out of range
    const lines = base.split('\n');
    lines.push(lineFor(base, 'Q01').replace(',Q01,', ',Q99,')); // unknown indicator
    lines.push(lineFor(base, 'Q01')); // duplicate row
    const csv = lines.join('\n');

    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'faults.csv',
      'text/csv',
    );

    const messages = res.body.errors.map((e: { message: string }) => e.message).join(' ');
    expect(messages).toMatch(/not in the indicator library/);
    expect(messages).toMatch(/Duplicate row/);
    expect(messages).toMatch(/outside the possible range/);
  });

  /* The specification shipped a data template to pilot homes before this
     service generated its own. A home that fills in the sheet it was handed
     has to be able to upload it. */
  it('accepts the MVP Data Template shipped with the specification', async () => {
    const header = 'Organisation_ID,Care_Home,Reporting_Period,Indicator_ID,Indicator_Value,Unit,Data_Source,Notes';
    const rows = INDICATORS.map(
      (ind, i) => `DEMO01,Workflow House,2026-03,${ind.id},${(4 + i).toFixed(1)},"${ind.unit}",Synthetic,`,
    );
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from([header, ...rows].join('\n')),
      'mvp-template.csv',
      'text/csv',
    );

    expect(res.status).toBe(200);
    expect(res.body.missingColumns).toEqual([]);
    expect(res.body.errors).toEqual([]);
    expect(res.body.acceptedCount).toBe(INDICATORS.length);
  });

  /* Homes keep this data in Excel. Asking them to export a CSV first is an
     extra step that fails in the usual ways, so a workbook uploads directly —
     including a cell whose value is a formula, and a date-typed period. */
  it('reads an .xlsx workbook, its formulas and its date cells', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Care_Home', 'Reporting_Period', 'Indicator_ID', 'Indicator_Value']);
    sheet.addRow(['CH-W1', new Date(Date.UTC(2026, 3, 1)), 'Q01', 4.2]);
    sheet.addRow(['CH-W1', '2026-04', 'Q02', { formula: 'ROUND(3.14159,2)', result: 3.14 }]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());

    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      bytes,
      'april.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.acceptedCount).toBe(2);
    expect(res.body.periods).toEqual(['2026-04']);
    /* The formula contributes its cached result, which is what the person
       looking at the sheet sees. */
    const q02 = res.body.changes.find((c: { indicatorId: string }) => c.indicatorId === 'Q02');
    expect(q02.incoming).toBe(3.14);
  });

  it('turns away the 1997 .xls format with the fix, not just a refusal', async () => {
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from('anything'),
      'legacy.xls',
      'application/vnd.ms-excel',
    );
    expect(res.status).toBe(415);
    expect(res.body.error.message).toMatch(/Save As/i);
  });

  it('names the care home by its code or its name, and refuses another home either way', async () => {
    const header = 'Care_Home,Reporting_Period,Indicator_ID,Indicator_Value';
    const byCode = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from([header, 'CH-W1,2026-03,Q01,4.2'].join('\n')),
      'by-code.csv',
      'text/csv',
    );
    expect(byCode.body.errors).toEqual([]);

    const elsewhere = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from([header, 'Somewhere Else,2026-03,Q01,4.2'].join('\n')),
      'other-home.csv',
      'text/csv',
    );
    expect(elsewhere.body.acceptedCount).toBe(0);
    expect(elsewhere.body.errors[0].message).toMatch(/does not match the care home/);
  });

  it('records an empty value as insufficient data, never as zero', async () => {
    const csv = setValue(monthCsv('2026-01', 12, 3.4, 4.0), 'Q01', '');
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'empty.csv',
      'text/csv',
    );
    const warning = res.body.warnings.find((w: { message: string }) => w.message.includes('Q01'));
    expect(warning.message).toMatch(/not as zero/);

    await client.post(`/api/care-homes/${homeId}/imports/commit`, { ticket: res.body.ticket });
    const quality = await client.get(`/api/care-homes/${homeId}/quality?period=2026-01`);
    expect(quality.body.completeness.missing).toContain('Q01');
  });

  it('warns when a value does not reconcile with its own numerator and denominator', async () => {
    /* Q04's numerator and denominator stay put while its value is restated, so
       the row no longer agrees with its own arithmetic. */
    const csv = setValue(monthCsv('2026-01', 12, 3.4, 4.0), 'Q04', '9.9');
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'reconcile.csv',
      'text/csv',
    );
    const messages = res.body.warnings.map((w: { message: string }) => w.message).join(' ');
    expect(messages).toMatch(/does not reconcile/);
  });

  it('shows what would change before anything is written', async () => {
    await upload('2026-01', 12, 3.4, 4.0);

    const csv = monthCsv('2026-01', 19, 3.4, 4.0);
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'revised.csv',
      'text/csv',
    );
    const change = res.body.changes.find((c: { indicatorId: string }) => c.indicatorId === 'Q05');
    expect(change.stored).toBe(12);
    expect(change.incoming).toBe(19);
  });

  it('versions each commit and supersedes the previous one', async () => {
    await upload('2026-01', 12, 3.4, 4.0);
    const second = await upload('2026-01', 13, 3.5, 4.2);
    expect(second.commit.version).toBe(2);

    const datasets = await client.get(`/api/care-homes/${homeId}/datasets`);
    const forPeriod = datasets.body.datasets.filter((d: { period: string }) => d.period === '2026-01');
    expect(forPeriod).toHaveLength(2);
    expect(forPeriod.find((d: { version: number }) => d.version === 1).superseded).toBe(true);
  });

  it('refuses a commit ticket that has already been used', async () => {
    const csv = monthCsv('2026-01', 12, 3.4, 4.0);
    const validate = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from(csv),
      'once.csv',
      'text/csv',
    );
    await client.post(`/api/care-homes/${homeId}/imports/commit`, { ticket: validate.body.ticket });
    const second = await client.post(`/api/care-homes/${homeId}/imports/commit`, {
      ticket: validate.body.ticket,
    });
    expect(second.status).toBe(400);
  });
});

describe('analysis', () => {
  /** Eight months, with agency dependence climbing through the last four. */
  async function buildHistory() {
    const months = [
      ['2025-11', 11.5, 3.4, 4.0],
      ['2025-12', 12.1, 3.6, 4.3],
      ['2026-01', 12.8, 3.5, 4.6],
      ['2026-02', 15.2, 4.1, 5.6],
      ['2026-03', 18.4, 4.6, 7.0],
      ['2026-04', 20.9, 5.1, 8.4],
      ['2026-05', 22.6, 5.5, 9.6],
      ['2026-06', 24.2, 5.9, 10.6],
    ] as const;
    for (const [period, agency, absence, supervisions] of months) {
      await upload(period, agency, absence, supervisions);
    }
  }

  it('computes statuses from the home’s own history', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/dashboard?period=2026-06`);
    expect(res.status).toBe(200);

    const q05 = res.body.indicators.find((i: { indicatorId: string }) => i.indicatorId === 'Q05');
    expect(q05.status).toBe('Deteriorating');
    expect(q05.baseline).toBeGreaterThan(0);
    expect(q05.why).toMatch(/against its own recent baseline/);
    expect(q05.reasons.length).toBeGreaterThan(1);
  });

  it('raises the workforce pattern and names its evidence', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/dashboard?period=2026-06`);
    const signal = res.body.signals.find((s: { id: string }) => s.id === 'SIG-01');
    expect(signal.raised).toBe(true);
    expect(signal.harmful).toEqual(expect.arrayContaining(['Q04', 'Q05', 'Q08']));
    expect(signal.firstRaisedPeriod).toBeTruthy();
  });

  /* A month before the home's first submission is not a gap in its record —
     it is a month the home was not asked about. Counting those told every home
     in its first two years that all fifteen indicators had repeated gaps. */
  it('does not report gaps for months before the home started reporting', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/quality?period=2026-06`);
    expect(res.status).toBe(200);

    /* Indicators the fixture never submits are genuinely missing, and should
       still be reported — but only for months from the first submission on. */
    const gapText = (res.body.issues as { text: string }[]).map((i) => i.text).join(' ');
    for (const before of ['Sep 24', 'Oct 24', 'Dec 24', 'Aug 25', 'Sep 25', 'Oct 25']) {
      expect(gapText).not.toContain(before);
    }

    /* Q01 is submitted every month of the fixture, so it has no gap at all. */
    const q01 = (res.body.issues as { indicatorId?: string; level: string }[]).filter(
      (i) => i.indicatorId === 'Q01' && i.level === 'bad',
    );
    expect(q01).toEqual([]);

    /* The window itself starts at the first submitted month, not 24 back. */
    const trend = res.body.trend as { period: string }[];
    expect(trend[0]?.period).toBe('2025-11');
  });

  it('reports insufficient data rather than guessing early on', async () => {
    await upload('2026-05', 12, 3.4, 4.0);
    await upload('2026-06', 13, 3.5, 4.2);
    const res = await client.get(`/api/care-homes/${homeId}/dashboard?period=2026-06`);
    const q05 = res.body.indicators.find((i: { indicatorId: string }) => i.indicatorId === 'Q05');
    expect(q05.status).toBe('Insufficient data');
    expect(q05.why).toMatch(/baseline needs at least/);
  });

  it('serves an indicator’s full history with its baseline corridor', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/indicators/Q05?period=2026-06`);
    expect(res.status).toBe(200);
    expect(res.body.indicator.id).toBe('Q05');
    expect(res.body.readings.length).toBeGreaterThan(0);
    expect(res.body.corridor.some((c: unknown) => c !== null)).toBe(true);
    expect(res.body.comparisons.rolling3).toBeGreaterThan(0);
  });

  it('compares two periods and separates movement from variation', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/compare?from=2026-01&to=2026-06`);
    expect(res.status).toBe(200);
    expect(res.body.deteriorated).toEqual(expect.arrayContaining(['Q05', 'Q08']));
    expect(res.body.stable.length).toBeGreaterThan(0);
  });

  it('maps indicators to the five key questions', async () => {
    await buildHistory();
    const res = await client.get(`/api/care-homes/${homeId}/assurance?period=2026-06`);
    expect(res.body.areas).toHaveLength(5);
    expect(res.body.areas.find((a: { keyQuestion: string }) => a.keyQuestion === 'Well-led').state).toBe(
      'Deteriorating',
    );
  });

  it('rejects a malformed period rather than guessing', async () => {
    const res = await client.get(`/api/care-homes/${homeId}/dashboard?period=June`);
    expect(res.status).toBe(400);
  });
});

describe('actions', () => {
  it('runs the full lifecycle and keeps the closure reason', async () => {
    const created = await client.post(`/api/care-homes/${homeId}/actions`, {
      title: 'Review staffing pressure and supervision capacity',
      description: 'Confirm agency and absence against the rota system.',
      signalId: 'SIG-01',
      indicatorIds: ['Q04', 'Q05', 'Q08'],
      priority: 'High',
      assessment: 'Confirmed concern',
      dueDate: '2026-07-15',
      reviewDate: '2026-08-15',
    });
    expect(created.status).toBe(201);
    expect(created.body.action.reference).toMatch(/^ACT-\d{3}$/);

    const id = created.body.action.id;
    const closed = await client.post(`/api/care-homes/${homeId}/actions/${id}/close`, {
      closure: 'False positive',
      outcome: 'Explained by two long-term sickness cases already known to the management team.',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.action.status).toBe('Completed');
    expect(closed.body.action.closure).toBe('False positive');

    /* A closed action is not editable — the record stands as it was. */
    const edit = await client.patch(`/api/care-homes/${homeId}/actions/${id}`, { priority: 'Low' });
    expect(edit.status).toBe(409);
  });

  it('refuses a review date before the due date', async () => {
    const res = await client.post(`/api/care-homes/${homeId}/actions`, {
      title: 'Backwards dates',
      dueDate: '2026-08-15',
      reviewDate: '2026-07-15',
    });
    expect(res.status).toBe(400);
  });

  it('marks an action overdue against today', async () => {
    await client.post(`/api/care-homes/${homeId}/actions`, {
      title: 'Long past due',
      dueDate: '2020-01-01',
      reviewDate: '2020-02-01',
    });
    const list = await client.get(`/api/care-homes/${homeId}/actions`);
    expect(list.body.actions[0].overdue).toBe(true);
  });
});

describe('reports', () => {
  it('freezes the numbers it was generated from', async () => {
    for (const [period, agency] of [
      ['2025-11', 11.5], ['2025-12', 12.1], ['2026-01', 12.8], ['2026-02', 15.2],
      ['2026-03', 18.4], ['2026-04', 20.9], ['2026-05', 22.6], ['2026-06', 24.2],
    ] as const) {
      await upload(period, agency, 4.0, 5.0);
    }

    const generated = await client.post(`/api/care-homes/${homeId}/reports`, {
      period: '2026-06',
      commentary: 'Agency cover held safe staffing while two vacancies were recruited to.',
    });
    expect(generated.status).toBe(201);
    const report = generated.body.report;
    expect(report.version).toBe(1);

    const frozenQ05 = report.snapshot.indicators.find((i: { indicatorId: string }) => i.indicatorId === 'Q05');
    expect(frozenQ05.value).toBe(24.2);

    /* Restate the month, then confirm the stored report has not moved. */
    await upload('2026-06', 9.0, 4.0, 5.0);
    const fetched = await client.get(`/api/care-homes/${homeId}/reports/${report.id}`);
    const stillFrozen = fetched.body.report.snapshot.indicators.find(
      (i: { indicatorId: string }) => i.indicatorId === 'Q05',
    );
    expect(stillFrozen.value).toBe(24.2);

    /* A fresh report reflects the restatement, and supersedes rather than
       overwrites the earlier version. */
    const second = await client.post(`/api/care-homes/${homeId}/reports`, { period: '2026-06' });
    expect(second.body.report.version).toBe(2);

    const history = await client.get(`/api/care-homes/${homeId}/reports`);
    const versions = history.body.reports.filter((r: { period: string }) => r.period === '2026-06');
    expect(versions).toHaveLength(2);
  });

  it('records the thresholds in force, so it can be reproduced', async () => {
    await upload('2026-06', 12, 3.4, 4.0);
    const generated = await client.post(`/api/care-homes/${homeId}/reports`, { period: '2026-06' });
    expect(generated.body.report.rules.baselineWindow).toBeGreaterThan(0);
    expect(generated.body.report.rules.bandSigma).toBeGreaterThan(0);
  });

  it('approves once and refuses a second approval', async () => {
    await upload('2026-06', 12, 3.4, 4.0);
    const generated = await client.post(`/api/care-homes/${homeId}/reports`, { period: '2026-06' });
    const id = generated.body.report.id;

    const first = await client.post(`/api/care-homes/${homeId}/reports/${id}/approve`);
    expect(first.status).toBe(200);
    expect(first.body.report.approvalStatus).toBe('Approved');

    const second = await client.post(`/api/care-homes/${homeId}/reports/${id}/approve`);
    expect(second.status).toBe(409);
  });
});

describe('rule configuration', () => {
  it('changes statuses when thresholds change, and normalises nonsense', async () => {
    for (const [period, agency] of [
      ['2025-11', 11.5], ['2025-12', 12.1], ['2026-01', 12.8], ['2026-02', 13.6],
      ['2026-03', 14.1], ['2026-04', 14.9], ['2026-05', 15.4], ['2026-06', 16.2],
    ] as const) {
      await upload(period, agency, 4.0, 5.0);
    }

    const before = await client.get(`/api/care-homes/${homeId}/dashboard?period=2026-06`);
    const beforeStatus = before.body.indicators.find(
      (i: { indicatorId: string }) => i.indicatorId === 'Q05',
    ).status;

    const updated = await client.patch('/api/admin/organisation/rules', {
      bandSigma: 99,
      materialPct: 90,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.rules.bandSigma).toBeLessThanOrEqual(6);

    const after = await client.get(`/api/care-homes/${homeId}/dashboard?period=2026-06`);
    const afterStatus = after.body.indicators.find(
      (i: { indicatorId: string }) => i.indicatorId === 'Q05',
    ).status;

    expect(afterStatus).toBe('Stable');
    expect(afterStatus).not.toBe(beforeStatus);
  });
});

describe('the indicator dictionary', () => {
  it('is served verbatim, with the mapping version', async () => {
    const res = await client.get('/api/indicators');
    expect(res.body.indicators).toHaveLength(15);

    const q13 = res.body.indicators.find((i: { id: string }) => i.id === 'Q13');
    expect(q13.harm).toBe('Lower = worse');
    expect(q13.missing).toMatch(/carry forward the last available score/);
    expect(res.body.mappingVersion).toBeTruthy();
  });
});
