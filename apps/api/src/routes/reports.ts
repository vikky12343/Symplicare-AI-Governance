import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { isPeriodId, parsePeriod } from '@cgi/core';
import { Dataset, Report } from '../models/index.js';
import { auth, careHome, requireCapability, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import { buildSnapshot } from '../services/analytics.js';
import { loadRules } from '../services/series.js';
import { record } from '../services/audit.js';

const router = Router();

/**
 * Reports are versioned and never overwritten.
 *
 * Generating a new version for a period supersedes the previous one, which
 * stays readable with the exact values and thresholds it was built from. That
 * is what makes the record defensible when someone asks, months later, what
 * the position looked like at the time.
 */

function serialise(r: InstanceType<typeof Report>, includeSnapshot = false) {
  return {
    id: String(r._id),
    reference: r.reference,
    period: r.period,
    periodLabel: r.period.includes('-Q') ? r.period : parsePeriod(r.period).label,
    kind: r.kind,
    version: r.version,
    dataVersion: r.dataVersion,
    approvalStatus: r.approvalStatus,
    generatedByName: r.generatedByName,
    generatedAt: (r as { createdAt?: Date }).createdAt,
    approvedByName: r.approvedByName,
    approvedAt: r.approvedAt,
    commentary: r.commentary,
    ...(includeSnapshot ? { snapshot: r.snapshot, rules: r.rules } : {}),
  };
}

router.get(
  '/:careHomeId/reports',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const reports = await Report.find({ organisationId: ctx.organisationId, careHomeId: home._id })
      .sort({ period: -1, version: -1 })
      .limit(100);
    res.json({ reports: reports.map((r) => serialise(r)) });
  }),
);

router.get(
  '/:careHomeId/reports/:reportId',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const id = String(req.params.reportId);
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Report not found.');

    const report = await Report.findOne({
      _id: new Types.ObjectId(id),
      organisationId: ctx.organisationId,
      careHomeId: home._id,
    });
    if (!report) throw ApiError.notFound('Report not found.');

    await record({
      req,
      action: 'report.viewed',
      entity: 'Report',
      entityId: String(report._id),
      careHomeId: home._id,
      detail: { reference: report.reference },
    });

    res.json({ report: serialise(report, true) });
  }),
);

const generateSchema = z.object({
  period: z.string().refine(isPeriodId, 'Expected YYYY-MM.'),
  commentary: z.string().max(8000).optional(),
  kind: z.string().max(120).optional(),
});

router.post(
  '/:careHomeId/reports',
  resolveCareHome,
  requireCapability('generateReports'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const body = generateSchema.parse(req.body);

    const rules = await loadRules(ctx.organisationId);
    const snapshot = await buildSnapshot(
      { organisationId: ctx.organisationId, careHomeId: home._id, period: body.period },
      rules,
    );

    const datasets = await Dataset.find({
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      period: body.period,
    })
      .sort({ version: -1 })
      .limit(1)
      .lean();

    const previous = await Report.find({
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      period: body.period,
    }).sort({ version: -1 });

    const version = (previous[0]?.version ?? 0) + 1;
    const dataVersion = datasets[0]
      ? `DS-${body.period}-v${datasets[0].version}`
      : `DS-${body.period}-none`;

    const report = await Report.create({
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      reference: `RPT-${home.code}-${body.period}-v${version}`,
      period: body.period,
      kind: body.kind ?? 'Monthly governance report',
      version,
      datasetIds: datasets.map((d) => d._id),
      dataVersion,
      snapshot,
      rules,
      commentary: body.commentary ?? '',
      generatedBy: ctx.user._id,
      generatedByName: ctx.user.name,
    });

    /* Earlier approved versions become superseded, not deleted. */
    await Report.updateMany(
      { _id: { $in: previous.filter((p) => p.approvalStatus === 'Approved').map((p) => p._id) } },
      { $set: { approvalStatus: 'Superseded' } },
    );

    await record({
      req,
      action: 'report.generated',
      entity: 'Report',
      entityId: String(report._id),
      careHomeId: home._id,
      detail: { reference: report.reference, version, dataVersion, supersededVersions: previous.length },
    });

    res.status(201).json({ report: serialise(report, true) });
  }),
);

/**
 * Approval is a separate capability from generation on purpose: the person who
 * produces the numbers should not be the only person who signs them off.
 */
router.post(
  '/:careHomeId/reports/:reportId/approve',
  resolveCareHome,
  requireCapability('approveReports'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const id = String(req.params.reportId);
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Report not found.');

    const report = await Report.findOne({
      _id: new Types.ObjectId(id),
      organisationId: ctx.organisationId,
      careHomeId: home._id,
    });
    if (!report) throw ApiError.notFound('Report not found.');
    if (report.approvalStatus === 'Superseded') {
      throw ApiError.conflict('That version has been superseded. Approve the current version instead.');
    }
    if (report.approvalStatus === 'Approved') {
      throw ApiError.conflict('That report is already approved.');
    }

    report.approvalStatus = 'Approved';
    report.approvedBy = ctx.user._id;
    report.approvedByName = ctx.user.name;
    report.approvedAt = new Date();
    await report.save();

    await record({
      req,
      action: 'report.approved',
      entity: 'Report',
      entityId: String(report._id),
      careHomeId: home._id,
      detail: { reference: report.reference, version: report.version },
    });

    res.json({ report: serialise(report) });
  }),
);

export default router;
