/**
 * Seed the database with three demonstration care homes.
 *
 * All data here is SYNTHETIC and deterministic, so every developer and every
 * pilot demonstration sees the same figures. Each home exercises a different
 * behaviour of the engine:
 *
 *   Elmwood House    converging workforce pressure, mixed experience evidence
 *   Ashgrove Court   recovery after an intervention in September 2025
 *   Beechfield Lodge ordinary variation plus real submission gaps
 *
 *   npm run seed          add if absent
 *   npm run seed -- --fresh   drop the collections first
 */

import mongoose from 'mongoose';
import { INDICATORS, isQuarterEnd, lastPeriods, parsePeriod } from '@cgi/core';
import { connectDatabase, disconnectDatabase } from './db.js';
import { hashPassword } from './auth/passwords.js';
import {
  Action,
  AuditLog,
  CalendarEvent,
  CareHome,
  ContextNote,
  Dataset,
  Evidence,
  IndicatorValue,
  Notification,
  Organisation,
  Report,
  Session,
  User,
} from './models/index.js';
import { logger } from './logger.js';

const LATEST_PERIOD = '2026-06';
const MONTHS = 24;

/* ------------------------------------------------------- synthetic shapes */
const SHAPES = {
  flat: () => 0,
  up: (t: number) => t,
  late: (t: number) => Math.pow(Math.max(0, (t - 0.6) / 0.4), 1.5),
  late6: (t: number) => Math.pow(Math.max(0, (t - 0.74) / 0.26), 1.3),
  recover: (t: number) => Math.exp(-Math.pow((t - 0.46) / 0.24, 2)),
  wave: (t: number) => Math.sin(t * Math.PI * 2 - 1.2) * 0.5 + 0.5,
  hump: (t: number) => Math.exp(-Math.pow((t - 0.72) / 0.16, 2)),
} as const;

interface Profile {
  b: number;
  a: number;
  s: keyof typeof SHAPES;
  n: number;
  spike?: [number, number];
  drop?: number[];
  quarterly?: boolean;
}

