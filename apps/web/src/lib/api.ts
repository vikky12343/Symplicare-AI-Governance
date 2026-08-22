/**
 * Typed API client.
 *
 * The session lives in an httpOnly cookie the browser sends automatically, so
 * there is no token for this code to hold, store or accidentally log. The only
 * thing it does carry is the CSRF token, read from a readable cookie and echoed
 * back on every write — the double-submit half of the defence.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when re-authenticating is the way out of this error. */
  get needsSignIn(): boolean {
    return this.status === 401;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cgi_csrf=([^;]+)/);
  return match?.[1] ?? '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);

  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('X-CSRF-Token', csrfToken());
    if (init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: never[] } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong.',
      error?.fields,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

/* --------------------------------------------------------------- shapes */

import type {
  Completeness,
  Evaluation,
  Indicator,
  Reading,
  RuleSet,
  Status,
  StatusCounts,
} from '@cgi/core';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
  managerRole: string | null;
  /** null means render initials. One source of truth for every avatar. */
  avatarUrl: string | null;
  emailVerified: boolean;
  mfaEnabled?: boolean;
  onboarding: { completed: boolean; step: number };
  role: string;
  capabilities: string[];
  careHomeIds?: string[];
}

export interface OrganisationRecord {
  id: string;
  name: string;
  type: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  county: string;
  postcode: string;
  reportingCycle?: string;
}

export const CARE_HOME_TYPES = [
  'Residential',
  'Nursing',
  'Residential + Nursing',
  'Specialist',
  'Other',
] as const;

export const MANAGER_ROLES = [
  'Registered Manager',
  'Regional Manager',
  'Operations Manager',
  'Quality Manager',
  'Other',
] as const;

export const ORGANISATION_TYPES = [
  'Care Provider',
  'Care Home Group',
  'Single Care Home',
  'NHS / Local Authority',
  'Other',
] as const;

/** The executive overview: organisation-wide, or scoped to one care home. */
export interface OverviewResponse {
  scope: { kind: 'all' | 'home'; careHomeId: string; name: string; homeCount: number };
  periods: { id: string; label: string }[];
  period: string | null;
  periodLabel: string | null;
  previousLabel?: string | null;
  kpis: {
    governanceHealth: { value: number | null; previous: number | null; unit: string };
    openSignals: { value: number; previous: number | null };
    criticalSignals: { value: number; previous: number | null };
    openActions: { value: number; previous: number | null };
    reports: { value: number; previous: number | null };
  } | null;
  counts?: Record<string, number>;
  trend: { period: string; label: string; value: number | null }[];
  topSignals: {
    id: string;
    careHomeId: string;
    careHomeName: string;
    title: string;
    severity: string;
    indicators: number;
  }[];
  actions: { total: number; overdue: number; inProgress: number; dueSoon: number };
  homes: {
    id: string;
    name: string;
    town: string;
    health: number | null;
    sparkline: number[];
    openSignals: number | null;
    openActions: number;
    lastReport: string | null;
  }[];
  reports: {
    id: string;
    reference: string;
    kind: string;
    period: string;
    periodLabel: string;
    careHomeId: string;
    careHomeName: string;
    approvalStatus: string;
    at: string | null;
  }[];
}

/** A person in the organisation, as GET /api/admin/members returns them. */
export interface MemberRecord {
  id: string;
  name: string;
  email: string;
  role: string | null;
  careHomeIds: string[];
  emailVerified: boolean;
  lastLoginAt?: string | null;
  disabled: boolean;
}

export interface CareHomeSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  county: string;
  postcode: string;
  beds: number | null;
  residents: number | null;
  cqcLocationId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  quarterlyIndicators: string[];
  notes: string;
  archivedAt: string | null;
  latestPeriod: string | null;
}

export type IndicatorEvaluation = Evaluation & {
  indicator: Pick<Indicator, 'id' | 'name' | 'short' | 'domain' | 'unit' | 'type' | 'harm' | 'dp' | 'kloe'>;
  sparkline: { period: string; value: number | null; state: Reading['state'] }[];
};

