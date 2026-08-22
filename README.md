# Symplicare AI — Governance Intelligence platform

A UK care-home quality and governance platform built as a TypeScript monorepo:
**React 19** on the front, **Node 20 / Express 5** on the back, **MongoDB 7** underneath,
with the trend engine in a shared package both sides import.

```
platform/
  packages/core/   the indicator dictionary and the trend engine — pure functions, 50 tests
  apps/api/        Express 5 · Mongoose 8 · server-side sessions · 60 tests
  apps/web/        Vite 6 · React 19 · React Router 7 · TanStack Query 5
```

---

## Running it

Nothing to install beyond npm. If `MONGODB_URI` is unset, the API starts its own
MongoDB and keeps the data in `apps/api/.mongo-data`, so `seed` and `dev` work together.

```bash
npm install
npm run build -w @cgi/core
npm run seed          # three demonstration homes, 24 months, 1,080 values
npm run dev:api       # http://localhost:4000
npm run dev:web       # http://localhost:5173
```

Sign in as **`manager@northgate.example`** / **`Governance2026!`** (Registered Manager).
The seed also creates an owner, a governance lead, a quality lead and a viewer —
all on the same password — so the role behaviour can be seen from both sides.

For a real database, set `MONGODB_URI` (a local Docker instance via
`docker compose up -d`, or a MongoDB Atlas connection string) in `apps/api/.env`.

```bash
npm run gate      # the whole release gate: audit, secrets, types, lint, 110 tests
npm test          # engine, signals, security, workflow, scanner
npm run build     # production build of all three packages
```

See [RELEASE-GATE.md](./RELEASE-GATE.md) for what the gate covers, what is still
manual, and what must be configured before production.

### Containers

```bash
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
docker compose -f docker-compose.prod.yml up --build
```

Brings up MongoDB, ClamAV, the API and nginx. Only nginx is published; the API
is proxied at `/api` on the same origin so the session cookie stays first-party.

### Backups

```bash
npm run backup -- --out backups          # gzipped JSON, sessions excluded
npm run backup:verify -- --from backups/<file>.json.gz
```

`verify` restores into a throwaway database, checks every collection's count and
confirms a sample document round-tripped with its value intact. A backup nobody
has restored is a hope, not a backup.

---

## The three demonstration homes

Each one exercises a different behaviour of the engine.

| Home | Story | What it demonstrates |
| --- | --- | --- |
| **Elmwood House** | Workforce and governance conditions tightening | Convergence: absence, agency dependence and overdue supervisions raising one signal, first met in Nov 2025 |
| **Ashgrove Court** | Recovering after an intervention in Sep 2025 | A home where nothing is currently outside its normal range, and the recovery is visible in the history |
| **Beechfield Lodge** | Ordinary variation plus real submission gaps | "Insufficient data" as a visible, first-class state |

Elmwood also carries an **isolated spike** in missed activities (Nov 2025). Open Q14
at that period: the engine reports *Watch*, not *Deteriorating*, and says why —
"one period only. A single unusual reading is not treated as a sustained trend."

---

## How a status is decided

Everything below lives in `packages/core` and runs on the server, so a status is the
same for every user looking at the same home, and a report can be reproduced from
stored data long after any particular client is gone.

1. **Baseline** — the median of this home's own previous 6 periods. Fewer than 4
   comparable periods and nothing is calculated at all.
2. **Spread** — short-term variation, estimated from *successive differences*
   (the moving-range estimator used in control charts). This matters: the spread of
   a trending window is dominated by the trend itself, so judging a rise against it
   hides the rise. An earlier version used the window's own MAD and scored a doubling
   of agency dependence at 1.2σ; the test that caught it is in `engine.test.ts`.
3. **The seven tests** run — direction, magnitude, persistence, deviation,
   acceleration, convergence, context — each recording what it found in plain language.
4. **Deterioration is only called when two independent tests agree.** One large
   reading is never enough; that is what *Watch* is for.
5. **Small numbers guard** — where a period rests on fewer than five recorded events,
   the indicator is surfaced but never escalated on its own.

Direction of harm is read per indicator from the dictionary and never assumed uniform:
Q13 Satisfaction is the one where *lower* is worse, and the engine handles it from the
data rather than a special case.

