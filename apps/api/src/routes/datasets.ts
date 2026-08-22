import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { isPeriodId } from '@cgi/core';
import { Dataset, ContextNote } from '../models/index.js';
import { auth, careHome, requireCapability, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import {
  commitImport,
  looksLikeWorkbook,
  templateCsv,
  validateImport,
  type ImportPreview,
} from '../services/import.js';
import { record } from '../services/audit.js';
import { env } from '../env.js';

const router = Router();

/**
 * Uploads are held in memory, never written to disk, and are rejected before
 * parsing if they are the wrong type or over the ceiling. A CSV that reaches
 * the parser has already passed the cheap checks.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  /*
   * Care homes keep this data in Excel, so .xlsx is accepted directly rather
   * than making someone export to CSV first — an extra step that goes wrong in
   * the usual ways: wrong delimiter, wrong encoding, a stray byte-order mark.
   *
   * The extension decides, not the browser's content type, because the type a
   * browser reports for a spreadsheet varies by operating system and by
   * whether Excel is installed.
   */
  fileFilter: (_req, file, cb) => {
    const name = file.originalname;
    if (/\.(csv|xlsx|xlsm)$/i.test(name)) {
      cb(null, true);
      return;
    }
    /* The 1997 binary format is a different container entirely and no
       maintained reader handles it safely. Say so, and say what to do. */
    if (/\.xls$/i.test(name)) {
      cb(new ApiError(415, 'unsupported_media_type',
        'The old .xls format cannot be read. Open it in Excel and use Save As → Excel Workbook (.xlsx).'));
      return;
    }
    cb(new ApiError(415, 'unsupported_media_type',
      'Attach a .csv or .xlsx file. Other formats are not read.'));
  },
});

/** Validation holds the parsed result briefly so commit re-checks the same rows. */
const pending = new Map<string, { preview: ImportPreview; at: number; userId: string }>();
const PENDING_TTL = 15 * 60_000;

function sweep(): void {
  const cutoff = Date.now() - PENDING_TTL;
  for (const [key, value] of pending) if (value.at < cutoff) pending.delete(key);
}

router.get(
  '/:careHomeId/template',
  resolveCareHome,
  (req, res) => {
    const home = careHome(req);
    const period = typeof req.query.period === 'string' ? req.query.period : '';
    if (!isPeriodId(period)) throw ApiError.badRequest('Provide the period as YYYY-MM.');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${home.code}-${period}-template.csv"`);
    res.send(templateCsv(home.code, period));
  },
);