const PROFILES: Record<string, Record<string, Profile>> = {
  'CH-001': {
    Q01: { b: 13.8, a: 0.9, s: 'late6', n: 1.05 },
    Q02: { b: 2.55, a: -1.05, s: 'up', n: 0.38 },
    Q03: { b: 0.95, a: 0.18, s: 'wave', n: 0.24 },
    Q04: { b: 3.4, a: 2.6, s: 'late', n: 0.3 },
    Q05: { b: 11.5, a: 11.5, s: 'late', n: 1.3 },
    Q06: { b: 1.7, a: 0.35, s: 'late6', n: 0.18 },
    Q07: { b: 5.0, a: -3.0, s: 'up', n: 0.45 },
    Q08: { b: 4.0, a: 6.5, s: 'late', n: 0.7 },
    Q09: { b: 5.0, a: 4.2, s: 'late', n: 0.45 },
    Q10: { b: 1, a: 1.6, s: 'late6', n: 0.35 },
    Q11: { b: 1.85, a: 0.55, s: 'late6', n: 0.26 },
    Q12: { b: 0.6, a: 1.9, s: 'late6', n: 0.3 },
    Q13: { b: 76, a: 4, s: 'up', n: 0.9, quarterly: true },
    Q14: { b: 3.1, a: 0.3, s: 'wave', n: 0.2, spike: [16, 4.6] },
    Q15: { b: 2, a: -1, s: 'up', n: 0.2, quarterly: true },
  },
  'CH-002': {
    Q01: { b: 19.5, a: -5.5, s: 'up', n: 1.25 },
    Q02: { b: 3.6, a: -1.6, s: 'up', n: 0.42 },
    Q03: { b: 1.45, a: -0.55, s: 'up', n: 0.26 },
    Q04: { b: 4.6, a: 2.4, s: 'recover', n: 0.3 },
    Q05: { b: 15.0, a: 12.0, s: 'recover', n: 1.3 },
    Q06: { b: 2.4, a: 1.1, s: 'recover', n: 0.2 },
    Q07: { b: 8.0, a: 4.5, s: 'recover', n: 0.55 },
    Q08: { b: 6.5, a: 8.0, s: 'recover', n: 0.7 },
    Q09: { b: 9.0, a: 5.0, s: 'recover', n: 0.65 },
    Q10: { b: 2, a: 1.4, s: 'recover', n: 0.35 },
    Q11: { b: 2.55, a: 1.1, s: 'recover', n: 0.3 },
    Q12: { b: 1.4, a: 1.2, s: 'recover', n: 0.35 },
    Q13: { b: 69, a: 9, s: 'up', n: 0.9, quarterly: true },
    Q14: { b: 4.4, a: 1.6, s: 'recover', n: 0.26 },
    Q15: { b: 4, a: -2.5, s: 'up', n: 0.25, quarterly: true },
  },
  'CH-003': {
    Q01: { b: 12.4, a: 1.4, s: 'wave', n: 1.15, drop: [7, 8, 15] },
    Q02: { b: 2.1, a: 0.55, s: 'hump', n: 0.36, drop: [7, 8] },
    Q03: { b: 0.85, a: 0.22, s: 'wave', n: 0.25, drop: [7, 8, 15, 21] },
    Q04: { b: 3.9, a: 0.9, s: 'wave', n: 0.28, drop: [8] },
    Q05: { b: 13.0, a: 3.0, s: 'hump', n: 1.1, drop: [8] },
    Q06: { b: 2.0, a: 0.4, s: 'wave', n: 0.2, drop: [8, 20] },
    Q07: { b: 6.5, a: 2.2, s: 'hump', n: 0.6, drop: [8, 9] },
    Q08: { b: 5.5, a: 2.0, s: 'wave', n: 0.55, drop: [8] },
    Q09: { b: 7.0, a: 3.4, s: 'late6', n: 0.6, drop: [8, 14] },
    Q10: { b: 1, a: 1.0, s: 'wave', n: 0.35, drop: [8, 14, 20] },
    Q11: { b: 2.05, a: 0.55, s: 'wave', n: 0.28, drop: [8, 15] },
    Q12: { b: 0.8, a: 0.8, s: 'wave', n: 0.35, drop: [8] },
    Q13: { b: 74, a: 2, s: 'wave', n: 1.0, quarterly: true, drop: [8, 11] },
    Q14: { b: 3.6, a: 1.1, s: 'late6', n: 0.26, drop: [8, 15, 21] },
    Q15: { b: 3, a: 0, s: 'flat', n: 0.3, quarterly: true, drop: [11] },
  },
};

const HOMES = [
  { code: 'CH-001', name: 'Elmwood House', town: 'Sheffield', beds: 48, notes: 'Workforce and governance conditions have tightened since the spring.' },
  { code: 'CH-002', name: 'Ashgrove Court', town: 'Leeds', beds: 62, notes: 'Recovering following a staffing intervention in September 2025.' },
  { code: 'CH-003', name: 'Beechfield Lodge', town: 'Doncaster', beds: 34, notes: 'Submission gaps leave several indicators unreadable for parts of the year.' },
];

