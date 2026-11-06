/**
 * The one config file for scoring. Every weight, step table and threshold the
 * pipeline uses lives here. docs/scoring.md explains how each is applied.
 * Contains no patient values.
 */

export interface Weights {
  deadline: number;
  clinicalRisk: number;
  newSignal: number;
  openCommitments: number;
  contactableNow: number;
}

/** Driver weights from the brief. They sum to 100. */
export const WEIGHTS: Weights = {
  deadline: 35,
  clinicalRisk: 30,
  newSignal: 20,
  openCommitments: 10,
  contactableNow: 5,
};

export const DRIVER_LABELS: Record<keyof Weights, string> = {
  deadline: "Deadline",
  clinicalRisk: "Clinical risk",
  newSignal: "New signal",
  openCommitments: "Open commitments",
  contactableNow: "Contactable now",
};

/** Deadline = max across clocks of urgency(hours left) x class weight. */
export const DEADLINE = {
  urgency: [
    { maxHours: 24, value: 1 },
    { maxHours: 48, value: 0.8 },
    { maxHours: 72, value: 0.6 },
    { maxHours: 168, value: 0.4 },
    { maxHours: 720, value: 0.2 },
  ],
  urgencyBeyond: 0.1,
  classWeight: {
    safety: 1,
    toc_contact: 1,
    toc_visit: 0.7,
    task: 0.5,
    appointment: 0.4,
    toc_window: 0.3,
    measure: 0.3,
    admin: 0.2,
    info: 0,
  },
} as const;

/** Clinical risk = max(tier value x horizon factor) across models, plus an uplift, capped at 1. */
export const CLINICAL = {
  tierValues: [
    { pattern: /very high/i, value: 1 },
    { pattern: /tier 1|high/i, value: 0.8 },
    { pattern: /flag/i, value: 0.6 },
    { pattern: /moderate|tier 2/i, value: 0.5 },
    { pattern: /low/i, value: 0.2 },
  ],
  tierDefault: 0.3,
  /** Longer horizons are less urgent today. 12-month risks are discounted. */
  longHorizonPattern: /12[- ]?mo|next 12|annual/i,
  longHorizonFactor: 0.75,
  upliftSevereSignal: 0.2,
  upliftHighSignal: 0.1,
} as const;

/** New signal = max across changes of freshness(hours since arrival) x severity. */
export const NEW_SIGNAL = {
  freshness: [
    { maxHours: 24, value: 1 },
    { maxHours: 72, value: 0.8 },
    { maxHours: 168, value: 0.5 },
    { maxHours: 336, value: 0.25 },
  ],
  severity: { severe: 1, high: 0.7, medium: 0.4, low: 0.2 },
} as const;

/** Open commitments = (overdue x 2 + open x 1) / cap, capped at 1. */
export const COMMITMENTS = { overduePoints: 2, openPoints: 1, cap: 10 } as const;

/** Contactable now = sum of the parts that hold at the as-of time. Never lowers a rank. */
export const CONTACTABLE = {
  workingNumber: 0.4,
  consentOnFile: 0.2,
  inBestWindow: 0.4,
} as const;

export const GUARDRAILS = {
  /** From the brief: a TOC contact clock in its final 24 hours or breached goes to the top tier. */
  tocFinalHours: 24,
  /**
   * Addition to the brief. These signals also go to the top tier, because the workbook
   * requires red-flag calls to reach the top of the queue and treats an anticoagulant
   * conflict as same-day. Empty this list to apply only the brief's TOC rule.
   */
  safetyTopTierSignals: ["red_flag_symptom", "duplicate_anticoagulation"],
  redFlagTriageHours: 1,
  /** A same-day safety task is due at this local hour on the as-of date. */
  sameDayCutoffHour: 17,
} as const;

export const THRESHOLDS = {
  tocContactBusinessDays: 2,
  tocVisitDays: 7,
  tocWindowDays: 30,
  feedLatencyHours: 24,
  feedLatencySevereHours: 48,
  documentLagDays: 30,
  labLagDays: 5,
  claimLagDays: 30,
  matchConfidence: 0.9,
  pendedAuthHours: 48,
  referralSlaDays: 7,
  hraStaleDays: 180,
  screenStaleDays: 90,
  utrLabelExpiryDays: 365,
  medLapsedDays: 180,
  medGapDays: 30,
  sourceSwitchMinDrugs: 3,
  egfrRapidDeclinePerYear: 5,
  egfrCkdBelow: 60,
  uacrSevereAtOrAbove: 300,
  edFrequentCount: 3,
  edFrequentWindowDays: 30,
  renewalWatchDays: 120,
  redFlagRecentDays: 7,
  voicePhq2PositiveAtOrAbove: 3,
  chemoNadirStartDay: 7,
  chemoNadirEndDay: 14,
} as const;

/** Stale SDOH: maximum age in days per domain before a capture is flagged stale. */
export const SDOH_STALE_DAYS: Record<string, number> = {
  Housing: 90,
  Food: 90,
  Transportation: 90,
  Utilities: 90,
  Legal: 90,
  "Phone access": 30,
  Financial: 180,
  "Caregiving and support": 180,
  "Function and falls": 180,
  "Home environment": 180,
  Employment: 365,
  "Area-level": 365,
};

/** Fixed interpretations of vague best-time words, in 24-hour clock. */
export const TIME_WINDOWS = {
  evenings: { start: 17, end: 21 },
  afternoons: { start: 12, end: 17 },
  latestCallHour: 21,
} as const;

export const CONFIDENCE_BANDS = { high: 0.85, medium: 0.6 } as const;

/**
 * My Day capacity. A simulated constant, not from the workbook: it is shown labelled as
 * such on the queue. Effort is a per-row estimate of the first contact block.
 */
export const MY_DAY = {
  capacityMinutes: 150,
  effortMinutes: { topTier: 45, standard: 25 },
} as const;

/** Upload limits for POST /api/process. */
export const UPLOAD = { maxBytes: 4 * 1024 * 1024, maxRowsPerSheet: 5000 } as const;
