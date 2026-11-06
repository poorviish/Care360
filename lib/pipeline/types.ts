import type { Weights } from "../config/scoring";

export type Severity = "severe" | "high" | "medium" | "low";

export interface Evidence {
  sheet: string;
  row: number;
  column?: string;
}

export type ExceptionTag = "stale" | "conflicting" | "self-reported" | "ai-derived" | "unverified";

export interface ExceptionFlag {
  tag: ExceptionTag;
  severe?: boolean;
  note?: string;
}

/** A displayable value with its provenance. A null value renders "Not in source data". */
export interface Sourced {
  value: string | number | null;
  source: string;
  date: string | null;
  evidence: Evidence[];
  flags?: ExceptionFlag[];
  /** Set when the value is computed. Holds the plain-language rule. */
  computed?: string;
}

/* ---------- Ingest and standardise ---------- */

export interface SheetInfo {
  name: string;
  kind: "dataset" | "reference";
  rows: number;
  columns: string[];
  memberIdColumn: string | null;
  dateColumns: string[];
}

export interface StdRow {
  sheet: string;
  prefix: string;
  row: number;
  memberId: string | null;
  /** Trimmed text per column. Excel dates arrive here as ISO. */
  f: Record<string, string | null>;
  /** ISO date per date column, or null when the cell is not a date. */
  iso: Record<string, string | null>;
  eventAt: string | null;
  arrivalAt: string | null;
}

/* ---------- Quality flags ---------- */

export interface QualityFlag {
  id: string;
  type: string;
  memberId: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Evidence[];
}

export interface FlagTypeInfo {
  type: string;
  label: string;
  description: string;
  fromBrief: boolean;
}

/* ---------- Derived per member ---------- */

export type ClockClass =
  | "safety"
  | "toc_contact"
  | "toc_visit"
  | "toc_window"
  | "task"
  | "appointment"
  | "measure"
  | "admin"
  | "info";

export type ClockStatus = "breached" | "final24" | "running" | "met" | "info";

export interface Clock {
  id: string;
  cls: ClockClass;
  label: string;
  startAt: string | null;
  dueAt: string | null;
  hoursLeft: number | null;
  status: ClockStatus;
  /** Ready-to-show state, for example "19 h 40 m left" or "Overdue 5 d". */
  display: string;
  detail: string;
  /** Always "event" for TOC clocks. */
  countedFrom: "event" | "due date" | "as-of";
  /** What a receipt-based clock would have shown, for comparison. */
  arrivalDueAt?: string | null;
  feedDelayHours?: number | null;
  evidence: Evidence[];
}

export interface Signal {
  code: string;
  title: string;
  detail: string;
  severity: Severity;
  clinical: boolean;
  evidence: Evidence[];
}

export type ContactStatusClass = "working" | "dead" | "do_not_call" | "unknown";
export type ConsentState = "ok" | "outside_plan" | "none" | "expired" | "not_required";

export interface TimeWindow {
  start: string;
  end: string;
}

export interface AttemptStats {
  total: number;
  connected: number;
  recentFails: number;
  lastAt: string | null;
  lastOutcome: string | null;
}

export interface ContactOption {
  key: string;
  kind: "phone" | "email";
  value: string;
  owner: Sourced;
  ownerIsMember: boolean;
  label: string;
  /** Where the number came from, as the workbook states it. */
  origin: string | null;
  status: Sourced;
  statusClass: ContactStatusClass;
  mislabelled: boolean;
  inPlanRecord: boolean;
  consent: { state: ConsentState; text: Sourced };
  smsAllowed: boolean;
  smsReason: string;
  bestTimeText: Sourced;
  bestWindow: TimeWindow | null;
  avoidWindows: TimeWindow[];
  language: string | null;
  lastVerified: Sourced;
  attempts: AttemptStats;
  score: number;
  rank: number;
  scoreReasons: string[];
  evidence: Evidence[];
}

