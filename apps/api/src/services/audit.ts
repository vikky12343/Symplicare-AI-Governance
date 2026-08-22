import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models/index.js';
import { clientIp } from '../auth/sessions.js';
import { logger } from '../logger.js';

/**
 * Audit trail.
 *
 * Written for every sensitive action, whether it succeeded or was refused — a
 * denied attempt is often the more interesting record. `detail` carries what a
 * reviewer needs to understand the event and never a credential, token or file
 * body.
 */
export type AuditAction =
  | 'auth.signup'
  | 'auth.login'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.logout.all'
  | 'auth.password.changed'
  | 'auth.email.verified'
  | 'auth.mfa.enabled'
  | 'data.import.validated'
  | 'data.import.committed'
  | 'report.generated'
  | 'report.viewed'
  | 'report.approved'
  | 'signal.reviewed'
  | 'action.created'
  | 'action.updated'
  | 'action.closed'
  | 'evidence.uploaded'
  | 'evidence.downloaded'
  | 'evidence.deleted'
  | 'context.recorded'
  | 'member.joined'
  | 'member.invited'
  | 'member.role.changed'
  | 'settings.rules.changed'
  | 'settings.updated'
  | 'profile.updated'
  | 'home.created'
  | 'home.updated'
  | 'home.archived'
  | 'home.restored'
  | 'organisation.deleted'
  | 'access.denied';

export interface AuditInput {
  req: Request;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  careHomeId?: Types.ObjectId | null;
  detail?: Record<string, unknown>;
  outcome?: 'success' | 'denied' | 'failure';
  /** For events that happen before a session exists, such as a failed login. */
  organisationId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  userName?: string;
}

export async function record(input: AuditInput): Promise<void> {
  const ctx = input.req.auth;
  try {
    await AuditLog.create({
      organisationId: input.organisationId ?? ctx?.organisationId ?? null,
      userId: input.userId ?? ctx?.user._id ?? null,
      userName: input.userName ?? ctx?.user.name ?? 'anonymous',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      careHomeId: input.careHomeId ?? null,
      detail: input.detail ?? {},
      ip: clientIp(input.req),
      outcome: input.outcome ?? 'success',
      at: new Date(),
    });
  } catch (err) {
    /* An audit write must never take down the request it is describing, but it
       must be loud when it fails. */
    logger.error({ err, action: input.action }, 'Failed to write audit entry');
  }
}