/* Seeded PRNG so the same figures appear on every machine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COUNT_DENOMINATORS: Record<string, number> = { Q06: 42, Q07: 460, Q08: 48, Q09: 26, Q14: 310 };

async function seed(fresh: boolean): Promise<void> {
  if (fresh) {
    /* A heterogeneous list of models has no single call signature, so the
       delete is issued through the shared Model interface. */
    const collections: { deleteMany: (filter: Record<string, never>) => unknown }[] = [
      Organisation, CareHome, User, Session, Dataset, IndicatorValue, Action,
      Report, Evidence, ContextNote, CalendarEvent, AuditLog, Notification,
    ];
    await Promise.all(collections.map((m) => m.deleteMany({})));
    logger.info('Cleared existing collections');
  }

  const existing = await Organisation.findOne({ name: 'Northgate Care Group' });
  if (existing && !fresh) {
    logger.info('Already seeded. Use --fresh to rebuild.');
    return;
  }

  const organisation = await Organisation.create({
    name: 'Northgate Care Group',
    reportingCycle: 'Calendar month',
    rules: {},
  });

  const password = await hashPassword('Governance2026!');
  const people = [
    { email: 'owner@northgate.example', first: 'Jo', last: 'Traynor', name: 'J. Traynor', role: 'Organisation Owner' as const, job: 'Provider' },
    { email: 'manager@northgate.example', first: 'Kim', last: 'Whitfield', name: 'K. Whitfield', role: 'Registered Manager' as const, job: 'Registered Manager' },
    { email: 'governance@northgate.example', first: 'Hana', last: 'Bexley', name: 'H. Bexley', role: 'Governance Lead' as const, job: 'Governance Lead' },
    { email: 'quality@northgate.example', first: 'Dev', last: 'Marsh', name: 'D. Marsh', role: 'Quality Lead' as const, job: 'Quality Lead' },
    { email: 'viewer@northgate.example', first: 'Ana', last: 'Reed', name: 'A. Reed', role: 'Viewer' as const, job: 'Board member' },
  ];

  const users = await Promise.all(
    people.map((p) =>
      User.create({
        email: p.email,
        name: p.name,
        firstName: p.first,
        lastName: p.last,
        jobTitle: p.job,
        managerRole: p.role === 'Registered Manager' ? 'Registered Manager' : 'Other',
        passwordHash: password,
        emailVerifiedAt: new Date(),
        /* The seed builds a finished workspace — a profile, an organisation and
           three care homes — so these accounts are past setup. Sending them to
           onboarding would ask them to create what they already have. */
        onboarding: { completed: true, completedAt: new Date(), step: 5 },
        memberships: [{ organisationId: organisation._id, role: p.role, careHomeIds: [] }],
      }),
    ),
  );
  const manager = users[1]!;
  const governance = users[2]!;
  const quality = users[3]!;

  const periods = lastPeriods(LATEST_PERIOD, MONTHS);
  const homes = [];

  for (const spec of HOMES) {
    const profiles = PROFILES[spec.code]!;
    const quarterlyIndicators = Object.entries(profiles)
      .filter(([, p]) => p.quarterly)
      .map(([id]) => id);

    const home = await CareHome.create({
      organisationId: organisation._id,
      code: spec.code,
      name: spec.name,
      town: spec.town,
      beds: spec.beds,
      notes: spec.notes,
      quarterlyIndicators,
    });
    homes.push(home);

    /* One occupancy and rota source per period, shared by every indicator that
       needs a denominator — the source Notes sheet requires exactly this. */
    const denomRnd = mulberry32(seedOf(`${spec.code}den`));
    const denominators = periods.map((period) => {
      const { days } = parsePeriod(period);
      const occupancy = 0.9 + (denomRnd() - 0.5) * 0.07;
      return {
        residentDays: Math.round(spec.beds * occupancy * days),
        scheduledHours: Math.round(spec.beds * 24 * days * 0.42 * (0.97 + denomRnd() * 0.06)),
      };
    });

    const values = [];
    const datasetsByPeriod = new Map<string, mongoose.Types.ObjectId>();

    for (const [index, period] of periods.entries()) {
      let datasetId = datasetsByPeriod.get(period);
      if (!datasetId) {
        const dataset = await Dataset.create({
          organisationId: organisation._id,
          careHomeId: home._id,
          period,
          version: 1,
          source: 'seed',
          filename: `${spec.code}-${period}.csv`,
          rowsAccepted: INDICATORS.length,
          uploadedBy: manager._id,
        });
        datasetId = dataset._id;
        datasetsByPeriod.set(period, datasetId);
      }

      for (const ind of INDICATORS) {
        const profile = profiles[ind.id]!;
        const rnd = mulberry32(seedOf(spec.code + ind.id + index));
        const t = index / (MONTHS - 1);

        const missing = (profile.drop ?? []).includes(index);
        const offCycle = Boolean(profile.quarterly) && !isQuarterEnd(period);

        if (missing || (offCycle && ind.id !== 'Q13')) {
          values.push({
            organisationId: organisation._id,
            careHomeId: home._id,
            datasetId,
            period,
            indicatorId: ind.id,
            value: null,
            state: missing ? ('not-submitted' as const) : ('off-cycle' as const),
            unit: ind.unit,
            current: true,
          });
          continue;
        }

        let value = profile.b + profile.a * SHAPES[profile.s](t) + (rnd() - 0.5) * 2 * profile.n;
        if (profile.spike && profile.spike[0] === index) value += profile.spike[1];
        value = ind.dp === 0 ? Math.max(0, Math.round(value)) : Math.max(0, Number(value.toFixed(ind.dp)));

        /* Q13 is the one documented carry-forward exception: between surveys
           the last score is repeated and flagged stale, never treated as fresh. */
        const stale = offCycle && ind.id === 'Q13';

        const denom = denominators[index]!;
        let numerator: number | null = null;
        let denominator: number | null = null;
        if (ind.unit.includes('1,000')) {
          denominator = denom.residentDays;
          numerator = Math.round((value * denom.residentDays) / 1000);
        } else if (ind.id === 'Q04') {
          denominator = denom.scheduledHours;
          numerator = Math.round((value * denom.scheduledHours) / 100);
        } else if (ind.id === 'Q05') {
          denominator = Math.round(denom.scheduledHours * 0.96);
          numerator = Math.round((value * denominator) / 100);
        } else if (COUNT_DENOMINATORS[ind.id]) {
          denominator = Math.round(COUNT_DENOMINATORS[ind.id]! * (spec.beds / 48));
          numerator = Math.round((value * denominator) / 100);
        }

        values.push({
          organisationId: organisation._id,
          careHomeId: home._id,
          datasetId,
          period,
          indicatorId: ind.id,
          value,
          numerator,
          denominator,
          state: stale ? ('stale' as const) : ('ok' as const),
          unit: ind.unit,
          sourceSystem: ind.source.split(';')[0]?.trim(),
          current: true,
        });
      }
    }

    await IndicatorValue.insertMany(values);
    logger.info({ home: spec.name, values: values.length }, 'Seeded indicator values');
  }

  const elmwood = homes[0]!;
  const ashgrove = homes[1]!;
  const beechfield = homes[2]!;

  await Action.insertMany([
    {
      organisationId: organisation._id,
      careHomeId: elmwood._id,
      reference: 'ACT-001',
      title: 'Review staffing pressure, supervision capacity and rota cover',
      description:
        'Confirm agency and absence figures against the rota system, review supervision scheduling capacity and report back to the governance meeting.',
      signalId: 'SIG-01',
      indicatorIds: ['Q04', 'Q05', 'Q08'],
      priority: 'High',
      assessment: 'Confirmed concern',
      ownerId: manager._id,
      ownerName: manager.name,
      dueDate: '2026-07-15',
      reviewDate: '2026-08-15',
      createdBy: manager._id,
    },
    {
      organisationId: organisation._id,
      careHomeId: elmwood._id,
      reference: 'ACT-002',
      title: 'Theme review of call-bell response complaints',
      description:
        'Pull the last three months of complaints tagged to call-bell response and check whether they concentrate on particular shifts.',
      signalId: 'SIG-03',
      indicatorIds: ['Q11', 'Q12'],
      priority: 'Medium',
      ownerId: quality._id,
      ownerName: quality.name,
      dueDate: '2026-08-01',
      reviewDate: '2026-09-01',
      createdBy: manager._id,
    },
    {
      organisationId: organisation._id,
      careHomeId: ashgrove._id,
      reference: 'ACT-003',
      title: 'Recruitment and agency reduction plan',
      description: 'Recruit to six vacant care posts, re-establish the supervision schedule and reduce agency reliance.',
      signalId: 'SIG-01',
      indicatorIds: ['Q05', 'Q04', 'Q08'],
      priority: 'High',
      assessment: 'Confirmed concern',
      ownerName: 'R. Adeyemi',
      dueDate: '2025-10-31',
      reviewDate: '2026-01-31',
      status: 'Completed',
      closure: 'Resolved',
      outcome:
        'Six posts filled by December 2025. Agency dependence and overdue supervisions have both fallen in the periods since. Indicators improved following the intervention; causality is not established.',
      interventionPeriod: '2025-09',
      completedAt: new Date('2026-01-31'),
      createdBy: governance._id,
    },
    {
      organisationId: organisation._id,
      careHomeId: beechfield._id,
      reference: 'ACT-004',
      title: 'Restore monthly data submission',
      description:
        'Several indicators have no submitted value for multiple periods, which leaves trends unreadable rather than reassuring.',
      indicatorIds: ['Q01', 'Q03', 'Q14'],
      priority: 'High',
      assessment: 'Confirmed concern',
      ownerName: 'S. Okonkwo',
      dueDate: '2026-08-15',
      reviewDate: '2026-09-15',
      createdBy: governance._id,
    },
  ]);

  await ContextNote.insertMany([
    {
      organisationId: organisation._id,
      careHomeId: elmwood._id,
      period: '2026-04',
      indicatorIds: ['Q04'],
      text: 'Two long-term sickness cases from April onwards, both expected to return in September.',
      createdBy: manager._id,
      createdByName: manager.name,
    },
    {
      organisationId: organisation._id,
      careHomeId: ashgrove._id,
      period: '2025-09',
      indicatorIds: ['Q05', 'Q04', 'Q08'],
      text: 'Recruitment and agency reduction plan started in September 2025 (ACT-003).',
      createdByName: 'R. Adeyemi',
      createdBy: governance._id,
    },
  ]);

  await CalendarEvent.insertMany([
    { organisationId: organisation._id, careHomeId: elmwood._id, date: '2026-08-05', title: 'July data submission', kind: 'Data', ownerName: manager.name, recurrence: 'Monthly' },
    { organisationId: organisation._id, careHomeId: elmwood._id, date: '2026-08-21', title: 'Governance meeting — Elmwood House', kind: 'Meeting', ownerName: governance.name, recurrence: 'Monthly' },
    { organisationId: organisation._id, careHomeId: null, date: '2026-09-04', title: 'Q3 quarterly governance review', kind: 'Review', ownerName: governance.name, recurrence: 'Quarterly' },
    { organisationId: organisation._id, careHomeId: null, date: '2026-09-30', title: 'Infection control policy review', kind: 'Policy', ownerName: governance.name, recurrence: 'Annual' },
  ]);

  await Notification.insertMany([
    { organisationId: organisation._id, careHomeId: elmwood._id, kind: 'Missing data', text: 'July 2026 data has not been submitted for Elmwood House.', level: 'watch' },
    { organisationId: organisation._id, careHomeId: elmwood._id, kind: 'Overdue action', text: 'ACT-001 passed its due date on 15 July.', level: 'bad' },
    { organisationId: organisation._id, careHomeId: elmwood._id, kind: 'New signal', text: 'Emerging workforce and governance pressure raised for review.', level: 'bad' },
  ]);

  logger.info(
    {
      organisation: organisation.name,
      homes: homes.length,
      users: users.length,
      signIn: 'manager@northgate.example / Governance2026!',
    },
    'Seed complete',
  );
}

const fresh = process.argv.includes('--fresh');
connectDatabase()
  .then(() => seed(fresh))
  .then(() => disconnectDatabase())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Seed failed');
    process.exit(1);
  });