export interface Reachability {
  label: string;
  band: "direct" | "via_caregiver" | "number_bad_alternate" | "channel_restricted" | "no_working_contact";
  primary: ContactOption | null;
  best: ContactOption | null;
  options: ContactOption[];
  callDemoted: boolean;
  demotionReason: string | null;
  preferredAction: "call" | "sms";
  smsAvailable: boolean;
  smsReason: string;
  language: Sourced;
  languageValues: Sourced[];
  languageConflict: boolean;
  interpreterRequired: boolean;
  bestTime: Sourced;
  lastConfirmed: Sourced;
  contactableNow: { fraction: number; working: boolean; consent: boolean; inWindow: boolean; explanation: string };
  addressOnFile: Sourced;
  addressActual: Sourced | null;
  addressUnreliable: boolean;
}

export interface ChangeItem {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  arrivalAt: string;
  arrivalHoursAgo: number;
  eventAt: string | null;
  source: string;
  evidence: Evidence[];
  flags?: ExceptionFlag[];
}

export interface WhatChanged {
  baselineType: "last_contact" | "case_open" | "none";
  baselineAt: string | null;
  baselineLabel: string;
  baselineEvidence: Evidence[];
  items: ChangeItem[];
}

export type MedEntryStatus =
  | "listed"
  | "discontinued"
  | "planned"
  | "pending"
  | "not_dispensed"
  | "rejected"
  | "dispensed"
  | "administered"
  | "reported";

export interface MedEntry {
  text: string;
  status: MedEntryStatus;
  source: string;
  date: string | null;
  evidence: Evidence[];
  flags?: ExceptionFlag[];
  runoutAt?: string | null;
  daysPastRunout?: number | null;
  external?: boolean;
}

export interface MedConflict {
  severity: Severity;
  summary: string;
  evidence: Evidence[];
}

export interface MedRow {
  key: string;
  label: string;
  drugClass: string | null;
  ordered: MedEntry[];
  dispensed: MedEntry[];
  reported: MedEntry[];
  active: boolean;
  conflict: MedConflict | null;
}

export interface MedicationView {
  rows: MedRow[];
  generalStatements: MedEntry[];
  amr: { value: number; controllerUnits: number; rescueUnits: number; evidence: Evidence[] } | null;
}

