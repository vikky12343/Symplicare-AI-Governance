/**
 * The whole product, driven end to end in a browser you can watch.
 *
 *   node .walkthrough.mjs
 *
 * It creates a real account against the real API and the real Atlas database,
 * completes onboarding, uploads the sample workbook, commits it, then visits
 * every page in the rail and checks what each one renders. Nothing is stubbed
 * and nothing is cleaned up afterwards — the account it makes is a usable one.
 *
 * Failures are collected rather than thrown, so one broken page does not hide
 * the state of the rest.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = 'http://localhost:5173';
const SHOTS = resolve(process.env.SHOT_DIR ?? 'samples/walkthrough');
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now().toString(36);
/* A fresh password each run: the account this creates is real, so a fixed one
   committed to the repository would be a live credential. It is printed at the
   end of the run for anyone who wants to sign in and look around. */
const ACCOUNT = {
  name: 'Vikky Kumar',
  email: `vikky.${stamp}@symplicare-demo.co.uk`,
  password: `Sym!${randomBytes(9).toString('base64url')}9`,
};
const HOME = { name: 'Ashgrove Care Home', town: 'Sheffield', postcode: 'S10 2TN', beds: '48', residents: '44' };

const checks = [];
const ok = (label, detail = '') => checks.push({ pass: true, label, detail });
const bad = (label, detail = '') => checks.push({ pass: false, label, detail });
const expect = (cond, label, detail = '') => (cond ? ok(label, detail) : bad(label, detail));

