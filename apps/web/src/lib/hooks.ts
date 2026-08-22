import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type {
  ActionRecord,
  AssuranceResponse,
  CareHomeSummary,
  ComparisonResponse,
  DashboardResponse,
  IndicatorDetailResponse,
  QualityResponse,
  MemberRecord,
  OrganisationRecord,
  OverviewResponse,
  ReportRecord,
  SessionUser,
} from './api.js';
import { api } from './api.js';
import type { Indicator, RuleSet } from '@cgi/core';

/* --------------------------------------------------------------- session */

export interface AuthState {
  user: SessionUser | null;
  organisation: OrganisationRecord | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}

/** Whether the signed-in role holds a capability. The server checks too. */
export function useCan(): (capability: string) => boolean {
  const { user } = useAuth();
  return (capability: string) => user?.capabilities.includes(capability) ?? false;
}

/* ------------------------------------------------------------ selection */

export interface Selection {
  careHomeId: string | null;
  period: string | null;
  setCareHomeId: (id: string) => void;
  /**
   * `pinned` marks a month the manager chose deliberately. An unpinned
   * selection follows the newest data as it arrives, so filing a month always
   * shows that month; a pinned one stays put until it is changed or the home
   * stops reporting it.
   */
  setPeriod: (period: string, pinned?: boolean) => void;
  periodPinned: boolean;
}

export const SelectionContext = createContext<Selection | null>(null);

export function useSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection used outside SelectionProvider');
  return ctx;
}

/* --------------------------------------------------------------- queries */

const FIVE_MINUTES = 5 * 60 * 1000;

export function useCareHomes(includeArchived = false) {
  return useQuery({
    queryKey: ['care-homes', includeArchived],
    queryFn: () =>
      api.get<{ careHomes: CareHomeSummary[] }>(
        `/api/care-homes${includeArchived ? '?includeArchived=true' : ''}`,
      ),
    staleTime: FIVE_MINUTES,
  });
}

/**
 * Anything that changes the shape of the workspace — a new home, an edit, an
 * archive, a profile save — has to reach the rail, the switcher and every
 * screen reading a home. One invalidator, called from each mutation, so no
 * screen is left showing the workspace as it was a moment ago.
 */
export function useWorkspaceRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  return async () => {
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ['care-homes'] });
  };
}

/**
 * The manager's opening screen, for the whole organisation or one home.
 *
 * `careHomeId` of "all" is a real scope, not a missing value — the aggregate
 * across every home the caller may see.
 */
export function useOverview(careHomeId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['overview', careHomeId ?? 'all', period],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set('careHomeId', careHomeId ?? 'all');
      if (period) query.set('period', period);
      return api.get<OverviewResponse>(`/api/overview?${query.toString()}`);
    },
    staleTime: 60_000,
  });
}

export function usePeriods(careHomeId: string | null) {
  return useQuery({
    queryKey: ['periods', careHomeId],
    queryFn: () =>
      api.get<{ periods: { id: string; label: string }[]; latest: string | null }>(
        `/api/care-homes/${careHomeId}/periods`,
      ),
    enabled: Boolean(careHomeId),
    staleTime: FIVE_MINUTES,
  });
}

export function useDictionary() {
  return useQuery({
    queryKey: ['dictionary'],
    queryFn: () =>
      api.get<{
        indicators: Indicator[];
        domains: string[];
        keyQuestions: string[];
        defaultRules: RuleSet;
        mappingVersion: string;
        capabilityMatrix: Record<string, string[]>;
      }>('/api/indicators'),
    /* The dictionary is compiled into the build; it does not change under us. */
    staleTime: Infinity,
  });
}

export function useDashboard(careHomeId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['dashboard', careHomeId, period],
    queryFn: () =>
      api.get<DashboardResponse>(
        `/api/care-homes/${careHomeId}/dashboard${period ? `?period=${period}` : ''}`,
      ),
    enabled: Boolean(careHomeId),
  });
}

export function useIndicatorDetail(careHomeId: string | null, indicatorId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['indicator', careHomeId, indicatorId, period],
    queryFn: () =>
      api.get<IndicatorDetailResponse>(
        `/api/care-homes/${careHomeId}/indicators/${indicatorId}${period ? `?period=${period}` : ''}`,
      ),
    enabled: Boolean(careHomeId && indicatorId),
  });
}

export function useComparison(careHomeId: string | null, from: string | null, to: string | null) {
  return useQuery({
    queryKey: ['compare', careHomeId, from, to],
    queryFn: () => api.get<ComparisonResponse>(`/api/care-homes/${careHomeId}/compare?from=${from}&to=${to}`),
    enabled: Boolean(careHomeId && from && to),
  });
}

export function useQuality(careHomeId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['quality', careHomeId, period],
    queryFn: () =>
      api.get<QualityResponse>(`/api/care-homes/${careHomeId}/quality${period ? `?period=${period}` : ''}`),
    enabled: Boolean(careHomeId),
  });
}

export function useAssurance(careHomeId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['assurance', careHomeId, period],
    queryFn: () =>
      api.get<AssuranceResponse>(`/api/care-homes/${careHomeId}/assurance${period ? `?period=${period}` : ''}`),
    enabled: Boolean(careHomeId),
  });
}

export function useActions(careHomeId: string | null) {
  return useQuery({
    queryKey: ['actions', careHomeId],
    queryFn: () => api.get<{ actions: ActionRecord[]; today: string }>(`/api/care-homes/${careHomeId}/actions`),
    enabled: Boolean(careHomeId),
  });
}