export interface DashboardSignal {
  id: string;
  title: string;
  kind: string;
  severity: Status;
  raised: boolean;
  converged: boolean;
  mixed: boolean;
  narrative: string;
  members: IndicatorEvaluation[];
  harmful: string[];
  improving: string[];
  firstRaisedPeriod?: string | null;
}

export interface DashboardResponse {
  careHome: { id: string; code: string; name: string; town?: string; beds?: number };
  period: string;
  periodLabel: string;
  rules: RuleSet;
  counts: StatusCounts;
  quality: Completeness;
  indicators: IndicatorEvaluation[];
  signals: DashboardSignal[];
  /** Real per-period statuses for the heatmap, not a placeholder. */
  matrixPeriods: string[];
  matrix: Record<string, Record<string, Status>>;
}

export interface IndicatorDetailResponse {
  indicator: Indicator;
  period: string;
  evaluation: Evaluation;
  readings: Reading[];
  corridor: ({ period: string; lo: number; hi: number; mid: number } | null)[];
  comparisons: {
    monthOnMonth: number | null;
    yearOnYear: number | null;
    thisQuarter: { value: number | null; monthsUsed: number; monthsExpected: number; complete: boolean };
    previousQuarter: { value: number | null; monthsUsed: number; monthsExpected: number; complete: boolean };
    sameQuarterLastYear: { value: number | null; monthsUsed: number; monthsExpected: number; complete: boolean };
    thisYear: { value: number | null; monthsUsed: number };
    previousYear: { value: number | null; monthsUsed: number };
    rolling3: number | null;
    rolling6: number | null;
  };
  periods: string[];
}

export interface ComparisonResponse {
  fromPeriod: string;
  toPeriod: string;
  fromLabel: string;
  toLabel: string;
  rows: {
    indicatorId: string;
    from: number | null;
    to: number | null;
    delta: number | null;
    pct: number | null;
    movement: string;
    statusNow: Status;
  }[];
  improved: string[];
  deteriorated: string[];
  stable: string[];
  notComparable: string[];
  newSignals: { id: string; title: string; severity: Status; narrative: string }[];
  resolvedSignals: { id: string; title: string }[];
  quality: { from: Completeness; to: Completeness };
  indicators: Record<string, { short: string; unit: string; dp: number }>;
}

export interface ActionRecord {
  id: string;
  reference: string;
  title: string;
  description?: string;
  signalId: string | null;
  indicatorIds: string[];
  priority: string;
  assessment: string;
  ownerName?: string;
  dueDate?: string;
  reviewDate?: string;
  status: 'Open' | 'Completed';
  closure: string | null;
  outcome: string;
  overdue?: boolean;
  createdAt?: string;
}

export interface ReportRecord {
  id: string;
  reference: string;
  period: string;
  periodLabel: string;
  kind: string;
  version: number;
  dataVersion: string;
  approvalStatus: 'Awaiting approval' | 'Approved' | 'Superseded';
  generatedByName?: string;
  generatedAt?: string;
  approvedByName?: string;
  commentary: string;
  snapshot?: {
    counts: StatusCounts;
    quality: Completeness;
    indicators: { indicatorId: string; value: number | null; baseline: number | null; changePct: number | null; status: Status; why: string }[];
    signals: { id: string; title: string; severity: Status; narrative: string }[];
  };
  rules?: RuleSet;
}

export interface ImportResult {
  ticket: string;
  filename: string;
  rowsRead: number;
  acceptedCount: number;
  errors: { row: number; field: string; message: string }[];
  warnings: { row: number; field: string; message: string }[];
  missingColumns: string[];
  ignoredColumns: string[];
  periods: string[];
  changes: { indicatorId: string; period: string; stored: number | null; incoming: number | null; isNew: boolean }[];
}

export interface QualityResponse {
  period: string;
  completeness: Completeness;
  trend: { period: string; pct: number }[];
  issues: { level: string; indicatorId: string; kind: string; text: string }[];
}

export interface AssuranceResponse {
  period: string;
  areas: { keyQuestion: string; state: Status; deteriorating: number; watch: number; members: IndicatorEvaluation[] }[];
}