Every threshold is stored per organisation and editable in **Settings**. The source
pack is explicit that these are a starting point to validate against real homes, so
they are exposed rather than buried — and a report keeps the thresholds it was
generated with, so changing them never rewrites history.

---

## Security

The design decisions worth knowing, and why they were made that way.

**Sessions live in the database, not in a token.** That costs a lookup per request
and buys revocation: a role change, a disabled account or "log out everywhere" takes
effect on the *next* request. None of that is implementable against stateless JWTs.

**Tenant isolation is a property of the query, not the interface.** Every route that
touches tenant data loads the record by id *and* organisation together, rather than
loading it and comparing afterwards — which is how object-level checks get forgotten.
"Not found" and "not yours" return byte-identical responses, so the API cannot be used
to discover which ids exist elsewhere.

**The session is the only authority on tenancy.** An `organisationId` in a request
body is data. There is a test that signs in as one organisation, posts another's id,
and proves the record lands in the caller's own tenant.

Also implemented: scrypt password hashing (`node:crypto`, no native module), login
throttling and lockout, CSRF double-submit plus `SameSite=strict`, an append-only
audit log covering refused attempts as well as successful ones, upload allowlists with
MIME/extension agreement, quarantine on suspicion, and Helmet security headers.

**Malware scanning is pluggable and fails closed.** Point `CLAMAV_HOST` at a clamd
instance and uploads are streamed to it over INSTREAM. Without one, a heuristic
stand-in runs — and production *refuses to start* on it unless the operator sets
`SCANNER=heuristic-accepted-risk` deliberately. Every failure path — unreachable,
silent, timed out, malformed reply — quarantines the file rather than passing it,
and there are tests for each one, because "assume clean on error" is how an
unreachable scanner quietly becomes an open door.

**Not claimed:** no certification, and no independent penetration test. The
Settings screen says so inside the product too.

---

## What the API exposes

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup · login · logout · logout-all` | Session lifecycle |
| `POST /api/auth/change-password · reset-password` | Credential changes, all sessions revoked |
| `GET /api/indicators` | The dictionary, verbatim, with the regulatory mapping and its version |
| `GET /api/care-homes` | Homes this caller may see |
| `GET /api/care-homes/:id/dashboard` | Statuses, signals, counts, completeness, 12-month matrix |
| `GET /api/care-homes/:id/indicators/:qid` | One indicator: history, baseline corridor, every comparison |
| `GET /api/care-homes/:id/compare?from&to` | Any two periods, with the movement rule applied |
| `GET /api/care-homes/:id/quality · assurance · signal-timeline` | Data quality, key-question mapping, signal history |
| `POST /api/care-homes/:id/imports/validate → commit` | CSV import: validate, preview the diff, then commit |
| `GET/POST /api/care-homes/:id/actions` · `/close` | Action lifecycle through to a recorded closure |
| `GET/POST /api/care-homes/:id/reports` · `/approve` | Versioned reports, frozen snapshots, approval |
| `GET/POST /api/care-homes/:id/evidence` · `/download` | Evidence library with scanning and quarantine |
| `GET/PATCH /api/admin/organisation · members · audit` | Settings, roles and the audit log |

---

## Things worth knowing

**The dictionary is code, not data.** The fifteen indicator definitions live in
`packages/core/src/indicators.ts` and are served from there, so a definition cannot be
edited into something the engine was not built for. Changing one is a code change with
a review — which is what the source Notes sheet asks for.

**Reports freeze what they were built from.** There is a test that generates a report,
restates the underlying month, and proves the stored report has not moved. A second
generation creates version 2 and marks the first superseded; nothing is deleted.

**Q02 still conflicts between the source workbooks.** The data dictionary defines it as
a rate per 1,000 resident-days; the MVP template describes it as a count per period.
This build follows the dictionary, which the master prompt ranks higher. It needs a
decision before production.

**Before production**, see [RELEASE-GATE.md](./RELEASE-GATE.md). The automated half
runs today under `npm run gate` and in CI: dependency and secret scanning, static
analysis, 110 tests covering RBAC, tenant isolation, IDOR, CSRF, uploads, the
scanner's fail-closed behaviour and audit completeness, plus a verified backup
restore. The manual half — independent penetration testing, DAST against a
deployed instance, the privacy review and production smoke tests — is listed
there and is deliberately not claimed here.