export function useReports(careHomeId: string | null) {
  return useQuery({
    queryKey: ['reports', careHomeId],
    queryFn: () => api.get<{ reports: ReportRecord[] }>(`/api/care-homes/${careHomeId}/reports`),
    enabled: Boolean(careHomeId),
  });
}

export function useReport(careHomeId: string | null, reportId: string | null) {
  return useQuery({
    queryKey: ['report', careHomeId, reportId],
    queryFn: () => api.get<{ report: ReportRecord }>(`/api/care-homes/${careHomeId}/reports/${reportId}`),
    enabled: Boolean(careHomeId && reportId),
  });
}

export function useSignalTimeline(careHomeId: string | null, period: string | null) {
  return useQuery({
    queryKey: ['timeline', careHomeId, period],
    queryFn: () =>
      api.get<{ events: { period: string; signalId: string; title: string; kind: string; severity: string }[] }>(
        `/api/care-homes/${careHomeId}/signal-timeline${period ? `?period=${period}` : ''}`,
      ),
    enabled: Boolean(careHomeId),
  });
}

/** Every submission this home has filed, newest first. */
export function useDatasets(careHomeId: string | null) {
  return useQuery({
    queryKey: ['datasets', careHomeId],
    queryFn: () =>
      api.get<{
        datasets: {
          id: string;
          period: string;
          version: number;
          source: string;
          filename?: string;
          rowsAccepted: number;
          rowsRejected: number;
          warnings: number;
          uploadedBy: string;
          uploadedAt?: string;
          superseded: boolean;
        }[];
      }>(`/api/care-homes/${careHomeId}/datasets`),
    enabled: Boolean(careHomeId) && careHomeId !== 'all',
  });
}

export function useEvidence(careHomeId: string | null) {
  return useQuery({
    queryKey: ['evidence', careHomeId],
    queryFn: () =>
      api.get<{
        evidence: {
          id: string;
          reference: string;
          filename: string;
          kind: string;
          sizeBytes: number;
          scanStatus: string;
          organisationWide: boolean;
          uploadedByName: string;
          uploadedAt: string;
        }[];
      }>(`/api/care-homes/${careHomeId}/evidence`),
    enabled: Boolean(careHomeId),
  });
}

export function useAuditLog(enabled: boolean) {
  return useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api.get<{
        entries: {
          id: string;
          at: string;
          userName: string;
          action: string;
          entity?: string;
          outcome: string;
          detail: Record<string, unknown>;
        }[];
      }>('/api/admin/audit?limit=80'),
    enabled,
  });
}

export function useOrganisation() {
  return useQuery({
    queryKey: ['organisation'],
    queryFn: () =>
      api.get<{ organisation: { id: string; name: string; reportingCycle: string; rules: RuleSet } }>(
        '/api/admin/organisation',
      ),
  });
}

export function useMembers(enabled: boolean = true) {
  return useQuery({
    queryKey: ['members'],
    queryFn: () =>
      api.get<{ members: MemberRecord[]; roles: string[] }>('/api/admin/members'),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

/** Anything that changes what the engine reads must invalidate the analysis. */
function analysisKeys(): string[][] {
  return [['dashboard'], ['indicator'], ['compare'], ['quality'], ['assurance'], ['timeline'], ['periods']];
}

export function useInvalidateAnalysis() {
  const client = useQueryClient();
  return () => {
    for (const key of analysisKeys()) void client.invalidateQueries({ queryKey: key });
  };
}

export function useCreateAction(careHomeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ action: ActionRecord }>(`/api/care-homes/${careHomeId}/actions`, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['actions', careHomeId] }),
  });
}

export function useCloseAction(careHomeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; closure: string; outcome: string }) =>
      api.post<{ action: ActionRecord }>(`/api/care-homes/${careHomeId}/actions/${input.id}/close`, {
        closure: input.closure,
        outcome: input.outcome,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['actions', careHomeId] }),
  });
}

export function useGenerateReport(careHomeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { period: string; commentary?: string }) =>
      api.post<{ report: ReportRecord }>(`/api/care-homes/${careHomeId}/reports`, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['reports', careHomeId] }),
  });
}

export function useApproveReport(careHomeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) =>
      api.post<{ report: ReportRecord }>(`/api/care-homes/${careHomeId}/reports/${reportId}/approve`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['reports', careHomeId] });
      void client.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

export function useRecordContext(careHomeId: string | null) {
  const invalidate = useInvalidateAnalysis();
  return useMutation({
    mutationFn: (body: { period: string; indicatorIds: string[]; text: string }) =>
      api.post(`/api/care-homes/${careHomeId}/context`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateRules() {
  const client = useQueryClient();
  const invalidate = useInvalidateAnalysis();
  return useMutation({
    mutationFn: (rules: Partial<RuleSet>) =>
      api.patch<{ rules: RuleSet; note: string }>('/api/admin/organisation/rules', rules),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['organisation'] });
      invalidate();
    },
  });
}

export function useInviteMember() {
  return useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api.post<{ invited: boolean; token: string }>('/api/admin/invites', body),
  });
}

export function useMfaSetup() {
  return useMutation({
    mutationFn: () => api.post<{ secret: string; qrCodeUrl: string }>('/api/auth/mfa/setup'),
  });
}

export function useMfaVerify() {
  return useMutation({
    mutationFn: (body: { token: string }) => api.post<{ verified: boolean }>('/api/auth/mfa/verify', body),
  });
}

export function useArchiveCareHome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (careHomeId: string) => api.patch<{ archived: boolean }>(`/api/care-homes/${careHomeId}/archive`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['care-homes'] }),
  });
}

export function useDeleteOrganisation() {
  return useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>('/api/admin/organisation'),
  });
}
