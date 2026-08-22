import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Evidence } from '../models/index.js';
import { auth, careHome, requireCapability, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import { checksum, generateToken } from '../auth/passwords.js';
import { record } from '../services/audit.js';
import { env } from '../env.js';
import { storeObject, readObject } from '../services/storage.js';
import { scanBuffer } from '../services/scanner.js';

const router = Router();

/**
 * Evidence upload.
 *
 * An uploaded file is untrusted input. It is size-capped before it is read,
 * checked against an extension and MIME allowlist, scanned, given a generated
 * storage name so the original filename never touches the filesystem, and
 * served back with headers that stop a browser from rendering it inline.
 */
const ALLOWED = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['.xlsx']],
  ['text/csv', ['.csv']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const extensions = ALLOWED.get(file.mimetype);
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!extensions) {
      cb(new ApiError(415, 'unsupported_media_type', `Files of type "${file.mimetype}" are not accepted.`));
      return;
    }
    /* The declared type and the extension must agree, so a .pdf that is really
       something else does not slip through on its MIME alone. */
    if (!extensions.includes(ext)) {
      cb(new ApiError(415, 'unsupported_media_type', `A ${file.mimetype} file should not have the extension "${ext}".`));
      return;
    }
    cb(null, true);
  },
});

router.get(
  '/:careHomeId/evidence',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const items = await Evidence.find({
      organisationId: ctx.organisationId,
      $or: [{ careHomeId: home._id }, { careHomeId: null }],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({
      evidence: items.map((e) => ({
        id: String(e._id),
        reference: e.reference,
        filename: e.filename,
        kind: e.kind,
        mimeType: e.mimeType,
        sizeBytes: e.sizeBytes,
        scanStatus: e.scanStatus,
        organisationWide: e.careHomeId === null,
        linkedIndicatorIds: e.linkedIndicatorIds,
        linkedSignalIds: e.linkedSignalIds,
        linkedActionIds: (e.linkedActionIds ?? []).map(String),
        uploadedByName: e.uploadedByName,
        uploadedAt: (e as { createdAt?: Date }).createdAt,
      })),
    });
  }),
);

const metaSchema = z.object({
  kind: z.string().max(120).optional(),
  linkedIndicatorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : (v ?? []))),
  linkedSignalIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : (v ?? []))),
});

router.post(
  '/:careHomeId/evidence',
  resolveCareHome,
  requireCapability('manageEvidence'),
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    if (!req.file) throw ApiError.badRequest('Attach a file to upload.');

    const meta = metaSchema.parse(req.body);
    const digest = checksum(req.file.buffer);

    /* Identical content already held for this organisation is not stored twice. */
    const duplicate = await Evidence.findOne({
      organisationId: ctx.organisationId,
      checksum: digest,
    }).lean();
    if (duplicate) {
      throw ApiError.conflict(`That exact file is already in the library as ${duplicate.reference}.`);
    }

    const verdict = await scanBuffer(req.file.buffer, req.file.mimetype);
    const storageKey = `${String(ctx.organisationId)}/${generateToken(16)}`;
    await storeObject(storageKey, req.file.buffer);

    const count = await Evidence.countDocuments({ organisationId: ctx.organisationId });
    const evidence = await Evidence.create({
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      reference: `EV-${String(count + 1).padStart(3, '0')}`,
      filename: req.file.originalname.slice(0, 300),
      storageKey,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      checksum: digest,
      kind: meta.kind ?? 'Supporting document',
      scanStatus: verdict,
      linkedIndicatorIds: meta.linkedIndicatorIds,
      linkedSignalIds: meta.linkedSignalIds,
      uploadedBy: ctx.user._id,
      uploadedByName: ctx.user.name,
    });

    await record({
      req,
      action: 'evidence.uploaded',
      entity: 'Evidence',
      entityId: String(evidence._id),
      careHomeId: home._id,
      detail: { reference: evidence.reference, sizeBytes: evidence.sizeBytes, scanStatus: verdict },
    });

    res.status(201).json({
      evidence: {
        id: String(evidence._id),
        reference: evidence.reference,
        filename: evidence.filename,
        scanStatus: evidence.scanStatus,
      },
    });
  }),
);

router.get(
  '/:careHomeId/evidence/:evidenceId/download',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const id = String(req.params.evidenceId);
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Evidence not found.');

    const evidence = await Evidence.findOne({
      _id: new Types.ObjectId(id),
      organisationId: ctx.organisationId,
      $or: [{ careHomeId: home._id }, { careHomeId: null }],
    });
    if (!evidence) throw ApiError.notFound('Evidence not found.');

    if (evidence.scanStatus !== 'clean') {
      throw ApiError.forbidden(
        evidence.scanStatus === 'pending'
          ? 'That file has not finished scanning yet.'
          : 'That file was quarantined by the scanner and cannot be downloaded.',
      );
    }

    const body = await readObject(evidence.storageKey);
    if (!body) throw ApiError.notFound('That file is no longer in storage.');

    await record({
      req,
      action: 'evidence.downloaded',
      entity: 'Evidence',
      entityId: String(evidence._id),
      careHomeId: home._id,
      detail: { reference: evidence.reference },
    });

    /* Always an attachment, never rendered in the origin. */
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  }),
);

export default router;
