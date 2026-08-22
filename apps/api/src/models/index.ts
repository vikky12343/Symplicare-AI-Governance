/**
 * Data model.
 *
 * Organisation → CareHome → Dataset → IndicatorValue, with Signal, Action,
 * Report and Evidence hanging off them.
 *
 * Two rules hold across every collection here:
 *
 *  1. Every tenant-owned document carries `organisationId`, and every query
 *     that reads one is scoped by it. Isolation is a property of the data
 *     access layer, not of the user interface.
 *  2. Nothing that forms part of the governance record is mutated in place.
 *     A correction creates a new version and the superseded one stays readable.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ROLES = [
  'Organisation Owner',
  'Provider / Director',
  'Registered Manager',
  'Deputy Manager',
  'Quality Lead',
  'Governance Lead',
  'Administrator',
  'Staff',
  'Viewer',
] as const;
export type Role = (typeof ROLES)[number];

/** How a manager describes their own job, asked once during onboarding. */
export const MANAGER_ROLES = [
  'Registered Manager',
  'Regional Manager',
  'Operations Manager',
  'Quality Manager',
  'Other',
] as const;
export type ManagerRole = (typeof MANAGER_ROLES)[number];

export const CARE_HOME_TYPES = [
  'Residential',
  'Nursing',
  'Residential + Nursing',
  'Specialist',
  'Other',
] as const;
export type CareHomeType = (typeof CARE_HOME_TYPES)[number];

export const ORGANISATION_TYPES = [
  'Care Provider',
  'Care Home Group',
  'Single Care Home',
  'NHS / Local Authority',
  'Other',
] as const;
export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

const timestamps = { timestamps: true } as const;

/* ------------------------------------------------------------ organisation */
const organisationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    /** Provider category, as the manager describes it during onboarding. */
    type: {
      type: String,
      enum: ['Care Provider', 'Care Home Group', 'Single Care Home', 'NHS / Local Authority', 'Other'],
      default: 'Care Provider',
    },
    addressLine1: { type: String, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    town: { type: String, trim: true, maxlength: 120 },
    county: { type: String, trim: true, maxlength: 120 },
    postcode: { type: String, trim: true, maxlength: 16 },
    reportingCycle: { type: String, default: 'Calendar month' },
    timezone: { type: String, default: 'Europe/London' },
    /** Trend thresholds, per organisation. Validated by @cgi/core on read. */
    rules: { type: Schema.Types.Mixed, default: {} },
    retentionMonths: { type: Number, default: 84 },
    archivedAt: { type: Date, default: null },
  },
  timestamps,
);
export type OrganisationAttrs = InferSchemaType<typeof organisationSchema>;
export type OrganisationDoc = HydratedDocument<OrganisationAttrs>;
export const Organisation = model('Organisation', organisationSchema);

/* -------------------------------------------------------------- care home */
const careHomeSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    /** Human-facing code used in uploads, e.g. CH-001. Unique per organisation. */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: CARE_HOME_TYPES,
      default: 'Residential',
    },
    addressLine1: { type: String, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    town: { type: String, trim: true, maxlength: 120 },
    county: { type: String, trim: true, maxlength: 120 },
    postcode: { type: String, trim: true, maxlength: 16 },
    beds: { type: Number, min: 1, max: 2000 },
    residents: { type: Number, min: 0, max: 2000 },
    /** CQC location id, e.g. 1-234567890. Reference only; never validated
        against the register, because a wrong-looking id is still the one the
        provider was given. */
    cqcLocationId: { type: String, trim: true, maxlength: 64 },
    contactName: { type: String, trim: true, maxlength: 200 },
    contactPhone: { type: String, trim: true, maxlength: 40 },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    /** Indicators this home reports quarterly rather than monthly. */
    quarterlyIndicators: { type: [String], default: [] },
    notes: { type: String, maxlength: 2000 },
    archivedAt: { type: Date, default: null },
  },
  timestamps,
);
careHomeSchema.index({ organisationId: 1, code: 1 }, { unique: true });
export type CareHomeAttrs = InferSchemaType<typeof careHomeSchema>;
export type CareHomeDoc = HydratedDocument<CareHomeAttrs>;
export const CareHome = model('CareHome', careHomeSchema);

