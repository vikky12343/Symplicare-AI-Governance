import type { Role } from '../models/index.js';

/**
 * Role capabilities.
 *
 * One table, consulted server-side on every route. The web client reads the
 * same table to decide what to render, but rendering is a courtesy — the check
 * that matters is the one here.
 *
 * Deny by default: a capability a role is not listed for is refused.
 */
export const CAPABILITIES = [
  'viewDashboard',
  'uploadData',
  'reviewSignals',
  'manageActions',
  'generateReports',
  'approveReports',
  'manageEvidence',
  'manageMembers',
  'readAuditLog',
  'manageSettings',
  'viewAllHomes',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Readonly<Record<Role, readonly Capability[]>> = {
  'Organisation Owner': [...CAPABILITIES],
  'Provider / Director': [
    'viewDashboard',
    'reviewSignals',
    'manageActions',
    'generateReports',
    'approveReports',
    'manageEvidence',
    'readAuditLog',
    'viewAllHomes',
  ],
  'Registered Manager': [
    'viewDashboard',
    'uploadData',
    'reviewSignals',
    'manageActions',
    'generateReports',
    'manageEvidence',
  ],
  'Deputy Manager': [
    'viewDashboard',
    'uploadData',
    'reviewSignals',
    'manageActions',
    'generateReports',
    'manageEvidence',
  ],
  'Quality Lead': [
    'viewDashboard',
    'uploadData',
    'reviewSignals',
    'manageActions',
    'generateReports',
    'manageEvidence',
  ],
  'Governance Lead': [
    'viewDashboard',
    'reviewSignals',
    'manageActions',
    'generateReports',
    'approveReports',
    'manageEvidence',
    'readAuditLog',
    'viewAllHomes',
  ],
  Administrator: ['viewDashboard', 'uploadData', 'manageEvidence', 'manageMembers'],
  Staff: ['viewDashboard', 'manageActions'],
  Viewer: ['viewDashboard'],
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

export function capabilitiesOf(role: Role): Capability[] {
  return [...(MATRIX[role] ?? [])];
}

export const CAPABILITY_MATRIX = MATRIX;
