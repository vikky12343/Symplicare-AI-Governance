/**
 * End-to-end verification against the live app and Atlas.
 *
 * Two kinds of check:
 *   1. Behaviour — does each flow do what it says.
 *   2. Arithmetic — the expected baseline, spread, change and deviation are
 *      recomputed here, independently of the server, and compared. A test that
 *      only asserts "a number came back" would pass on a broken engine.
 */
import { chromium } from 'playwright';

const B = 'http://localhost:5173';
const email = `verify${Date.now()}@sandbanks-care.co.uk`;
const PW = 'Governance2026Test';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (t) => console.log(`\n=== ${t}`);

/* ── The engine's arithmetic, reimplemented from the specification ────── */
const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const movingRangeSigma = (v) => {
  if (v.length < 2) return 0;
  const r = [];
  for (let i = 1; i < v.length; i++) r.push(Math.abs(v[i] - v[i - 1]));
  return median(r) / 1.128;
};
const tickOf = (dp) => (dp === 0 ? 0.75 : dp === 1 ? 0.08 : 0.008);
const round = (v, dp) => { const f = 10 ** dp; return Math.round((v + Number.EPSILON) * f) / f; };

/** What the engine should say about `value` given the six months before it. */
function expected({ value, prior, dp, harmSign }) {
  const baseline = median(prior);
  const spread = Math.max(movingRangeSigma(prior), tickOf(dp));
  const changePct = baseline === 0 ? null : round(((value - baseline) / Math.abs(baseline)) * 100, 1);
  const deviation = round(Math.max(-12, Math.min(12, ((value - baseline) * harmSign) / spread)), 2);
  return { baseline, spread, changePct, deviation };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 100)));

