import { Router } from 'express';
import {
  DOMAINS,
  INDICATORS,
  KEY_QUESTIONS,
  SIGNAL_DEFINITIONS,
  DEFAULT_RULES,
  MAPPING_VERSION,
  regulatoryMapping,
} from '@cgi/core';
import { CAPABILITY_MATRIX } from '../middleware/capabilities.js';

const router = Router();

/**
 * The dictionary as supplied.
 *
 * Served from the shared package rather than the database so a definition
 * cannot be edited into something the engine was not built for. Changing a
 * definition is a code change with a review, which is what the source Notes
 * sheet asks for.
 */
router.get(
  '/',
  (_req, res) => {
    res.json({
      indicators: INDICATORS,
      domains: DOMAINS,
      keyQuestions: KEY_QUESTIONS,
      signalDefinitions: SIGNAL_DEFINITIONS,
      defaultRules: DEFAULT_RULES,
      regulatoryMapping: regulatoryMapping(INDICATORS),
      mappingVersion: MAPPING_VERSION,
      capabilityMatrix: CAPABILITY_MATRIX,
    });
  },
);

export default router;