router.post(
  '/:careHomeId/imports/validate',
  resolveCareHome,
  requireCapability('uploadData'),
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    if (!req.file) throw ApiError.badRequest('Attach a .csv or .xlsx file to upload.');

    /* Trust the bytes, not the extension: a workbook always begins with the ZIP
       magic number, so a spreadsheet saved with the wrong extension still reads
       correctly, and a binary file renamed .csv is caught here rather than
       producing a wall of nonsense validation errors. */
    const isWorkbook = looksLikeWorkbook(req.file.buffer);
    const text = isWorkbook ? '' : req.file.buffer.toString('utf8');
    if (!isWorkbook && text.includes(String.fromCharCode(0))) {
      throw ApiError.badRequest(
        'That file does not look like a spreadsheet or a CSV. Save it as .xlsx or .csv and try again.',
      );
    }

    const preview = await validateImport({
      ...(isWorkbook ? { file: req.file.buffer } : { text }),
      filename: req.file.originalname.slice(0, 300),
      careHomeCode: home.code,
      careHomeName: home.name,
      organisationId: ctx.organisationId,
      careHomeId: home._id,
    });

    sweep();
    const ticket = `${String(home._id)}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    pending.set(ticket, { preview, at: Date.now(), userId: String(ctx.user._id) });

    await record({
      req,
      action: 'data.import.validated',
      entity: 'Dataset',
      careHomeId: home._id,
      detail: {
        filename: preview.filename,
        rowsRead: preview.rowsRead,
        accepted: preview.accepted.length,
        rejected: preview.errors.length,
        warnings: preview.warnings.length,
      },
    });

    res.json({
      ticket,
      filename: preview.filename,
      rowsRead: preview.rowsRead,
      acceptedCount: preview.accepted.length,
      errors: preview.errors,
      warnings: preview.warnings,
      missingColumns: preview.missingColumns,
      ignoredColumns: preview.ignoredColumns,
      periods: preview.periods,
      changes: preview.changes,
    });
  }),
);

router.post(
  '/:careHomeId/imports/commit',
  resolveCareHome,
  requireCapability('uploadData'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const { ticket } = z.object({ ticket: z.string().min(8).max(120) }).parse(req.body);

    sweep();
    const held = pending.get(ticket);
    if (!held) {
      throw ApiError.badRequest('That validation result has expired. Upload the file again to see a fresh preview.');
    }
    /* The ticket is bound to the user and the home that produced it. */
    if (held.userId !== String(ctx.user._id) || !ticket.startsWith(`${String(home._id)}:`)) {
      throw ApiError.forbidden('That validation result belongs to a different upload.');
    }

    const result = await commitImport({
      preview: held.preview,
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      filename: held.preview.filename,
      userId: ctx.user._id,
      quarterlyIndicators: home.quarterlyIndicators ?? [],
    });

    pending.delete(ticket);

    await record({
      req,
      action: 'data.import.committed',
      entity: 'Dataset',
      entityId: String(result.datasetId),
      careHomeId: home._id,
      detail: { version: result.version, written: result.written, period: held.preview.periods[0] },
    });

    res.status(201).json({
      datasetId: String(result.datasetId),
      version: result.version,
      valuesWritten: result.written,
      period: held.preview.periods[0],
    });
  }),
);

router.get(
  '/:careHomeId/datasets',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const datasets = await Dataset.find({ organisationId: ctx.organisationId, careHomeId: home._id })
      .sort({ period: -1, version: -1 })
      .limit(60)
      .populate('uploadedBy', 'name')
      .lean();

    res.json({
      datasets: datasets.map((d) => ({
        id: String(d._id),
        period: d.period,
        version: d.version,
        source: d.source,
        filename: d.filename,
        rowsAccepted: d.rowsAccepted,
        rowsRejected: d.rowsRejected,
        warnings: d.warnings,
        uploadedBy: (d.uploadedBy as unknown as { name?: string })?.name ?? 'Unknown',
        uploadedAt: (d as { createdAt?: Date }).createdAt,
        superseded: Boolean(d.supersededAt),
      })),
    });
  }),
);

/** Manager-recorded context — the seventh test in the source specification. */
router.post(
  '/:careHomeId/context',
  resolveCareHome,
  requireCapability('reviewSignals'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const body = z
      .object({
        period: z.string().refine(isPeriodId, 'Expected YYYY-MM.'),
        indicatorIds: z.array(z.string().regex(/^Q\d{2}$/)).min(1),
        text: z.string().min(3).max(2000),
      })
      .parse(req.body);

    const note = await ContextNote.create({
      ...body,
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      createdBy: ctx.user._id,
      createdByName: ctx.user.name,
    });

    await record({
      req,
      action: 'context.recorded',
      entity: 'ContextNote',
      entityId: String(note._id),
      careHomeId: home._id,
      detail: { period: body.period, indicatorIds: body.indicatorIds },
    });

    res.status(201).json({ contextNote: { id: String(note._id) } });
  }),
);

router.get(
  '/:careHomeId/context',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const notes = await ContextNote.find({ organisationId: ctx.organisationId, careHomeId: home._id })
      .sort({ period: -1 })
      .limit(100)
      .lean();
    res.json({
      contextNotes: notes.map((n) => ({
        id: String(n._id),
        period: n.period,
        indicatorIds: n.indicatorIds,
        text: n.text,
        by: n.createdByName,
        at: (n as { createdAt?: Date }).createdAt,
      })),
    });
  }),
);

export default router;