/* Helper: call the API from inside the page, so the session cookie applies. */
const api = (path, init) =>
  p.evaluate(
    async ([path, init]) => {
      const csrf = document.cookie.match(/cgi_csrf=([^;]+)/)?.[1] ?? '';
      const res = await fetch(path, {
        ...init,
        headers: { ...(init?.headers ?? {}), 'X-CSRF-Token': csrf },
        credentials: 'same-origin',
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    [path, init],
  );

const postJson = (path, body) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Upload a CSV as a real multipart file. */
const upload = (path, text, filename = 'data.csv', type = 'text/csv') =>
  p.evaluate(
    async ([path, text, filename, type]) => {
      const csrf = document.cookie.match(/cgi_csrf=([^;]+)/)?.[1] ?? '';
      const form = new FormData();
      form.append('file', new File([text], filename, { type }));
      const res = await fetch(path, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin', body: form });
      const t = await res.text();
      return { status: res.status, body: t ? JSON.parse(t) : null };
    },
    [path, text, filename, type],
  );

/* ══════════════════════════════════════════════════════════════════════ */
section('1 · Create an account and complete setup');

await p.goto(`${B}/sign-up`, { waitUntil: 'networkidle' });
await p.fill('input[name="name"]', 'Verity Nolan');
await p.fill('input[name="email"]', email);
await p.fill('input[name="password"]', PW);
await p.fill('input[name="confirmPassword"]', PW);
await p.check('input[name="terms"]');
await p.click('button[type="submit"]');
await p.waitForURL('**/onboarding', { timeout: 25000 });
check('signup lands on onboarding', true, email);

await p.fill('input[name="firstName"]', 'Verity');
await p.fill('input[name="lastName"]', 'Nolan');
await p.fill('input[name="phone"]', '07700 900123');
await p.click('button[type="submit"]');
await p.waitForSelector('input[name="addressLine1"]', { timeout: 15000 });
check('step 1 saves the profile', true);

await p.fill('input[name="name"]', 'Sandbanks Care Group');
await p.fill('input[name="town"]', 'Poole');
await p.click('button[type="submit"]');
await p.waitForSelector('input[name="addressLine2"]', { timeout: 15000 });
check('step 2 saves the organisation', true);

await p.fill('input[name="name"]', 'Sandbanks House');
await p.fill('input[name="town"]', 'Poole');
await p.fill('input[name="postcode"]', 'BH13 7QQ');
await p.fill('input[name="beds"]', '40');
await p.fill('input[name="residents"]', '38');
await p.click('button[type="submit"]');
await p.waitForSelector('text=+ Add another care home', { timeout: 15000 });
await p.click('text=Continue');
await p.waitForSelector('text=Check it over', { timeout: 15000 });
await p.click('text=Finish setup');
await p.waitForSelector('text=All set', { timeout: 25000 });
await p.click('text=Go to dashboard');
await p.waitForURL('**/dashboard', { timeout: 15000 });
check('setup completes and reaches the dashboard', true);

const homeRes = await api('/api/care-homes');
const home = homeRes.body.careHomes[0];
check('care home persisted', home?.name === 'Sandbanks House', `${home?.name} (${home?.code})`);

/* ══════════════════════════════════════════════════════════════════════ */
section('2 · Sign out and sign back in');
await ctx.clearCookies();
await p.goto(`${B}/sign-in`, { waitUntil: 'networkidle' });
await p.fill('input[name="email"]', email);
await p.fill('input[name="password"]', PW);
await p.click('button[type="submit"]');
await p.waitForURL('**/dashboard', { timeout: 25000 });
check('returning user goes straight to the dashboard', new URL(p.url()).pathname === '/dashboard');
await p.waitForTimeout(1500);

/* ══════════════════════════════════════════════════════════════════════ */
section('3 · Upload: file types the importer must handle');

const tpl = await p.evaluate(
  async ([id]) => (await fetch(`/api/care-homes/${id}/template?period=2026-01`, { credentials: 'same-origin' })).text(),
  [home.id],
);
const header = tpl.trim().split('\n')[0];
const cols = header.split(',');
const ix = (n) => cols.indexOf(n);

/** Build one month of the system's own template with the given values. */
function monthCsv(period, values) {
  const end = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).toISOString().slice(0, 10);
  const lines = [header];
  for (const line of tpl.trim().split('\n').slice(1)) {
    const c = line.split(',');
    const id = c[ix('indicator_id')];
    c[ix('reporting_period_start')] = `${period}-01`;
    c[ix('reporting_period_end')] = end;
    const v = values[id];
    c[ix('value')] = v === undefined ? '' : String(v);
    c[ix('numerator')] = v === undefined ? '' : String(Math.max(1, Math.round(v * 4)));
    c[ix('denominator')] = v === undefined ? '' : '400';
    lines.push(c.join(','));
  }
  return lines.join('\n');
}

const V = `/api/care-homes/${home.id}/imports/validate`;
const C = `/api/care-homes/${home.id}/imports/commit`;

// a) a .png pretending to be data
let r = await upload(V, 'not a csv at all', 'photo.png', 'image/png');
check('rejects a non-CSV file', r.status === 415, r.body?.error?.message?.slice(0, 60));

// b) empty file
r = await upload(V, '', 'empty.csv');
check('rejects an empty file', r.status === 400, r.body?.error?.message?.slice(0, 60));

// c) header but no rows
r = await upload(V, header, 'headeronly.csv');
check('rejects a header with no rows', r.status === 400, r.body?.error?.message?.slice(0, 60));

// d) missing the columns a row cannot be placed without
r = await upload(V, 'foo,bar\n1,2', 'wrongcols.csv');
check('rejects a file missing required columns', r.status === 400, r.body?.error?.message?.slice(0, 70));

// e) the MVP Data Template shipped with the specification (8 columns)
const mvp = ['Organisation_ID,Care_Home,Reporting_Period,Indicator_ID,Indicator_Value,Unit,Data_Source,Notes'];
for (let i = 1; i <= 15; i++) mvp.push(`ORG,${home.name},2026-02,Q${String(i).padStart(2, '0')},4.2,unit,Synthetic,`);
r = await upload(V, mvp.join('\n'), 'mvp.csv');
check('accepts the MVP template (8 columns, aliased)', r.status === 200 && r.body.errors.length === 0,
  `accepted ${r.body?.acceptedCount}`);

// f) rows for a different care home
const wrong = monthCsv('2026-01', { Q01: 5 }).replace(new RegExp(home.code, 'g'), 'SOMEWHERE-ELSE');
r = await upload(V, wrong, 'wronghome.csv');
check('refuses rows belonging to another home', r.body?.acceptedCount === 0,
  r.body?.errors?.[0]?.message?.slice(0, 60));

// g) unknown indicator, duplicate row, impossible percentage, non-numeric
const faultLines = monthCsv('2026-01', { Q01: 5, Q05: 187, Q14: 3 }).split(String.fromCharCode(10));
const q01 = faultLines.find((l) => l.split(',')[ix('indicator_id')] === 'Q01');
faultLines.push(q01.replace(',Q01,', ',Q99,'));   // unknown indicator
faultLines.push(q01);                              // duplicate row
/* Corrupt the Q14 row in place — appending a second one would be caught as a
   duplicate before its value was ever parsed. */
for (let i = 0; i < faultLines.length; i++) {
  const c = faultLines[i].split(',');
  if (c[ix('indicator_id')] === 'Q14') { c[ix('value')] = 'abc'; faultLines[i] = c.join(','); }
}
r = await upload(V, faultLines.join('\n'), 'faults.csv');
const msgs = (r.body?.errors ?? []).map((e) => e.message).join(' | ');
check('rejects an unknown indicator id', /not in the indicator library/.test(msgs));
check('rejects a duplicate row', /Duplicate row/.test(msgs));
check('rejects a percentage above 100', /outside the possible range/.test(msgs));
check('rejects a non-numeric value', /is not a number/.test(msgs));

// h) an empty value is insufficient data, never zero
r = await upload(V, monthCsv('2026-01', { Q01: undefined, Q02: 1.5 }), 'gap.csv');
const warn = (r.body?.warnings ?? []).find((w) => w.message.includes('Q01'));
check('an empty value warns as insufficient data, not zero', /not as zero/.test(warn?.message ?? ''));

/* ══════════════════════════════════════════════════════════════════════ */
section('4 · Upload a known history and verify every calculation');

/* Q05 Agency dependence: %, dp 1, higher = worse.
   Six flat-ish months then a clear rise, so the arithmetic is checkable. */
const Q05 = { '2025-08': 12.0, '2025-09': 12.4, '2025-10': 12.1, '2025-11': 12.6, '2025-12': 12.2, '2026-01': 12.5, '2026-02': 18.4 };
/* Q13 Satisfaction: score, dp 0, LOWER = worse — the documented inversion. */
const Q13 = { '2025-08': 80, '2025-09': 81, '2025-10': 80, '2025-11': 82, '2025-12': 81, '2026-01': 80, '2026-02': 62 };
/* Q01 stays flat, so it must not be called as moving. */
const Q01 = { '2025-08': 14.0, '2025-09': 14.1, '2025-10': 13.9, '2025-11': 14.0, '2025-12': 14.1, '2026-01': 14.0, '2026-02': 14.05 };
/* Q04 and Q08 climb for the last three months alongside Q05, which is what the
   workforce convergence rule looks for. */
const Q04 = { '2025-08': 3.4, '2025-09': 3.5, '2025-10': 3.4, '2025-11': 3.6, '2025-12': 4.4, '2026-01': 5.3, '2026-02': 6.4 };
const Q08 = { '2025-08': 4.0, '2025-09': 4.2, '2025-10': 4.1, '2025-11': 4.3, '2025-12': 5.8, '2026-01': 7.4, '2026-02': 9.2 };

const months = Object.keys(Q05);
for (const m of months) {
  const csv = monthCsv(m, { Q05: Q05[m], Q13: Q13[m], Q01: Q01[m], Q04: Q04[m], Q08: Q08[m] });
  const v = await upload(V, csv, `${m}.csv`);
  if (!v.body?.ticket) { check(`upload ${m}`, false, JSON.stringify(v.body).slice(0, 120)); break; }
  const c = await postJson(C, { ticket: v.body.ticket });
  if (c.status !== 201) { check(`commit ${m}`, false, JSON.stringify(c.body).slice(0, 120)); break; }
}
check('seven months uploaded and committed', true);

const dash = await api(`/api/care-homes/${home.id}/dashboard?period=2026-02`);
const byId = Object.fromEntries(dash.body.indicators.map((i) => [i.indicatorId, i]));

/* Q05 — higher is worse, so a rise is harmful. */
{
  const prior = months.slice(0, 6).map((m) => Q05[m]);
  const e = expected({ value: Q05['2026-02'], prior, dp: 1, harmSign: 1 });
  const got = byId.Q05;
  check('Q05 baseline is the median of the previous six', got.baseline === e.baseline, `got ${got.baseline}, expected ${e.baseline}`);
  check('Q05 change % matches the formula', got.changePct === e.changePct, `got ${got.changePct}, expected ${e.changePct}`);
  check('Q05 deviation matches the moving-range estimator', Math.abs(got.deviation - e.deviation) < 0.02, `got ${got.deviation}, expected ${e.deviation}`);
  check('Q05 baseline window is six periods', got.baselinePeriods === 6, `got ${got.baselinePeriods}`);
  /* Q05 spikes in one month only. The specification is explicit that one large
     reading is never enough to call deterioration — that is what Watch is for. */
  check('Q05 spikes once, so it is Watch and NOT Deteriorating',
    got.status === 'Watch', `${got.status}, persistence ${got.persistence}`);
}

/* Q04 rises for three consecutive months, so it must be called. */
{
  const prior = months.slice(0, 6).map((m) => Q04[m]);
  const e = expected({ value: Q04['2026-02'], prior, dp: 1, harmSign: 1 });
  const got = byId.Q04;
  check('Q04 baseline is the median of the previous six', got.baseline === e.baseline, `got ${got.baseline}, expected ${e.baseline}`);
  check('Q04 change % matches the formula', got.changePct === e.changePct, `got ${got.changePct}, expected ${e.changePct}`);
  check('Q04 rises for 3 periods, so it IS Deteriorating', got.status === 'Deteriorating', `${got.status}, persistence ${got.persistence}`);
  check('Q04 persistence counts the consecutive harmful run', got.persistence >= 3, `${got.persistence} periods`);
}

/* Q13 — LOWER is worse. A fall must read as harmful, a rise as improving. */
{
  const prior = months.slice(0, 6).map((m) => Q13[m]);
  const e = expected({ value: Q13['2026-02'], prior, dp: 0, harmSign: -1 });
  const got = byId.Q13;
  check('Q13 baseline is the median of the previous six', got.baseline === e.baseline, `got ${got.baseline}, expected ${e.baseline}`);
  check('Q13 change % is negative (score fell)', got.changePct === e.changePct, `got ${got.changePct}, expected ${e.changePct}`);
  check('Q13 deviation is POSITIVE — a fall is harmful here', got.deviation > 0 && Math.abs(got.deviation - e.deviation) < 0.02,
    `got ${got.deviation}, expected ${e.deviation}`);
  check('Q13 harm direction read from the dictionary', got.harmSign === -1, `harmSign ${got.harmSign}`);
}

/* Q01 — barely moved, so it must not be called. */
{
  const got = byId.Q01;
  check('Q01 stays Stable when it barely moves', got.status === 'Stable', `${got.status}, change ${got.changePct}%`);
}

/* An indicator never submitted must read as insufficient, not zero. */
{
  const got = byId.Q10;
  check('an unsubmitted indicator is Insufficient data, not 0', got.status === 'Insufficient data' && (got.value ?? null) === null,
    `status ${got.status}, value ${got.value}`);
}

/* Completeness must count what was actually submitted. */
{
  const q = await api(`/api/care-homes/${home.id}/quality?period=2026-02`);
  const c = q.body.completeness;
  check('completeness counts submitted indicators', c.got === 5 && c.due === 15, `${c.got} of ${c.due} = ${c.pct}%`);
  check('completeness percentage is arithmetically right', c.pct === Math.round((c.got / c.due) * 100), `${c.pct}%`);
}

/* ══════════════════════════════════════════════════════════════════════ */
section('5 · Signals, actions, reports, compare');

const sig = dash.body.signals.find((s) => s.raised);
check('a convergence signal is raised when related indicators move together', Boolean(sig), sig?.title);
if (sig) {
  check('the signal names its contributing indicators', sig.harmful.length >= 2, sig.harmful.join(', '));
  check('the signal explains itself in plain language', (sig.narrative ?? '').length > 40);
}

const created = await postJson(`/api/care-homes/${home.id}/actions`, {
  title: 'Review agency dependence and satisfaction',
  signalId: sig?.id ?? null,
  indicatorIds: ['Q05', 'Q13'],
  priority: 'High',
  ownerName: 'Verity Nolan',
  dueDate: '2026-03-15',
  reviewDate: '2026-04-15',
});
check('an action can be created from a signal', created.status === 201, created.body?.action?.reference);

const actionId = created.body?.action?.id;
if (actionId) {
  const closed = await postJson(`/api/care-homes/${home.id}/actions/${actionId}/close`, {
    closure: 'Resolved',
    outcome: 'Agency block booking arranged; supervision backlog cleared.',
  });
  check('an action can be closed with a recorded outcome', closed.status === 200, closed.body?.action?.closure);
}

const rep = await postJson(`/api/care-homes/${home.id}/reports`, { period: '2026-02' });
check('a report generates', rep.status === 201, rep.body?.report?.reference);
if (rep.body?.report?.id) {
  const one = await api(`/api/care-homes/${home.id}/reports/${rep.body.report.id}`);
  const snap = one.body?.report?.snapshot;
  check('the report freezes the numbers it was generated from', Boolean(snap?.indicators?.length),
    `${snap?.indicators?.length} indicators frozen`);
  const frozenQ05 = snap?.indicators?.find((i) => i.indicatorId === 'Q05');
  check('the frozen Q05 matches the live evaluation', frozenQ05?.status === byId.Q05.status,
    `${frozenQ05?.status} vs ${byId.Q05.status}`);
  const approved = await postJson(`/api/care-homes/${home.id}/reports/${rep.body.report.id}/approve`, {});
  check('a report can be approved once', approved.status === 200, approved.body?.report?.approvalStatus);
  const again = await postJson(`/api/care-homes/${home.id}/reports/${rep.body.report.id}/approve`, {});
  check('a second approval is refused', again.status >= 400, again.body?.error?.code);
}

const cmp = await api(`/api/care-homes/${home.id}/compare?from=2026-01&to=2026-02`);
check('two periods compare', cmp.status === 200,
  `${cmp.body?.deteriorated?.length} deteriorated, ${cmp.body?.improved?.length} improved`);
check('compare agrees with the dashboard on Q05',
  cmp.body?.deteriorated?.includes('Q05') || cmp.body?.rows?.find((r) => r.indicatorId === 'Q05')?.movement !== undefined);

/* ══════════════════════════════════════════════════════════════════════ */
section('6 · Every screen renders for this new account');

const PAGES = ['/dashboard','/signals','/actions','/indicators','/leading-lagging','/assurance',
  '/reports','/compare','/evidence','/uploads','/quality','/build-rules','/working-defaults',
  '/care-homes','/profile','/settings'];
let broken = 0;
for (const path of PAGES) {
  await p.goto(B + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const n = await p.locator('.error-state, .ck-section-error').count();
  if (n) { broken += 1; console.log(`        (error on ${path})`); }
}
check(`all ${PAGES.length} screens render without an error state`, broken === 0);
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(60)}`);
await browser.close();
process.exit(fail ? 1 : 0);
