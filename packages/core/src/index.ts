/**
 * @cgi/core — the indicator dictionary and the transparent trend engine.
 *
 * Pure functions only. No database, no network, no framework. The API imports
 * this to compute statuses server-side; the web client imports its types and
 * formatters so a status string cannot drift between the two.
 */

export * from './types.js';
export * from './indicators.js';
export * from './reference.js';
export * from './periods.js';
export * from './rules.js';
export * from './stats.js';
export * from './format.js';
export * from './engine.js';
export * from './signals.js';
export * from './compare.js';
export * from './quality.js';
export * from './assurance.js';