/* ------------------------------------------------------------------- user */
const membershipSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    role: { type: String, enum: ROLES, required: true },
    /** Empty means every home in the organisation. */
    careHomeIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    /** scrypt, salted per user. Never selected by default. */
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    /** Hashed, single-use, time-limited. Never the raw token. */
    verificationTokenHash: { type: String, default: null, select: false },
    verificationExpiresAt: { type: Date, default: null, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetExpiresAt: { type: Date, default: null, select: false },
    /* Name is kept as one field because that is what every existing screen
       and audit entry reads. The parts are stored alongside it and the two are
       reconciled whenever the profile is saved. */
    firstName: { type: String, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 40 },
    jobTitle: { type: String, trim: true, maxlength: 120 },
    managerRole: { type: String, enum: MANAGER_ROLES, default: null },
    /** Storage key for the avatar, or null for initials. */
    avatarKey: { type: String, default: null },
    avatarUpdatedAt: { type: Date, default: null },
    onboarding: {
      completed: { type: Boolean, default: false },
      completedAt: { type: Date, default: null },
      /** The furthest step reached, so a closed browser resumes where it left. */
      step: { type: Number, default: 1, min: 1, max: 5 },
    },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, select: false },
    memberships: { type: [membershipSchema], default: [] },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
  },
  timestamps,
);
userSchema.index({ email: 1 }, { unique: true });
export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/* ---------------------------------------------------------------- session */
/** Server-side sessions, so a role change or a logout takes effect at once. */
const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  csrfToken: { type: String, required: true },
  userAgent: { type: String, maxlength: 400 },
  ip: { type: String, maxlength: 64 },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
});
/** Expired sessions are removed by the database rather than by a cron job. */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type SessionAttrs = InferSchemaType<typeof sessionSchema>;
export type SessionDoc = HydratedDocument<SessionAttrs>;
export const Session = model('Session', sessionSchema);

/* ---------------------------------------------------------------- dataset */
/** One submission of data for one home and period. Versioned, never replaced. */
const datasetSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    version: { type: Number, required: true, min: 1 },
    source: { type: String, enum: ['csv', 'manual', 'seed', 'integration'], default: 'csv' },
    filename: { type: String, maxlength: 300 },
    rowsAccepted: { type: Number, default: 0 },
    rowsRejected: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    supersededAt: { type: Date, default: null },
  },
  timestamps,
);
datasetSchema.index({ organisationId: 1, careHomeId: 1, period: 1, version: -1 });
export type DatasetAttrs = InferSchemaType<typeof datasetSchema>;
export type DatasetDoc = HydratedDocument<DatasetAttrs>;
export const Dataset = model('Dataset', datasetSchema);

/* --------------------------------------------------------- indicator value */
const indicatorValueSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    datasetId: { type: Schema.Types.ObjectId, ref: 'Dataset', required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    indicatorId: { type: String, required: true, uppercase: true, match: /^Q\d{2}$/ },
    /** null means the period was not calculated. It is never a stand-in for zero. */
    value: { type: Number, default: null },
    numerator: { type: Number, default: null },
    denominator: { type: Number, default: null },
    state: {
      type: String,
      enum: ['ok', 'stale', 'not-submitted', 'off-cycle'],
      default: 'ok',
      required: true,
    },
    unit: { type: String, maxlength: 80 },
    sourceSystem: { type: String, maxlength: 200 },
    notes: { type: String, maxlength: 1000 },
    /** Superseded values stay readable; only the current one is queried. */
    current: { type: Boolean, default: true, index: true },
  },
  timestamps,
);
indicatorValueSchema.index({ careHomeId: 1, indicatorId: 1, period: 1, current: 1 });
indicatorValueSchema.index({ organisationId: 1, careHomeId: 1, period: 1 });
export type IndicatorValueAttrs = InferSchemaType<typeof indicatorValueSchema>;
export type IndicatorValueDoc = HydratedDocument<IndicatorValueAttrs>;
export const IndicatorValue = model('IndicatorValue', indicatorValueSchema);

/* ----------------------------------------------------------------- action */
const actionSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    reference: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, maxlength: 4000 },
    signalId: { type: String, default: null },
    indicatorIds: { type: [String], default: [] },
    priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
    assessment: {
      type: String,
      enum: [
        'Requires review',
        'Confirmed concern',
        'Explained by known context',
        'Not relevant',
        'False positive',
      ],
      default: 'Requires review',
    },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String, maxlength: 200 },
    dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    reviewDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ['Open', 'Completed'], default: 'Open', index: true },
    closure: {
      type: String,
      enum: ['Resolved', 'Ongoing', 'Not relevant', 'False positive', null],
      default: null,
    },
    outcome: { type: String, maxlength: 4000, default: '' },
    /** The period an intervention started, for before-and-after comparison. */
    interventionPeriod: { type: String, default: null },
    evidenceIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date, default: null },
  },
  timestamps,
);
actionSchema.index({ organisationId: 1, reference: 1 }, { unique: true });
export type ActionAttrs = InferSchemaType<typeof actionSchema>;
export type ActionDoc = HydratedDocument<ActionAttrs>;
export const Action = model('Action', actionSchema);