export interface ConditionCode {
  code: string;
  label: string | null;
  labelEvidence: Evidence | null;
  mentions: Sourced[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface DocumentedProblem {
  text: string;
  source: Sourced;
}

export interface LabRow {
  test: Sourced;
  value: Sourced;
  unit: string | null;
  refRange: string | null;
  flag: string | null;
  prior: string | null;
}

export interface EgfrTrend {
  points: { date: string; value: number; derived: boolean; source: string; evidence: Evidence[] }[];
  slopePerYear: number | null;
  computedFromCreatinine: { value: number; statedInWorkbook: string | null; evidence: Evidence[] } | null;
}

export interface RiskModel {
  model: Sourced;
  score: Sourced;
  tier: Sourced;
  prior: string | null;
  reasons: string[];
  refutableReasons: string[];
  dataAsOf: string | null;
  triggeredCase: string | null;
  note: string | null;
}

export interface SdohItem {
  domain: string;
  text: Sourced;
  captureDate: string | null;
  ageDays: number | null;
  thresholdDays: number | null;
  stale: boolean;
  selfReported: boolean;
  respondent: string | null;
  assessment: string;
}

export interface AssessmentSummary {
  name: Sourced;
  date: string | null;
  ageDays: number | null;
  respondent: string | null;
  completionPct: number | null;
  score: string | null;
  keyResponses: string | null;
  flags: ExceptionFlag[];
}

export type JourneyLane = "Acute" | "Claims" | "Pharmacy" | "Labs and documents" | "Contact" | "Appointments" | "Authorisations";

export interface JourneyEvent {
  id: string;
  lane: JourneyLane;
  label: string;
  detail: string;
  eventAt: string;
  endAt: string | null;
  arrivalAt: string | null;
  latencyHours: number | null;
  status: "ok" | "pending" | "expected" | "gap" | "future" | "inferred";
  source: string;
  evidence: Evidence[];
}

export interface CarePlanTask {
  id: string;
  caseId: string | null;
  itemType: string;
  text: Sourced;
  status: string | null;
  dueAt: string | null;
  overdue: boolean;
  open: boolean;
  note: string | null;
}

export interface CaseSummary {
  id: string;
  status: string;
  program: string;
  openAt: string | null;
  closeAt: string | null;
  closeReason: string | null;
  closeReasonFlag: string | null;
  assignedCm: string | null;
  acuity: string | null;
  evidence: Evidence[];
}

export interface AuthItem {
  id: Sourced;
  service: string;
  status: Sourced;
  reason: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysInQueue: number | null;
  owner: string | null;
  note: string | null;
}

export interface AppointmentItem {
  id: string;
  label: Sourced;
  type: string;
  at: string | null;
  status: string | null;
  distanceMiles: number | null;
  note: string | null;
  upcoming: boolean;
}

export interface VendorItem {
  service: Sourced;
  vendor: string | null;
  eligibility: string | null;
  status: string | null;
  detail: string | null;
  flag: string | null;
}

export interface GapItem {
  code: Sourced;
  name: string;
  status: string | null;
  dueAt: string | null;
  detail: string | null;
  flag: string | null;
}

export interface CareTeamMember {
  role: string;
  name: Sourced;
  organisation: string | null;
  network: string | null;
  lastContact: string | null;
  flag: string | null;
}

export interface CarePlan {
  cases: CaseSummary[];
  tasks: CarePlanTask[];
  auths: AuthItem[];
  appointments: AppointmentItem[];
  gaps: GapItem[];
  vendors: VendorItem[];
  careTeam: CareTeamMember[];
}

export interface Commitment {
  label: string;
  overdue: boolean;
  evidence: Evidence[];
}

export interface DriverResult {
  key: keyof Weights;
  label: string;
  weight: number;
  fraction: number;
  points: number;
  reason: string;
  evidence: Evidence[];
}

export interface Priority {
  score: number;
  /** Score without Contactable now. Rank is computed from this, so reachability cannot lower a rank. */
  baseScore: number;
  rank: number;
  topTier: boolean;
  topTierReasons: string[];
  drivers: DriverResult[];
  commitments: Commitment[];
}

export interface NextAction {
  id: string;
  kind: "call" | "sms" | "task";
  title: string;
  reason: string;
  targetKey: string | null;
  evidence: Evidence[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  why: string;
  severity: Severity;
}

export interface AssessmentField {
  id: string;
  label: string;
  kind: "stable" | "volatile";
  /** Stable fields: prefilled value. Volatile fields: null until confirmed in the call. */
  value: Sourced | null;
  /** Volatile fields: the last known value, shown as "Previously: value (date)". */
  previous: Sourced | null;
}

export interface MemberRecord {
  id: string;
  name: Sourced;
  recordedNames: Sourced[];
  dobs: Sourced[];
  age: Sourced;
  sex: Sourced;
  trigger: Sourced;
  scenario: Sourced;
  assignedCm: Sourced;
  acuity: Sourced;
  coverage: { lineOfBusiness: Sourced; product: Sourced; status: Sourced; start: Sourced; end: Sourced }[];
  allergies: Sourced[];
  attributedPcps: Sourced[];
  household: Sourced;
  duplicateBanner: { title: string; detail: string; evidence: Evidence[] } | null;
  briefing: string[];
  freshness: Sourced;
  reachability: Reachability;
  clocks: Clock[];
  signals: Signal[];
  changes: WhatChanged;
  medications: MedicationView;
  conditions: { coded: ConditionCode[]; documented: DocumentedProblem[]; labs: LabRow[]; egfr: EgfrTrend | null };
  risk: RiskModel[];
  sdoh: SdohItem[];
  assessments: AssessmentSummary[];
  carePlan: CarePlan;
  journey: JourneyEvent[];
  priority: Priority;
  actions: NextAction[];
  callGuide: ChecklistItem[];
  assessmentFields: AssessmentField[];
  flagIds: string[];
}

export interface QueueRow {
  id: string;
  rank: number;
  score: number;
  topTier: boolean;
  topTierReasons: string[];
  name: Sourced;
  age: Sourced;
  sex: Sourced;
  trigger: Sourced;
  language: Sourced;
  interpreterRequired: boolean;
  assignedCm: Sourced;
  reachabilityLabel: string;
  reachabilityBand: Reachability["band"];
  drivers: DriverResult[];
  commitments: Commitment[];
  clocks: Clock[];
  freshness: Sourced;
  action: NextAction | null;
  primaryNumber: ContactOption | null;
  bestContact: ContactOption | null;
  alternatives: ContactOption[];
  callDemoted: boolean;
  demotionReason: string | null;
  preferredAction: "call" | "sms";
  smsAvailable: boolean;
  smsReason: string;
  bestTime: Sourced;
  lastConfirmed: Sourced;
  flagCount: number;
  severeFlagCount: number;
  snoozeWindow: string | null;
}

export interface SimulatedAlert {
  memberId: string;
  memberName: string;
  alertId: string;
  eventType: string;
  facility: string;
  evidence: Evidence[];
  reordered: QueueRow[];
}

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  counts: { label: string; value: number }[];
}

export interface PlantedCoverage {
  id: string;
  memberId: string;
  datasets: string;
  imperfection: string;
  expectedRules: string[];
  matchedFlagIds: string[];
  missingRules: string[];
  covered: boolean;
  evidence: Evidence;
}

export interface RankAudit {
  memberId: string;
  name: string;
  computedRank: number;
  workbookRank: number | null;
  topTier: boolean;
  score: number;
}

export interface ScoringRow {
  memberId: string;
  name: string;
  rank: number;
  topTier: boolean;
  drivers: { key: keyof Weights; points: number; weight: number; reason: string }[];
  baseScore: number;
  score: number;
}

export interface RunReport {
  workbookName: string;
  asOf: string;
  asOfSource: string;
  sheets: SheetInfo[];
  totals: { sheets: number; rows: number; datasetRows: number; members: number; rowsWithSourceFlag: number };
  stages: PipelineStage[];
  flagsByType: { type: string; label: string; description: string; fromBrief: boolean; count: number }[];
  flagsBySeverity: Record<Severity, number>;
  flagTotal: number;
  derived: { label: string; value: number }[];
  warnings: string[];
  plantedCoverage: PlantedCoverage[];
  rankAudit: RankAudit[];
  weights: Weights;
  scoring: ScoringRow[];
  codeLabels: { code: string; label: string; evidence: Evidence }[];
}

export interface DemoFact {
  id: string;
  fieldId: string;
  label: string;
  value: string;
  confidence: number;
  highRisk: boolean;
  evidenceLine: number;
  target: "assessment" | "care_plan" | "both";
  barrier?: { task: string; owner: string; dueBusinessDays: number };
}

export interface DemoFixture {
  label: string;
  memberId: string;
  callWith: string;
  channel: string;
  interpreter: string;
  transcript: { t: string; speaker: string; text: string }[];
  facts: DemoFact[];
}

export interface Dataset {
  asOf: string;
  asOfSource: string;
  members: MemberRecord[];
  queue: QueueRow[];
  flags: QualityFlag[];
  simulatedAlert: SimulatedAlert | null;
  demo: Record<string, DemoFixture>;
}

export interface PipelineResult {
  dataset: Dataset;
  report: RunReport;
}

export interface ValidationError {
  sheet: string | null;
  message: string;
}
