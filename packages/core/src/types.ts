/**
 * Shared vocabulary for the whole platform. The API and the web client both
 * import these, so a status string can never drift between the two.
 */

export type Domain =
  | 'Quality & Safety'
  | 'Workforce'
  | 'Training & Supervision'
  | 'Governance & Audit'
  | 'Experience'
  | 'Operational'
  | 'Regulatory';

/** Taken from the source dictionary's Type field and never relabelled. */
export type IndicatorType = 'Lagging' | 'Potential leading' | 'Outcome' | 'Lagging/context';

/** The five key questions used in adult social care assessment. */
export type KeyQuestion = 'Safe' | 'Effective' | 'Caring' | 'Responsive' | 'Well-led';

export type HarmDirection = 'Higher = worse' | 'Lower = worse';

export interface Indicator {
  /** Canonical key. Never a free-text name. */
  id: string;
  domain: Domain;
  name: string;
  short: string;
  /** Numerator over denominator, verbatim from the source dictionary. */
  calc: string;
  unit: string;
  /** Reporting cadence as supplied, e.g. "Monthly" or "Monthly/Quarterly". */
  period: string;
  source: string;
  /** The missing-data rule, verbatim. */
  missing: string;
  harm: HarmDirection;
  type: IndicatorType;
  notes: string;
  example: string;
  /** Decimal places for display. */
  dp: 0 | 1 | 2;
  kloe: KeyQuestion;
  reg: string;
  /** Label for the numerator; empty when the indicator is a bare count. */
  num: string;
  /** Label for the denominator; empty when the indicator has none. */
  den: string;
}

/**
 * Why a period holds no usable value. `not-submitted` and `off-cycle` are
 * different facts and are never collapsed into each other: one is a gap in the
 * record, the other is a period where nothing was due.
 */
export type ReadingState = 'ok' | 'stale' | 'not-submitted' | 'off-cycle';

export interface Reading {
  /** Period id, `YYYY-MM`. */
  period: string;
  value: number | null;
  state: ReadingState;
  numerator?: number | null;
  denominator?: number | null;
}

export type Status = 'Deteriorating' | 'Watch' | 'Stable' | 'Improving' | 'Insufficient data';

export type Tone = 'bad' | 'watch' | 'stable' | 'good' | 'none';

/** One test that crossed its threshold, in words a manager can read. */
export interface TestResult {
  test:
    | 'Direction'
    | 'Magnitude'
    | 'Persistence'
    | 'Deviation'
    | 'Acceleration'
    | 'Convergence'
    | 'Context'
    | 'Small numbers'
    | 'Data';
  text: string;
}

export interface ContextNote {
  period: string;
  indicatorIds: string[];
  text: string;
  by: string;
  recordedAt: string;
}

export interface Evaluation {
  indicatorId: string;
  period: string;
  index: number;
  status: Status;
  value: number | null;
  state: ReadingState;
  /** +1 when a rise is harmful, -1 when a fall is. */
  harmSign: 1 | -1;

  baseline: number | null;
  /** The home's own normal spread for this indicator. */
  spread: number | null;
  baselineFrom: string | null;
  baselineTo: string | null;
  baselinePeriods: number;

  changeAbs: number | null;
  changePct: number | null;
  /** Signed so that positive always means "toward harm". Clamped for display. */
  deviation: number | null;
  deviationClamped: boolean;

  run: number;
  runDir: number;
  harmfulRun: number;
  helpfulRun: number;
  persistence: number;
  persistenceDir: number;
  accelerating: boolean;
  acceleration: { latest: number; previousAverage: number } | null;

  momChange: number | null;
  momFrom: string | null;

  smallNumbers: boolean;
  cappedBySmallNumbers: boolean;

  context: ContextNote[];
  reasons: TestResult[];
  /** One sentence, safe to put straight in front of a manager. */
  why: string;
}

export type SignalKind = 'Potential leading' | 'Mixed evidence' | 'Lagging / outcome';

export interface SignalDefinition {
  id: string;
  title: string;
  indicatorIds: string[];
  kind: SignalKind;
  frame: string;
}

export interface Signal {
  id: string;
  title: string;
  kind: SignalKind;
  severity: Status;
  /** True when the pattern currently meets its own rule. */
  raised: boolean;
  converged: boolean;
  mixed: boolean;
  narrative: string;
  members: Evaluation[];
  harmful: Evaluation[];
  improving: Evaluation[];
  firstRaisedPeriod?: string | null;
}

export interface ComparisonRow {
  indicatorId: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  pct: number | null;
  harmful: boolean | null;
  movement: 'Improved' | 'Deteriorated' | 'Broadly stable' | 'Not comparable';
  statusNow: Status;
}

export interface Completeness {
  due: number;
  got: number;
  stale: number;
  missing: string[];
  pct: number;
}

export interface Comparison {
  fromPeriod: string;
  toPeriod: string;
  rows: ComparisonRow[];
  improved: string[];
  deteriorated: string[];
  stable: string[];
  notComparable: string[];
  newSignals: { id: string; title: string; severity: Status; narrative: string }[];
  resolvedSignals: { id: string; title: string }[];
  quality: { from: Completeness; to: Completeness };
}

export type StatusCounts = Record<Status, number>;
