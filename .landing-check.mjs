/**
 * Checks that every link on the landing page goes somewhere real, and that a
 * section jumped to from the nav actually clears the fixed header.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = 'http://localhost:5173';
const SHOTS = resolve('samples/landing');
mkdirSync(SHOTS, { recursive: true });

const checks = [];
const expect = (cond, label, detail = '') => checks.push({ pass: Boolean(cond), label, detail });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(WEB, { waitUntil: 'networkidle' });

/* ---- every in-page anchor resolves to an element that exists ---- */
const anchors = await page.$$eval('a[href^="#"]', (els) =>
  els.map((e) => ({ href: e.getAttribute('href'), text: e.textContent.trim().slice(0, 30) })));
const dead = [];
for (const a of anchors) {
  if (a.href === '#') { dead.push(`"${a.text}" -> #`); continue; }
  const found = await page.locator(a.href).count();
  if (found === 0) dead.push(`"${a.text}" -> ${a.href}`);
}
expect(dead.length === 0, `All ${anchors.length} in-page links resolve`, dead.join(' | '));

/* ---- every route link points at a route the app serves ---- */
const ROUTES = ['/sign-in', '/sign-up', '/'];
const routeLinks = await page.$$eval('a[href^="/"]', (els) =>
  [...new Set(els.map((e) => e.getAttribute('href')))]);
const unknown = routeLinks.filter((r) => !ROUTES.includes(r));
expect(unknown.length === 0, `All ${routeLinks.length} route links are real routes`, unknown.join(' | '));

/* ---- the nav actually takes you there, clear of the fixed header ---- */
const navItems = await page.$$eval('.land-nav-desktop a', (els) =>
  els.map((e) => ({ href: e.getAttribute('href'), label: e.textContent.trim() })));
expect(navItems.length > 0, 'Header nav renders', `${navItems.length} items`);

const headerHeight = await page.$eval('.land-header', (e) => e.getBoundingClientRect().height);
for (const item of navItems) {
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.click(`.land-nav-desktop a[href="${item.href}"]`);
  /* Smooth scrolling over a long page takes a while to settle, and the
     reveal animations move content while it does. */
  await page.waitForTimeout(2200);
  const top = await page.locator(item.href).evaluate((e) => e.getBoundingClientRect().top);
  /* The last element on the page cannot reach the top — the document runs
     out first — so there it only has to be visible and clear of the header. */
  const atEnd = await page.evaluate(
    () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2);
  const ceiling = atEnd ? 900 : 260;
  expect(top >= headerHeight - 2 && top < ceiling, `"${item.label}" scrolls clear of the header`,
    `top ${Math.round(top)}px, header ${Math.round(headerHeight)}px${atEnd ? ', page end' : ''}`);
}

/* ---- the trial replaced the demo request everywhere ---- */
await page.goto(WEB, { waitUntil: 'networkidle' });
const body = await page.locator('body').innerText();
expect(!/request a demo/i.test(body), 'No "Request a demo" left on the page');
expect(/30-day free trial/i.test(body), 'The 30-day trial is the call to action');
expect(/pricing/i.test(body) && /nothing to\s+quote yet/i.test(body),
  'Pricing section says pricing is not set rather than inventing one');

/* ---- and it carries through to sign-up ---- */
await page.goto(`${WEB}/sign-up`, { waitUntil: 'networkidle' });
const signup = await page.locator('body').innerText();
expect(/30-day/i.test(signup) && /no card required/i.test(signup),
  'Sign-up repeats the trial terms');
await page.screenshot({ path: resolve(SHOTS, 'sign-up.png') });

/* ---- screenshots of what changed ---- */
await page.goto(WEB, { waitUntil: 'networkidle' });
await page.locator('#pricing').scrollIntoViewIfNeeded();
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(SHOTS, 'pricing.png') });
await page.locator('footer').scrollIntoViewIfNeeded();
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(SHOTS, 'footer.png') });
await page.goto(WEB, { waitUntil: 'networkidle' });
await page.screenshot({ path: resolve(SHOTS, 'header.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });

/* ---- mobile: the page must not scroll sideways ---- */
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
expect(overflow <= 0, 'No horizontal scroll at 390px', `${overflow}px over`);
await page.locator('#pricing').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(SHOTS, 'pricing-mobile.png') });

/* ---- the mobile menu: below 1200px the bar is hidden, so the panel is the
       only way to navigate ---- */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(WEB, { waitUntil: 'networkidle' });
expect(await page.locator('.land-nav-desktop').isVisible() === false, 'Desktop bar is hidden on a phone');
const burger = page.locator('.land-burger');
expect(await burger.isVisible(), 'Menu button is offered instead');
expect(await burger.getAttribute('aria-expanded') === 'false', 'Menu starts closed');
await burger.click();
await page.waitForTimeout(300);
expect(await page.locator('#land-mobile-nav').isVisible(), 'Menu opens');
const mobileLinks = await page.$$eval('#land-mobile-nav a', (els) => els.length);
expect(mobileLinks >= 6, 'Panel carries every nav item plus sign in', `${mobileLinks} links`);
await page.screenshot({ path: resolve(SHOTS, 'menu-mobile.png') });
await page.locator('#land-mobile-nav a[href="#pricing"]').click();
await page.waitForTimeout(2200);
expect(await page.locator('#land-mobile-nav').isVisible() === false, 'Choosing a link closes the menu');
const mobileTop = await page.locator('#pricing').evaluate((e) => e.getBoundingClientRect().top);
expect(mobileTop >= 70 && mobileTop < 260, 'And it navigates there', `top ${Math.round(mobileTop)}px`);
await burger.click();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
expect(await page.locator('#land-mobile-nav').isVisible() === false, 'Escape closes the menu');

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  — ${c.detail}` : ''}`);
console.log(`${checks.length - failed.length}/${checks.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