/* ----------------------------------------------------------------- report */
/** A report keeps the values it was generated from. It is never overwritten. */
const reportSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    reference: { type: String, required: true },
    period: { type: String, required: true },
    kind: { type: String, default: 'Monthly governance report' },
    version: { type: Number, required: true, min: 1 },
    /** The dataset versions the numbers came from. */
    datasetIds: { type: [Schema.Types.ObjectId], default: [] },
    dataVersion: { type: String, required: true },
    /** Frozen snapshot: statuses, signals and values as they stood. */
    snapshot: { type: Schema.Types.Mixed, required: true },
    /** The rules in force when it was generated, so it can be reproduced. */
    rules: { type: Schema.Types.Mixed, required: true },
    commentary: { type: String, maxlength: 8000, default: '' },
    approvalStatus: {
      type: String,
      enum: ['Awaiting approval', 'Approved', 'Superseded'],
      default: 'Awaiting approval',
    },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generatedByName: { type: String, maxlength: 200 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, maxlength: 200, default: '' },
    approvedAt: { type: Date, default: null },
  },
  timestamps,
);
reportSchema.index({ organisationId: 1, reference: 1 }, { unique: true });
reportSchema.index({ careHomeId: 1, period: 1, version: -1 });
export type ReportAttrs = InferSchemaType<typeof reportSchema>;
export type ReportDoc = HydratedDocument<ReportAttrs>;
export const Report = model('Report', reportSchema);

/* --------------------------------------------------------------- evidence */
const evidenceSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    /** Null means organisation-wide rather than tied to one home. */
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', default: null, index: true },
    reference: { type: String, required: true },
    filename: { type: String, required: true, maxlength: 300 },
    /** Rewritten on upload. The original name is never used on disk. */
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true, maxlength: 200 },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true },
    kind: { type: String, maxlength: 120 },
    scanStatus: {
      type: String,
      enum: ['pending', 'clean', 'quarantined'],
      default: 'pending',
      index: true,
    },
    linkedIndicatorIds: { type: [String], default: [] },
    linkedSignalIds: { type: [String], default: [] },
    linkedActionIds: { type: [Schema.Types.ObjectId], default: [] },
    linkedReportIds: { type: [Schema.Types.ObjectId], default: [] },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, maxlength: 200 },
  },
  timestamps,
);
evidenceSchema.index({ organisationId: 1, reference: 1 }, { unique: true });
export type EvidenceAttrs = InferSchemaType<typeof evidenceSchema>;
export type EvidenceDoc = HydratedDocument<EvidenceAttrs>;
export const Evidence = model('Evidence', evidenceSchema);

/* ----------------------------------------------------------- context note */
const contextNoteSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    period: { type: String, required: true },
    indicatorIds: { type: [String], default: [] },
    text: { type: String, required: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, maxlength: 200 },
  },
  timestamps,
);
export type ContextNoteAttrs = InferSchemaType<typeof contextNoteSchema>;
export type ContextNoteDoc = HydratedDocument<ContextNoteAttrs>;
export const ContextNote = model('ContextNote', contextNoteSchema);

/* -------------------------------------------------------- calendar event */
const calendarEventSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', default: null, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    title: { type: String, required: true, maxlength: 300 },
    kind: { type: String, maxlength: 80 },
    ownerName: { type: String, maxlength: 200 },
    recurrence: { type: String, maxlength: 80 },
    completedAt: { type: Date, default: null },
  },
  timestamps,
);
export type CalendarEventAttrs = InferSchemaType<typeof calendarEventSchema>;
export type CalendarEventDoc = HydratedDocument<CalendarEventAttrs>;
export const CalendarEvent = model('CalendarEvent', calendarEventSchema);

/* -------------------------------------------------------------- audit log */
/**
 * Append-only in application semantics: nothing in the codebase updates or
 * deletes an entry, and no route exposes a way to.
 */
const auditLogSchema = new Schema({
  organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  userName: { type: String, maxlength: 200, default: 'system' },
  action: { type: String, required: true, maxlength: 120, index: true },
  entity: { type: String, maxlength: 120 },
  entityId: { type: String, maxlength: 120 },
  careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', default: null },
  /** Never carries credentials, tokens or file contents. */
  detail: { type: Schema.Types.Mixed, default: {} },
  ip: { type: String, maxlength: 64 },
  outcome: { type: String, enum: ['success', 'denied', 'failure'], default: 'success' },
  at: { type: Date, default: Date.now, index: true },
});
export type AuditLogAttrs = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDoc = HydratedDocument<AuditLogAttrs>;
export const AuditLog = model('AuditLog', auditLogSchema);

/* ----------------------------------------------------------- notification */
const notificationSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', default: null },
    kind: { type: String, required: true, maxlength: 80 },
    text: { type: String, required: true, maxlength: 600 },
    level: { type: String, enum: ['bad', 'watch', 'good', 'none'], default: 'none' },
    readBy: { type: [Schema.Types.ObjectId], default: [] },
  },
  timestamps,
);
export type NotificationAttrs = InferSchemaType<typeof notificationSchema>;
export type NotificationDoc = HydratedDocument<NotificationAttrs>;
export const Notification = model('Notification', notificationSchema);

/* ------------------------------------------------------------- invitation */
const invitationSchema = new Schema(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: ROLES, required: true },
    tokenHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, maxlength: 200 },
  },
  timestamps,
);
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type InvitationAttrs = InferSchemaType<typeof invitationSchema>;
export type InvitationDoc = HydratedDocument<InvitationAttrs>;
export const Invitation = model('Invitation', invitationSchema);
