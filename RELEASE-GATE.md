# Release gate

The master prompt's rule is that a failed critical control blocks deployment.
This document says which of those controls run automatically today, which are
still manual, and which are outstanding — so that "we ran the gate" means
something specific rather than something reassuring.

```bash
npm run gate          # everything automated, in one command
```

---

## Automated — runs on every push

| Control | How | Where |
| --- | --- | --- |
| Dependency scan | `npm audit --audit-level=high` | `npm run scan:deps` |
| Secret scan | Ten high-confidence patterns, dependency-free | `scripts/scan-secrets.mjs` |
| Static analysis | typescript-eslint type-checked rules + `eslint-plugin-security` | `npm run lint` |
| Type safety | `strict`, `noUncheckedIndexedAccess`, across all three packages | `npm run typecheck` |
| Authentication | Weak passwords, account enumeration, lockout, session revocation | `apps/api/test/security.test.ts` |
| Vertical privilege escalation | Every capability refused to a role that lacks it | same |
| Horizontal access / IDOR | Cross-tenant reads and writes, identical 404s | same |
| Tenant isolation | Including an attacker-supplied `organisationId` in the body | same |
| CSRF | Double-submit token required on writes, not on reads | same |
| File upload | Wrong type, wrong extension, binary in disguise, oversized | same |
| Malware scanning | Fails closed on unreachable, silent, malformed and timed-out scanner | `apps/api/test/scanner.test.ts` |
| Audit completeness | Successful *and* refused attempts logged, no credentials in the log | `apps/api/test/security.test.ts` |
| Error handling | No stack traces, driver messages or query shapes in responses | same |
| Security headers | CSP, nosniff, referrer policy, no `x-powered-by` | same |
| Backup and restore | Dump, restore into a scratch database, verify counts and content | `npm run backup:verify` |
| Engine correctness | 50 tests over the trend rules, signals, comparison and aggregation | `packages/core/test/` |

**110 tests.** The CI workflow in `.github/workflows/ci.yml` runs all of the
above plus a production build, against a real MongoDB service container.

---

## Manual — before production data

These cannot be automated honestly, and the product does not claim them.

- [ ] **Independent penetration test.** Critical findings resolved or formally
      risk-accepted by a named owner before any real care-home data is loaded.
- [ ] **DAST** against a deployed instance. The unit and integration tests cover
      the application's own logic; they do not cover the deployed surface.
- [ ] **Privacy review.** Data inventory, retention schedule, processor and
      controller mapping, DPIA where appropriate, data-subject request process.
- [ ] **Production smoke tests.** Authentication, tenant isolation, upload,
      report generation and retrieval, comparison, action workflow.
- [ ] **Monitoring and alerting** live: error rates, security events, backup
      success, uptime, dependency advisories.
- [ ] **Rollback plan** rehearsed, not just written.

---

## Configuration that must change before production

The application refuses to start without the first two, and refuses to accept
uploads on a placeholder scanner without an explicit acknowledgement.

| Variable | Why it matters |
| --- | --- |
| `SESSION_SECRET` | Required in production. Signs session cookies. |
| `MONGODB_URI` | Required in production; the in-process database is refused. |
| `CLAMAV_HOST` | Without it the heuristic stand-in runs, and production start-up fails unless `SCANNER=heuristic-accepted-risk` is set deliberately. |
| `WEB_ORIGIN` | The CORS allowlist. Defaults to localhost. |

---

## Known limitations, stated plainly

These are in the product's own Settings screen as well as here.

1. **No certification of any kind is claimed.**
2. **The heuristic scanner is a stand-in.** It catches EICAR, executable headers
   and files that lie about their type. It is not malware scanning. Point
   `CLAMAV_HOST` at a clamd instance — `docker-compose.prod.yml` includes one.
3. **The trend thresholds are a candidate method.** The source pack is explicit
   that they must be validated against real homes. They are configurable, and a
   report keeps the thresholds it was generated with.
4. **Q02 conflicts between the source workbooks.** The data dictionary defines
   it as a rate per 1,000 resident-days; the MVP template as a count per period.
   This build follows the dictionary, which the master prompt ranks higher.
   It needs a decision, not a default.
5. **Email is not wired.** Verification and reset tokens are generated, hashed
   and expired correctly, but returned in the response outside production rather
   than sent. Connect a mail provider before inviting real users.
6. **MFA is designed for, not implemented.** The session and user models carry
   the fields; the second factor itself is not built.

---

## What a failing gate means

A red gate blocks the deploy. It is not a to-do list to work around:

- **Dependency or secret scan fails** — fix and rotate. A credential that
  reached a commit is compromised regardless of whether it was later removed.
- **A security test fails** — treat it as an incident in the making. Every one
  of those tests exists because its absence would be a way in.
- **Restore verification fails** — the backups are not backups. Stop and fix
  that before anything else, because it is the control every other failure
  eventually depends on.