let shot = 0;
async function capture(page, name) {
  shot += 1;
  await page.screenshot({ path: resolve(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`) });
}

const browser = await chromium.launch({ headless: false, slowMo: 300, args: ['--window-position=0,0'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const failedRequests = [];
page.on('response', (r) => {
  /* 401s before sign-in are the session probe doing its job; anything else
     that fails is worth naming. */
  if (r.status() >= 400 && r.status() !== 401) failedRequests.push(`${r.status()} ${r.url()}`);
});

/** The API, called with the browser's own session cookies. */
const apiGet = (path) =>
  page.evaluate((p) => fetch(p, { credentials: 'same-origin' }).then((r) => r.json()), path);

try {
  /* ---------------------------------------------------- 1. the front door */
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await capture(page, 'homepage');
  expect(await page.locator('a[href="/sign-up"]').first().isVisible(), 'Homepage offers a route to sign up');

  /* ------------------------------------------------------- 2. new account */
  await page.goto(`${WEB}/sign-up`, { waitUntil: 'networkidle' });
  await capture(page, 'sign-up');
  await page.fill('input[name="name"]', ACCOUNT.name);
  await page.fill('input[name="email"]', ACCOUNT.email);
  await page.fill('input[name="password"]', ACCOUNT.password);
  await page.fill('input[name="confirmPassword"]', ACCOUNT.password);
  await page.check('input[name="terms"]');
  await capture(page, 'sign-up-filled');
  await page.click('button.cgauth-submit');
  await page.waitForURL(/onboarding/, { timeout: 30000 });
  ok('Account created', ACCOUNT.email);

  /* ------------------------------------------------------- 3. onboarding */
  await page.waitForSelector('input[name="firstName"]');
  await page.fill('input[name="phone"]', '07123 456789');
  await page.fill('input[name="jobTitle"]', 'Registered Manager');
  await capture(page, 'onboarding-profile');
  await page.click('button:has-text("Continue")');

  await page.waitForSelector('input[name="name"]');
  await page.fill('input[name="name"]', 'Symplicare Demo Group');
  await page.fill('input[name="addressLine1"]', '12 Governance Way');
  await page.fill('input[name="town"]', 'Sheffield');
  await page.fill('input[name="postcode"]', 'S1 2AB');
  await capture(page, 'onboarding-organisation');
  await page.click('button:has-text("Continue")');

  await page.waitForSelector('button:has-text("Add another care home"), input[name="postcode"]');
  if (await page.locator('button:has-text("Add another care home")').isVisible().catch(() => false)) {
    await page.click('button:has-text("Add another care home")');
  }
  await page.waitForSelector('input[name="beds"]');
  await page.fill('input[name="name"]', HOME.name);
  await page.fill('input[name="addressLine1"]', '3 Ashgrove Lane');
  await page.fill('input[name="town"]', HOME.town);
  await page.fill('input[name="postcode"]', HOME.postcode);
  await page.fill('input[name="beds"]', HOME.beds);
  await page.fill('input[name="residents"]', HOME.residents);
  await capture(page, 'onboarding-care-home');
  await page.click('button:has-text("Save care home")');
  await page.waitForSelector('button:has-text("Continue"):not([disabled])', { timeout: 20000 });
  await page.click('button:has-text("Continue")');

  await page.waitForSelector('button:has-text("Finish setup")');
  await capture(page, 'onboarding-review');
  await page.click('button:has-text("Finish setup")');
  await page.waitForSelector('button:has-text("Go to dashboard")', { timeout: 30000 });
  ok('Onboarding completed without repeating a step');
  await capture(page, 'onboarding-done');
  await page.click('button:has-text("Go to dashboard")');
  await page.waitForURL(/dashboard/);

  /* ------------------------------------- 4. the empty state, before data */
  await page.waitForLoadState('networkidle');
  await capture(page, 'dashboard-empty');
  const emptyText = await page.locator('body').innerText();
  expect(!/NaN|undefined|Infinity/.test(emptyText), 'Empty dashboard shows no broken numbers');

  /* ----------------------------- 5. the sample sheet, for this real home */
  const homes = await apiGet('/api/care-homes');
  const home = homes.careHomes[0];
  expect(Boolean(home && home.code), 'Care home created with a code', home && home.code);
  execFileSync(process.execPath, ['scripts/make-sample-upload.mjs', '--code', home.code, '--name', home.name], {
    stdio: 'pipe',
  });
  const dir = resolve('samples', home.code);
  const file = (period, ext) => resolve(dir, `${home.code}-${period}.${ext}`);

  /* -------------------------------------------- 6. upload: the .xls refusal */
  await page.goto(`${WEB}/uploads`, { waitUntil: 'networkidle' });
  await capture(page, 'upload-empty');
  const refusal = await page.evaluate(async ({ id }) => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'legacy.xls'));
    const match = document.cookie.match(/(?:^|;\s*)cgi_csrf=([^;]+)/);
    const r = await fetch(`/api/care-homes/${id}/imports/validate`, {
      method: 'POST',
      body: form,
      headers: { 'X-CSRF-Token': match ? match[1] : '' },
      credentials: 'same-origin',
    });
    return { status: r.status, body: await r.text() };
  }, { id: home.id });
  expect(refusal.status === 415 && /Save As/i.test(refusal.body), 'Legacy .xls refused, with the fix named',
    refusal.body.slice(0, 130));

  /* ------------------------------------- 7. twelve months, month by month.
     A file covers one reporting period, so each month is its own upload and
     its own dataset version. The oldest ten arrive as workbooks and the last
     two as CSV, so both readers are exercised against the same data. */
  const months = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
  ];
  let committed = 0;
  for (const period of months) {
    const ext = period === '2026-05' || period === '2026-08' ? 'csv' : 'xlsx';
    await page.goto(`${WEB}/uploads`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type="file"]', file(period, ext));

    /* "rows read" appears only in the validation result, never in the page's
       standing copy — waiting on anything looser passes before the upload. */
    await page.waitForSelector('text=/rows read/i', { timeout: 60000 });
    const preview = await page.locator('body').innerText();
    const read = Number((preview.match(/([\d,]+) rows read/i) || [0, '0'])[1].replace(/,/g, ''));
    const accepted = Number((preview.match(/([\d,]+) accepted/i) || [0, '0'])[1].replace(/,/g, ''));
    if (period === months[0] || period === months.at(-1)) {
      expect(read === 15 && accepted === 15, `${period} (.${ext}): 15 rows read, 15 accepted`,
        `read ${read}, accepted ${accepted}`);
      await capture(page, `upload-${period}-${ext}-preview`);
    } else if (read !== 15 || accepted !== 15) {
      bad(`${period} (.${ext}) validated`, `read ${read}, accepted ${accepted}`);
    }

    await page.locator('button:has-text("Commit")').first().click();
    await page.waitForSelector('text=Committed', { timeout: 60000 });
    committed += 1;
    if (period === months.at(-1)) await capture(page, 'upload-committed');
  }
  expect(committed === 12, 'Twelve monthly submissions committed', `${committed} of 12`);

  /* A second upload of a month already filed is a correction, not a duplicate. */
  await page.goto(`${WEB}/uploads`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type="file"]', file('2026-08', 'xlsx'));
  await page.waitForSelector('text=/rows read/i', { timeout: 60000 });
  const correction = await page.locator('body').innerText();
  expect(/Nothing would change/i.test(correction),
    'Re-uploading the same month shows no change rather than a silent duplicate');
  await capture(page, 'upload-correction');

  /* The month just filed is the month the cockpit should be showing — an
     older selection left over from the first upload would render zeros over a
     year of data. */
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const cockpit = await page.locator('body').innerText();
  /* The subtitle names the month on screen; matching anywhere in the page
     would also match the period picker's list of every month. */
  const shown = (cockpit.match(/Ashgrove Care Home . (\w{3} \d{4})/) || ['', 'none'])[1];
  expect(shown === 'Aug 2026', 'Dashboard follows the newest month filed', shown);
  /* Case-insensitive: the badges are upper-cased in the stylesheet, and
     innerText reports what is rendered. */
  expect(/deteriorating/i.test(cockpit) && /\d+%/.test(cockpit),
    'Cockpit reports governance health and the signals behind it');
  await capture(page, 'dashboard-with-data');

  /* -------------------------------------------- 9. every page in the rail */
  const pages = [
    ['/dashboard', 'Dashboard'],
    ['/signals', 'Signals'],
    ['/indicators', 'Indicators'],
    ['/indicators/Q04', 'Q04 trend'],
    ['/indicators/Q13', 'Q13 trend'],
    ['/compare', 'Compare'],
    ['/quality', 'Data quality'],
    ['/assurance', 'Assurance'],
    ['/actions', 'Actions'],
    ['/reports', 'Reports'],
    ['/evidence', 'Evidence'],
    ['/leading-lagging', 'Leading and lagging'],
    ['/working-defaults', 'Working defaults'],
    ['/build-rules', 'Build rules'],
    ['/care-homes', 'Care homes'],
    ['/profile', 'Profile'],
    ['/settings', 'Settings'],
  ];
  for (const [path, label] of pages) {
    await page.goto(WEB + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await capture(page, `page${path.replace(/\W+/g, '-')}`);
    const text = await page.locator('body').innerText();
    const broken = text.match(/NaN|undefined|\[object Object\]|Infinity/);
    const crashed = /Something went wrong/i.test(text);
    expect(!broken && !crashed, `${label} renders cleanly`, (broken && broken[0]) || (crashed ? 'error boundary' : ''));
  }

  /* ---------------------------------- 10. the numbers, checked against the API */
  const dash = await apiGet(`/api/care-homes/${home.id}/dashboard`);
  const byId = Object.fromEntries(dash.indicators.map((i) => [i.indicator.id, i]));
  expect(dash.period === '2026-08', 'Latest period is the month uploaded', dash.period);
  expect(byId.Q04.value === 8.9, 'Q04 latest value read from the sheet', String(byId.Q04.value));
  expect(byId.Q05.status === 'Deteriorating', 'Q05 agency use flagged deteriorating', byId.Q05.status);
  expect(byId.Q08.status === 'Deteriorating', 'Q08 supervisions flagged deteriorating', byId.Q08.status);
  expect(byId.Q02.status === 'Stable', 'Q02 stays stable — normal variation is not a signal', byId.Q02.status);
  const workforce = dash.signals.find((s) => s.members.some((m) => m.indicator.id === 'Q05'));
  expect(Boolean(workforce), 'Workforce signal raised from converging indicators',
    workforce ? workforce.title : 'none raised');

  /* Baseline is the median of the previous six usable periods — recomputed
     here from the same history the engine was given, not assumed. */
  const q04 = byId.Q04;
  const history = q04.sparkline.map((p) => p.value).filter((v) => v !== null);
  const six = history.slice(-7, -1).slice().sort((a, b) => a - b);
  const median = (six[2] + six[3]) / 2;
  expect(Math.abs(q04.baseline - median) < 0.051, 'Q04 baseline is the median of the previous six',
    `engine ${q04.baseline} vs recomputed ${median}`);
  const changePct = Math.round(((q04.value - q04.baseline) / Math.abs(q04.baseline)) * 1000) / 10;
  expect(Math.abs(q04.changePct - changePct) < 0.11, 'Q04 change % matches the published formula',
    `engine ${q04.changePct} vs recomputed ${changePct}`);
} catch (error) {
  bad('Walkthrough stopped', error instanceof Error ? error.message : String(error));
  await capture(page, 'failure').catch(() => {});
}

/* The console records a generic line per failed request; the response log
   above says which URL, which is the part worth acting on. Deliberate
   rejections in this run (the .xls refusal) are expected. */
const unexpected = failedRequests.filter((r) => !/imports\/validate/.test(r));
expect(unexpected.length === 0, 'No unexpected failed requests', unexpected.slice(0, 4).join(' | '));
const noisy = consoleErrors.filter((e) => !/favicon|ResizeObserver|status of 4/i.test(e));
expect(noisy.length === 0, 'No console errors during the walkthrough', noisy.slice(0, 3).join(' | '));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${'='.repeat(74)}`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  — ${c.detail}` : ''}`);
console.log('='.repeat(74));
console.log(`${checks.length - failed.length}/${checks.length} passed`);
console.log(`account: ${ACCOUNT.email} / ${ACCOUNT.password}`);
console.log(`screenshots: ${SHOTS}`);

await page.waitForTimeout(3000);
await browser.close();
process.exit(failed.length ? 1 : 0);
