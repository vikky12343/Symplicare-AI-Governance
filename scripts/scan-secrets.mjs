#!/usr/bin/env node
/**
 * Secret scanning — the release gate's "no committed credentials" check.
 *
 * Deliberately dependency-free so it runs anywhere, including a CI image with
 * nothing installed yet. It reads files, matches a small set of high-confidence
 * patterns, and exits non-zero on any finding.
 *
 * Two design choices worth stating:
 *
 *   - It errs toward false positives and gives you a way to mark them, rather
 *     than erring toward silence. A scanner that misses a live key is worse
 *     than one that occasionally asks a question.
 *   - It never prints the matched secret, only where it is. A CI log is not a
 *     safe place to reproduce the thing you are trying to keep out of the repo.
 *
 *   node scripts/scan-secrets.mjs [--json]
 *
 * To accept a finding, put `secret-scan-ignore` in a comment on that line —
 * for a test fixture or a documented placeholder.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.mongo-data',
  '.storage', '.mongodb-binaries', '.next', '.vite',
]);

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf',
  '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.mp4', '.lock',
]);

const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

/**
 * Files .gitignore already excludes, which therefore cannot reach a commit.
 *
 * A local .env is where a credential is *supposed* to live. Flagging it makes
 * the gate fail for everyone who has configured a database, which teaches
 * people to ignore the scanner — the opposite of what it is for. This list
 * mirrors .gitignore exactly: anything not ignored there is still scanned,
 * including .env.example and any .env.production someone forgets to ignore.
 */
const GITIGNORED_FILES = new Set(['.env', '.env.local']);

/** Patterns chosen for precision — each one is nearly always a real credential. */
const RULES = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /\baws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'MongoDB connection string with credentials',
    re: /mongodb(\+srv)?:\/\/[^\s:'"]+:[^\s@'"]+@/,
  },
  {
    name: 'Hard-coded secret assignment',
    /* Assignments to a secret-shaped name with a long literal value. Short
       values and obvious placeholders are excluded below. */
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\s*[=:]\s*['"]([^'"\s]{12,})['"]/i,
  },
];

/** Values that look like secrets but are documentation, tests or examples. */
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|change[_-]?me|your[_-]|example|placeholder|redacted|dummy|test|sample|todo|none|null|undefined)/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) {
      if (SKIP_FILES.has(entry)) continue;
      if (GITIGNORED_FILES.has(entry)) continue;
      if (SKIP_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
      if (stat.size > 2 * 1024 * 1024) continue;
      out.push(full);
    }
  }
  return out;
}

function scanFile(path) {
  const findings = [];
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return findings;
  }
  /* Binary that slipped past the extension filter. */
  if (contents.includes('\u0000')) return findings;

  const lines = contents.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('secret-scan-ignore')) return;
    if (line.length > 2000) return; // minified or generated

    for (const rule of RULES) {
      const match = rule.re.exec(line);
      if (!match) continue;
      const captured = match[1];
      if (captured && PLACEHOLDER.test(captured)) continue;
      findings.push({
        file: relative(ROOT, path).replace(/\\/g, '/'),
        line: index + 1,
        rule: rule.name,
      });
      break; // one finding per line is enough to fail the gate
    }
  });
  return findings;
}

const files = walk(ROOT);
const findings = files.flatMap(scanFile);
const asJson = process.argv.includes('--json');

if (asJson) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
} else if (findings.length === 0) {
  console.log(`Secret scan: ${files.length} files, no findings.`);
} else {
  console.error(`Secret scan: ${findings.length} finding(s) across ${files.length} files.\n`);
  for (const f of findings) {
    /* The location, never the value. */
    console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  }
  console.error(
    '\nRemove the credential and rotate it — a secret that reached a commit must be treated as compromised.',
  );
  console.error('If this is a placeholder, add a `secret-scan-ignore` comment on that line.');
}

process.exit(findings.length === 0 ? 0 : 1);
