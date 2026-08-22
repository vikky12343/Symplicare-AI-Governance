import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../components/brand.js';
import '../styles/landing.css';

/* ── Scroll-animation hook ────────────────────────────────────── */
function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      ref.current?.classList.add('visible'); return;
    }
    const io = new IntersectionObserver(
      ([e]) => { if (e?.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } },
      { threshold: 0.07, rootMargin: '0px 0px -40px 0px' }
    );
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ── Icon helper ──────────────────────────────────────────────── */
function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-active');
    return () => document.body.classList.remove('landing-active');
  }, []);

  return (
    <main className="landing-page">
      <SiteHeader />
      <Hero />
      <ChallengesSection />
      <SolutionSection />
      <LogosSection />
      <HowItWorksSection />
      <CtaSection />
      <SiteFooter />
    </main>
  );
}

/* ── Header ──────────────────────────────────────────────────── */
const NAV: { label: string; href: string; menu?: boolean }[] = [
  { label: 'Product', href: '#product', menu: true },
  { label: 'Solutions', href: '#solutions', menu: true },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Resources', href: '#resources', menu: true },
  { label: 'Company', href: '#company', menu: true },
  { label: 'Pricing', href: '#pricing' },
];

function SiteHeader() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const fn = () => ref.current?.classList.toggle('scrolled', window.scrollY > 10);
    window.addEventListener('scroll', fn, { passive: true });
    fn();
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <header ref={ref} className="land-header" role="banner">
      <BrandMark size={34} stacked />
      <nav className="land-nav-desktop" aria-label="Primary">
        {NAV.map((n) => (
          <a key={n.label} href={n.href}>
            {n.label}
            {n.menu ? (
              <span className="land-nav-caret" aria-hidden="true">
                <Icon size={11}><polyline points="6 9 12 15 18 9" /></Icon>
              </span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="land-header-actions">
        <Link to="/sign-in" className="land-signin-link">Sign in</Link>
        <Link to="/sign-up" className="land-btn land-btn-primary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>
          Request a demo
        </Link>
      </div>
    </header>
  );
}

/* ── Hero ─────────────────────────────────────────────────────── */
const HERO_TRUST = [
  { title: 'Built for care', desc: 'Designed for UK care providers', icon: <Icon><path d="M12 21s7.5-3.6 7.5-9.2V5.4L12 2.6 4.5 5.4v6.4C4.5 17.4 12 21 12 21z" /></Icon> },
  { title: 'Secure & private', desc: 'Your data is encrypted and protected', icon: <Icon><rect x="4" y="10.5" width="16" height="10.5" rx="2.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></Icon> },
  { title: 'CQC aligned', desc: 'Support CQC-ready governance', icon: <Icon><polyline points="9 12 11.5 14.5 16 9" /><rect x="3.5" y="3.5" width="17" height="17" rx="3" /></Icon> },
  { title: 'Trusted by leaders', desc: 'Used by care teams across the UK', icon: <Icon><path d="M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 18.4V20" /><circle cx="9.5" cy="8" r="3.4" /><path d="M21 20v-1.6a3.4 3.4 0 0 0-2.6-3.3" /><path d="M15 4.7a3.4 3.4 0 0 1 0 6.6" /></Icon> },
];

function Hero() {
  return (
    <section className="land-hero" aria-label="Hero">
      <div className="land-hero-bg" aria-hidden="true">
        <img
          src="/images/gallery/22_care_manager_resident_indoor.jpg"
          alt=""
          width="780" height="680"
          fetchPriority="high"
          loading="eager"
        />
      </div>

      <div className="land-container land-hero-grid">
        <div>
          <div className="land-eyebrow land-fade-up visible">Intelligence for UK Care Homes</div>
          <h1 className="land-heading land-hero-title land-fade-up visible">
            Turn care home data<br />
            into <span className="land-text-teal">better decisions.</span>
          </h1>
          <p className="land-hero-body land-fade-up visible land-d1">
            Symplicare AI helps you see what&rsquo;s changing, understand why it matters,
            and take action with confidence. All your data. One connected view.
          </p>
          <div className="land-hero-actions land-fade-up visible land-d2">
            <Link to="/sign-up" className="land-btn land-btn-primary">Request a demo</Link>
            <a href="#how-it-works" className="land-btn land-btn-secondary">
              <Icon size={15}><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></Icon>
              See how it works
            </a>
          </div>
        </div>

        <div className="land-fade-up visible land-d3">
          <DashboardCard />
        </div>
      </div>

      <div className="land-container">
        <div className="land-hero-trust land-fade-up visible land-d4">
          {HERO_TRUST.map((t) => (
            <div key={t.title} className="land-hero-trust-item">
              <span className="land-trust-icon">{t.icon}</span>
              <span>
                <span className="land-trust-title">{t.title}</span>
                <span className="land-trust-desc">{t.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const HERO_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
const HERO_POINTS = [46, 40, 34, 30, 24, 22, 17, 12, 10, 6];

function DashboardCard() {
  const step = 340 / (HERO_POINTS.length - 1);
  const line = HERO_POINTS.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y}`).join(' ');

  return (
    <div className="land-dash-card">
      <div className="land-dash-head">
        <span className="land-dash-label">Governance Health</span>
        <span className="land-dash-chip">All care homes ▾</span>
      </div>

      <div className="land-dash-body">
        <div>
          <div className="land-dash-score">
            <span className="land-dash-score-num">82</span>
            <span className="land-dash-score-den">/100</span>
          </div>
          <div className="land-dash-delta">↑ 12 vs last month</div>
        </div>

        <svg className="land-dash-chart" viewBox="0 0 360 60" preserveAspectRatio="none" role="img" aria-label="Governance health rising from March to August">
          <defs>
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#18B6AE" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#18B6AE" stopOpacity="0" />
            </linearGradient>
          </defs>
          <text x="0" y="8" className="land-dash-axis">100</text>
          <text x="0" y="30" className="land-dash-axis">50</text>
          <path d={`${line} L340,60 L0,60 Z`} fill="url(#heroFill)" />
          <path d={line} fill="none" stroke="#18B6AE" strokeWidth="1.6" />
          {HERO_POINTS.map((y, i) => (
            <circle key={i} cx={(i * step).toFixed(1)} cy={y} r="2.2" fill="#35D4C8" />
          ))}
        </svg>
      </div>

      <div className="land-dash-months" aria-hidden="true">
        {HERO_MONTHS.map((m) => <span key={m}>{m}</span>)}
      </div>

      <div className="land-dash-metric-grid">
        {[
          { l: 'Open signals', v: '23', s: '↑ 5 this week', tone: 'teal' },
          { l: 'Critical signals', v: '4', s: 'No change', tone: 'danger' },
          { l: 'Open actions', v: '12', s: '↑ 3 this month', tone: 'teal' },
          { l: 'Reports this month', v: '8', s: 'Published', tone: 'teal' },
        ].map((m) => (
          <div key={m.l} className="land-dash-metric">
            <div className="land-dash-metric-label">{m.l}</div>
            <div className={`land-dash-metric-value ${m.tone}`}>{m.v}</div>
            <div className="land-dash-metric-sub">{m.s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Challenges ──────────────────────────────────────────────── */
const CHALLENGES = [
  {
    title: 'Scattered data',
    img: '/images/gallery/09_files_and_binders.jpg',
    icon: <Icon size={15}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /></Icon>,
    points: ['Information in multiple files and systems', 'Hard to get a single accurate view'],
  },
  {
    title: 'Manual and time consuming',
    img: '/images/gallery/03_manager_stressed.jpg',
    icon: <Icon size={15}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Icon>,
    points: ['Too much time spent on reports and admin', 'Less time for residents and the team'],
  },
  {
    title: 'Hard to spot risks early',
    img: '/images/gallery/07_reports_and_analytics.jpg',
    icon: <Icon size={15}><path d="M10.6 3.6 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2A1.6 1.6 0 0 0 21.5 18L13.4 3.6a1.6 1.6 0 0 0-2.8 0z" /><path d="M12 9v4M12 17h.01" /></Icon>,
    points: ['Issues only surface after they escalate', 'Missed trends and warning signs'],
  },
  {
    title: 'Evidence hard to find',
    img: '/images/gallery/11_cluttered_workspace.jpg',
    icon: <Icon size={15}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></Icon>,
    points: ['Documents stored in different places', 'Difficult during audits and inspections'],
  },
  {
    title: "Actions don't get tracked",
    img: '/images/gallery/18_too_much_administration.jpg',
    icon: <Icon size={15}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Icon>,
    points: ['Follow ups are missed', 'No clear accountability or ownership'],
  },
  {
    title: 'Reports hard to compare',
    img: '/images/gallery/24_manager_administrative_overload.jpg',
    icon: <Icon size={15}><path d="M5 20V10M12 20V4M19 20v-7" /></Icon>,
    points: ["Can't compare periods with confidence", 'No clear view of improvement'],
  },
];

function ChallengesSection() {
  const ref = useInView();
  return (
    <section className="land-section" aria-labelledby="challenges-heading" id="product">
      <div className="land-container">
        <div ref={ref} className="land-fade-up land-section-header centered">
          <h2 id="challenges-heading" className="land-section-title">
            The <span className="land-text-teal">challenges</span> care home managers face every day
          </h2>
        </div>

        <div className="land-cards-grid">
          {CHALLENGES.map((c) => (
            <article key={c.title} className="land-card">
              <div className="land-card-img">
                <img src={c.img} alt="" width="420" height="236" loading="lazy" />
                <span className="land-card-badge">{c.icon}</span>
              </div>
              <div className="land-card-body">
                <h3 className="land-card-title">{c.title}</h3>
                <ul className="land-card-bullets">
                  {c.points.map((p) => (
                    <li key={p}>
                      <Icon size={13}><polyline points="20 6 9 17 4 12" /></Icon>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Solution / product mockup ───────────────────────────────── */
const SOLUTION_FEATURES = [
  { title: 'Upload any data', desc: 'Excel, CSV, PDF and more', icon: <Icon size={16}><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></Icon> },
  { title: 'Track actions', desc: 'Assign, monitor and review', icon: <Icon size={16}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Icon> },
  { title: 'AI-powered insights', desc: 'Spot trends and risks early', icon: <Icon size={16}><path d="M3 17l5-6 4 3.5L21 6" /><path d="M16 6h5v5" /></Icon> },
  { title: 'Generate reports', desc: 'CQC-ready and audit-safe', icon: <Icon size={16}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h4" /></Icon> },
  { title: 'Smart governance signals', desc: 'See what needs attention', icon: <Icon size={16}><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="3.2" /></Icon> },
  { title: 'Compare & improve', desc: 'Track progress over time', icon: <Icon size={16}><path d="M4 7h9M4 12h6M4 17h12" /><path d="m17 6 3 3-3 3" /></Icon> },
];

function SolutionSection() {
  const ref = useInView();
  return (
    <section className="land-section-alt" aria-labelledby="solution-heading" id="solutions">
      <div className="land-container">
        <div ref={ref} className="land-solutions-layout land-fade-up">
          <div>
            <div className="land-eyebrow">The solution</div>
            <h2 id="solution-heading" className="land-section-title">
              One intelligent platform.<br />
              Complete governance clarity.
            </h2>
            <p className="land-section-body" style={{ marginBottom: 0 }}>
              Symplicare AI Governance Intelligence brings your data, evidence and reports together — so you can
              understand what matters and act with confidence.
            </p>
            <div className="land-feature-grid">
              {SOLUTION_FEATURES.map((f) => (
                <div key={f.title} className="land-feature">
                  <span className="land-feature-icon">{f.icon}</span>
                  <span>
                    <span className="land-feature-title">{f.title}</span>
                    <span className="land-feature-desc">{f.desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <AppMock />
        </div>
      </div>
    </section>
  );
}

const MOCK_NAV = [
  'Dashboard', 'Care Homes', 'Upload Data', 'Insights', 'Reports', 'Compare', 'Actions', 'Notifications',
];
const MOCK_KPIS = [
  { l: 'Governance Health', v: '82', s: '↑ 12 vs last month', tone: '' },
  { l: 'Open Signals', v: '23', s: '↑ 5 this week', tone: '' },
  { l: 'Critical Signals', v: '4', s: 'No change', tone: 'danger' },
  { l: 'Open Actions', v: '12', s: '↑ 3 this month', tone: '' },
  { l: 'Reports', v: '8', s: 'This month', tone: '' },
];
const MOCK_SIGNALS = [
  { l: 'Medication incidents increasing', t: 'High', tone: 'danger' },
  { l: 'Staff training overdue', t: 'Medium', tone: 'warn' },
  { l: 'Falls risk assessments overdue', t: 'Medium', tone: 'warn' },
  { l: 'Complaints volume higher', t: 'Low', tone: 'muted' },
];
const MOCK_STATS = [
  { l: 'Data Quality', v: '92%', s: 'Good quality' },
  { l: 'Incidents (This Month)', v: '17', s: '↑ 22% vs last month' },
  { l: 'Complaints (This Month)', v: '5', s: '↓ 44% vs last month' },
  { l: 'Training Compliance', v: '96%', s: '↑ 14pp vs last month' },
  { l: 'Staffing Coverage', v: '91%', s: '↑ 6pp vs last month' },
];
const MOCK_TREND = [58, 52, 55, 46, 44, 38, 40, 32, 27, 24, 18, 12];
const MOCK_MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

function AppMock() {
  const step = 340 / (MOCK_TREND.length - 1);
  const line = MOCK_TREND.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y}`).join(' ');
  /* Donut: 12 open actions split 5 overdue / 3 in progress / 4 due soon. */
  const donut = [
    { label: 'Overdue', n: 5, color: '#F26B5E' },
    { label: 'In Progress', n: 3, color: '#18B6AE' },
    { label: 'Due Soon', n: 4, color: '#F4A261' },
  ];
  const circumference = 2 * Math.PI * 26;
  let offset = 0;

  return (
    <div className="land-mock" aria-label="Symplicare AI Governance Intelligence dashboard preview" role="img">
      <nav className="land-mock-sidebar" aria-hidden="true">
        <div className="land-mock-brand">
          <span className="cg-mark" style={{ width: 22, height: 22, borderRadius: 6, fontSize: 10 }}>S</span>
          <span>Symplicare AI<br />Governance Intelligence</span>
        </div>
        {MOCK_NAV.map((item, i) => (
          <div key={item} className={`land-mock-nav-item${i === 0 ? ' active' : ''}`}>
            {item}
            {item === 'Notifications' ? <span className="land-mock-badge">3</span> : null}
          </div>
        ))}
        <div className="land-mock-nav-spacer" />
        <div className="land-mock-nav-item">Settings</div>
        <div className="land-mock-nav-item">Profile</div>
        <div className="land-mock-user">
          <span className="land-mock-avatar">VK</span>
          <span>
            <span className="land-mock-user-name">Vikky Kumar</span>
            <span className="land-mock-user-role">Registered Manager</span>
          </span>
        </div>
      </nav>

      <div className="land-mock-main">
        <div className="land-mock-topbar" aria-hidden="true">
          <span className="land-mock-select">All Care Homes ▾</span>
          <span className="land-mock-daterange">
            <span className="land-mock-daterange-label">Date range</span>
            <span className="land-mock-select">August 2026 ▾</span>
            <span className="land-mock-select">⚙ Customise ▾</span>
          </span>
        </div>

        <div className="land-kpi-row five">
          {MOCK_KPIS.map((k) => (
            <div key={k.l} className="land-kpi-card">
              <div className="land-kpi-label">{k.l}</div>
              <div className={`land-kpi-value ${k.tone}`}>{k.v}</div>
              <div className="land-kpi-sub">{k.s}</div>
            </div>
          ))}
        </div>

        <div className="land-mock-panels">
          <div className="land-mock-panel">
            <div className="land-mock-panel-head">
              <span>12-Month Governance Trend</span>
              <span className="land-mock-select">12 Months ▾</span>
            </div>
            <svg viewBox="0 0 360 70" preserveAspectRatio="none" className="land-mock-chart" aria-hidden="true">
              <defs>
                <linearGradient id="mockFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#18B6AE" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#18B6AE" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${line} L340,64 L0,64 Z`} fill="url(#mockFill)" />
              <path d={line} fill="none" stroke="#18B6AE" strokeWidth="1.8" />
              {MOCK_TREND.map((y, i) => (
                <circle key={i} cx={(i * step).toFixed(1)} cy={y} r="2" fill="#35D4C8" />
              ))}
            </svg>
            <div className="land-mock-months" aria-hidden="true">
              {MOCK_MONTHS.map((m) => <span key={m}>{m}</span>)}
            </div>
          </div>

          <div className="land-mock-panel">
            <div className="land-mock-panel-head"><span>Top Signals</span></div>
            <ul className="land-mock-signals">
              {MOCK_SIGNALS.map((s) => (
                <li key={s.l}>
                  <span className={`land-mock-dot ${s.tone}`} />
                  <span className="land-mock-signal-label">{s.l}</span>
                  <span className={`land-mock-tag ${s.tone}`}>{s.t}</span>
                </li>
              ))}
            </ul>
            <span className="land-mock-more">View all signals →</span>
          </div>

          <div className="land-mock-panel">
            <div className="land-mock-panel-head"><span>Actions Snapshot</span></div>
            <div className="land-mock-donut-row">
              <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
                <circle cx="38" cy="38" r="26" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
                {donut.map((d) => {
                  const len = (d.n / 12) * circumference;
                  const dash = `${len} ${circumference - len}`;
                  const el = (
                    <circle
                      key={d.label}
                      cx="38" cy="38" r="26" fill="none"
                      stroke={d.color} strokeWidth="9"
                      strokeDasharray={dash}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 38 38)"
                    />
                  );
                  offset += len;
                  return el;
                })}
                <text x="38" y="36" textAnchor="middle" className="land-mock-donut-num">12</text>
                <text x="38" y="46" textAnchor="middle" className="land-mock-donut-cap">Total open</text>
              </svg>
              <ul className="land-mock-legend">
                {donut.map((d) => (
                  <li key={d.label}>
                    <span className="land-mock-legend-dot" style={{ background: d.color }} />
                    {d.label}
                    <b>{d.n}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="land-mock-stats">
          {MOCK_STATS.map((s) => (
            <div key={s.l} className="land-kpi-card">
              <div className="land-kpi-label">{s.l}</div>
              <div className="land-kpi-value">{s.v}</div>
              <div className="land-kpi-sub">{s.s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Customer logos ──────────────────────────────────────────── */
const LOGOS = [
  { name: 'Avery', tag: 'Care With a Difference' },
  { name: 'care UK', tag: '' },
  { name: 'BARCHESTER', tag: 'Celebrating life' },
  { name: 'HC One', tag: 'The kind care company' },
  { name: 'LARCHWOOD', tag: 'CARE' },
  { name: 'Runwood Homes', tag: 'Senior Living' },
];

function LogosSection() {
  const ref = useInView();
  return (
    <section className="land-logos" aria-labelledby="logos-heading" id="features">
      <div className="land-container">
        <div ref={ref} className="land-fade-up">
          <p id="logos-heading" className="land-logos-title">Trusted by care leaders across the UK</p>
          <div className="land-logos-grid">
            {LOGOS.map((l) => (
              <div key={l.name} className="land-logo-box">
                <span className="land-logo-name">{l.name}</span>
                {l.tag ? <span className="land-logo-tag">{l.tag}</span> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── How it works ─────────────────────────────────────────────── */
const STEPS = [
  { n: 1, title: 'Upload', desc: 'Bring your data together securely' },
  { n: 2, title: 'Validate', desc: 'We check and prepare your data' },
  { n: 3, title: 'Analyse', desc: 'AI identifies trends, risks and patterns' },
  { n: 4, title: 'Get Insights', desc: 'Clear signals and priorities' },
  { n: 5, title: 'Take Action', desc: 'Assign, track and monitor actions' },
  { n: 6, title: 'Prove Impact', desc: 'Generate reports and show improvement' },
];

function HowItWorksSection() {
  const ref = useInView();
  return (
    <section className="land-hiw" aria-labelledby="hiw-heading" id="how-it-works">
      <div className="land-hiw-bg" aria-hidden="true">
        <img src="/images/gallery/23_care_home_exterior.jpg" alt="" width="1440" height="420" loading="lazy" />
      </div>
      <div className="land-container land-hiw-layout">
        <div ref={ref} className="land-fade-up land-hiw-intro">
          <div className="land-eyebrow">How it works</div>
          <h2 id="hiw-heading" className="land-section-title" style={{ marginBottom: 0 }}>
            From data to better outcomes in 6 simple steps
          </h2>
        </div>

        <ol className="land-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="land-step">
              <span className="land-step-circle">{s.n}</span>
              <span className="land-step-title">{s.title}</span>
              <span className="land-step-desc">{s.desc}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── CTA ──────────────────────────────────────────────────────── */
function CtaSection() {
  const ref = useInView();
  return (
    <section className="land-cta" aria-labelledby="cta-heading" id="pricing">
      <div className="land-cta-bg-img" aria-hidden="true">
        <img src="/images/gallery/01_care_home_exterior.jpg" alt="" width="1440" height="420" loading="lazy" />
      </div>
      <div className="land-container land-cta-inner">
        <div ref={ref} className="land-cta-text land-fade-up">
          <h2 id="cta-heading" className="land-cta-title">Ready to transform your governance?</h2>
          <p className="land-cta-body" style={{ margin: 0 }}>
            Join care leaders who are making better decisions every day.
          </p>
        </div>
        <div className="land-cta-actions">
          <Link to="/sign-up" className="land-btn land-btn-primary">Request a demo</Link>
          <a href="#how-it-works" className="land-btn land-btn-secondary">
            <Icon size={15}><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></Icon>
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ───────────────────────────────────────────────────── */
const FOOTER_COLS = [
  { h: 'Product', links: ['Overview', 'Features', 'Integrations', 'Security', 'Updates'] },
  { h: 'Solutions', links: ['Care Home Groups', 'Single Care Homes', 'Quality Teams', 'Registered Managers'] },
  { h: 'Resources', links: ['Help Centre', 'Guides', 'Case Studies', 'Webinars', 'Blog'] },
  { h: 'Company', links: ['About Us', 'Careers', 'Partners', 'News', 'Contact'] },
  { h: 'Legal', links: ['Privacy Policy', 'Terms of Service', 'Data Processing', 'Security'] },
];

function SiteFooter() {
  return (
    <footer className="land-footer" role="contentinfo" id="company">
      <div className="land-container">
        <div className="land-footer-grid">
          <div>
            <div style={{ marginBottom: 16 }}><BrandMark size={30} stacked /></div>
            <p className="land-footer-blurb">
              Intelligence for better care.<br />
              Clarity for stronger governance.<br />
              Better outcomes for residents.
            </p>
            <div className="land-social">
              <a href="#linkedin" aria-label="LinkedIn">
                <Icon size={15}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7.5 10.5V17M7.5 7.5v.01M11.5 17v-3.6a2.4 2.4 0 0 1 4.8 0V17" /></Icon>
              </a>
              <a href="#x" aria-label="X">
                <Icon size={15}><path d="M4 4l16 16M20 4 4 20" /></Icon>
              </a>
              <a href="#youtube" aria-label="YouTube">
                <Icon size={15}><rect x="2.5" y="6" width="19" height="12" rx="3.5" /><polygon points="10.5 9.5 15 12 10.5 14.5" /></Icon>
              </a>
            </div>
          </div>
          {FOOTER_COLS.map((c) => (
            <div key={c.h} id={c.h === 'Resources' ? 'resources' : undefined}>
              <h3 className="land-footer-heading">{c.h}</h3>
              <ul className="land-footer-links">
                {c.links.map((l) => <li key={l}><a href="#">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="land-footer-bar">
          <span className="land-footer-fine">© 2026 Symplicare AI Ltd. All rights reserved.</span>
          <span className="land-footer-fine">
            Made with <span style={{ color: 'var(--color-danger)' }} aria-label="love">♥</span> in the UK
          </span>
        </div>
      </div>
    </footer>
  );
}
