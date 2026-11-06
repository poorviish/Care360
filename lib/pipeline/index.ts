import type { WorkBook } from "xlsx";
import { GUARDRAILS, WEIGHTS, type Weights } from "../config/scoring";
import { ageInYears, daysBetween } from "./dates";
import { buildActions } from "./derive/actions";
import { buildCarePlan, buildCommitments, buildJourney } from "./derive/careplan";
import { buildChanges, buildFreshness } from "./derive/changes";
import { buildCallGuide, buildChemoCalendar, buildConditions, buildEgfrTrend, buildRisk, type ChemoCalendar } from "./derive/clinical";
import { buildClocks, clockPressure } from "./derive/clocks";
import { buildMedications, detectSourceSwitch } from "./derive/medications";
import { buildReachability } from "./derive/reachability";
import { computeDrivers, rankMembers, topTierReasons, type ScoreInput } from "./derive/scoring";
import { buildSdoh } from "./derive/sdoh";
import { buildSignals, isRealAlert } from "./derive/signals";
import { ingest, validateSchema, type IngestedSheet } from "./ingest";
import { PLANTED_EXPECTATIONS } from "./plantedCoverage";
import { detectFlags, FLAG_TYPES } from "./quality";
import { cell, computed, ev, firstSentences, iso, missing, s, standardise, type Store } from "./standardise";
import type {
  AssessmentField,
  AssessmentSummary,
  Clock,
  Dataset,
  ExceptionFlag,
  MemberRecord,
  PipelineResult,
  PlantedCoverage,
  QualityFlag,
  QueueRow,
  RankAudit,
  RunReport,
  ScoringRow,
  Severity,
  SimulatedAlert,
  Sourced,
  StdRow,
  ValidationError,
} from "./types";

export class SchemaError extends Error {
  constructor(public errors: ValidationError[]) {
    super("The workbook does not match the expected schema.");
    this.name = "SchemaError";
  }
}

export interface PipelineOptions {
  weights?: Weights;
  workbookName?: string;
}

function indexRow(store: Store, memberId: string): StdRow | null {
  return store.reference("Patient_Index").find((r) => r.memberId === memberId) ?? null;
}

function buildAssessments(store: Store, memberId: string): AssessmentSummary[] {
  return store.rows("11", memberId).map((row) => {
    const date = iso(row, "Date");
    const ageDays = date ? daysBetween(date, store.asOf) : null;
    const completion = row.f["Completion_Pct"] !== null && row.f["Completion_Pct"] !== undefined ? Number(row.f["Completion_Pct"]) : null;
    const respondent = row.f["Respondent"] ?? null;
    const flags: ExceptionFlag[] = [];
    if (s(row, "Quality_Flag") && /stale|old|months/i.test(s(row, "Quality_Flag"))) flags.push({ tag: "stale", note: s(row, "Quality_Flag") });
    if (respondent && !/^(n\/a|-)$/i.test(respondent)) flags.push({ tag: "self-reported", note: respondent });
    if (/\bson\b|on member's behalf/i.test(respondent ?? "")) flags.push({ tag: "unverified", note: `Answered by proxy: ${respondent}` });
    return {
      name: cell(store, row, "Assessment", { date, source: s(row, "Source_System") || undefined, flags }),
      date,
      ageDays,
      respondent,
      completionPct: completion,
      score: row.f["Score"] ?? null,
      keyResponses: row.f["Key_Responses"] ?? null,
      flags,
    };
  });
}

/** Stable fields are prefilled from source. Volatile fields stay blank, with the last known value beside them. */
function buildAssessmentFields(store: Store, memberId: string, member: { reach: ReturnType<typeof buildReachability>; sdoh: ReturnType<typeof buildSdoh>; meds: ReturnType<typeof buildMedications> }, allergies: Sourced[], pcps: Sourced[], dobs: Sourced[]): AssessmentField[] {
  const latestSdoh = (...domains: string[]): Sourced | null => {
    const items = member.sdoh.filter((i) => domains.includes(i.domain)).sort((a, b) => (b.captureDate ?? "").localeCompare(a.captureDate ?? ""));
    return items[0]?.text ?? null;
  };
  const phq = store
    .rows("11", memberId)
    .filter((r) => /PHQ/i.test(s(r, "Assessment")) && iso(r, "Date"))
    .sort((a, b) => iso(b, "Date")!.localeCompare(iso(a, "Date")!))[0];
  const reported = member.meds.rows.flatMap((m) => m.reported.map((e) => ({ ...e, label: m.label }))).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  const reportedSourced: Sourced | null = reported
    ? { value: `${reported.label}: ${reported.text}`, source: reported.source, date: reported.date, evidence: reported.evidence, flags: reported.flags }
    : null;
  const stable: AssessmentField[] = [
    { id: "dob", label: "Date of birth", kind: "stable", value: dobs[0] ?? null, previous: null },
    { id: "language", label: "Language", kind: "stable", value: member.reach.language, previous: null },
    { id: "pcp", label: "Attributed PCP", kind: "stable", value: pcps[0] ?? null, previous: null },
    { id: "allergies", label: "Allergies", kind: "stable", value: allergies[0] ?? null, previous: null },
  ];
  const volatile = (id: string, label: string, previous: Sourced | null): AssessmentField => ({ id, label, kind: "volatile", value: null, previous });
  return [
    ...stable,
    volatile("symptoms", "Current symptoms", null),
    volatile("meds_current", "Medicines actually being taken", reportedSourced),
    volatile("living", "Living situation", latestSdoh("Housing")),
    volatile("caregiver", "Who helps at home, or who depends on the member", latestSdoh("Caregiving and support")),
    volatile("falls", "Function and falls", latestSdoh("Function and falls")),
    volatile("food", "Food access", latestSdoh("Food")),
    volatile("transport", "Transportation", latestSdoh("Transportation")),
    volatile("environment", "Home environment", latestSdoh("Home environment")),
    volatile("mood", "Mood", phq ? { ...cell(store, phq, "Score", { date: iso(phq, "Date"), source: s(phq, "Assessment") }), value: `${s(phq, "Assessment")} score ${s(phq, "Score")}` } : null),
    volatile("substance_use", "Substance use since the last event", null),
    volatile("work_schedule", "Work and sleep schedule", latestSdoh("Employment")),
    volatile("phone", "Best number", member.reach.best ? { value: member.reach.best.value, source: String(member.reach.best.status.source), date: typeof member.reach.best.lastVerified.date === "string" ? member.reach.best.lastVerified.date : null, evidence: member.reach.best.evidence } : null),
    volatile("best_time", "Best time", member.reach.bestTime.value ? member.reach.bestTime : null),
    volatile("consent", "Consent", null),
    volatile("school", "School plan", null),
  ];
}

interface Assembled {
  member: Omit<MemberRecord, "priority">;
  scoreInput: ScoreInput;
  flags: QualityFlag[];
  chemo: ChemoCalendar | null;
}

function assembleMember(store: Store, memberId: string): Assembled {
  const elig = store.rows("01", memberId);
  const index = indexRow(store, memberId);
  const latestElig = elig[elig.length - 1];

  const meds = buildMedications(store, memberId);
  const reach = buildReachability(store, memberId);
  const sdoh = buildSdoh(store, memberId);
  const chemo = buildChemoCalendar(store, memberId);
  const egfr = buildEgfrTrend(store, memberId);
  const flags = detectFlags({ store, memberId, meds, reach, sdoh, chemo, egfr });
  const hasDuplicate = flags.some((f) => f.type === "possible_duplicate_profile");
  const signals = buildSignals({ store, memberId, meds, reach, chemo, egfr, hasDuplicateProfile: hasDuplicate });
  const clocks = buildClocks(store, memberId, signals, chemo);
  const changes = buildChanges(store, memberId, meds);
  const carePlan = buildCarePlan(store, memberId);
  const commitments = buildCommitments(store, memberId);
  const actions = buildActions({ store, memberId, signals, reach, meds, clocks });
  const conditions = buildConditions(store, memberId);
  const external = Boolean(detectSourceSwitch(store, memberId));
  const risk = buildRisk(store, memberId, external);
  const assessments = buildAssessments(store, memberId);
  const journey = buildJourney(store, memberId);

  /* Identity: every recorded name and DOB is kept. Nothing is merged. */
  const recordedNames = elig.map((r) => cell(store, r, "Name_As_Recorded", { source: s(r, "Source_File") || undefined, date: iso(r, "Received_Date") }));
  const dobs = elig.map((r) => {
    const dob = s(r, "DOB_As_Recorded");
    const placeholder = /-01-01$/.test(dob);
    const differs = new Set(elig.map((x) => s(x, "DOB_As_Recorded"))).size > 1;
    return cell(store, r, "DOB_As_Recorded", {
      source: s(r, "Source_File") || undefined,
      date: iso(r, "Received_Date"),
      flags: differs ? [{ tag: "conflicting", note: placeholder ? "01-01 looks like a placeholder" : "Differs from another source" }] : undefined,
    });
  });
  const uniqueBy = (list: Sourced[]) => list.filter((v, i) => list.findIndex((x) => x.value === v.value) === i);
  const name: Sourced = index
    ? cell(store, index, "Name (fictional)", { date: null, source: "Patient index" })
    : recordedNames[0] ?? missing("Eligibility file");
  const dob = latestElig ? iso(latestElig, "DOB_As_Recorded") : null;
  const age: Sourced = dob
    ? computed(ageInYears(dob, store.asOf), "Whole years from the recorded DOB to the as-of date", [ev(latestElig, "DOB_As_Recorded")], null)
    : missing("Eligibility file");
  const sex: Sourced = latestElig ? cell(store, latestElig, "Sex", { date: iso(latestElig, "Received_Date") }) : missing("Eligibility file");

  const coverage = elig.map((r) => ({
    lineOfBusiness: cell(store, r, "Line_Of_Business", { source: s(r, "Source_File") || undefined, date: iso(r, "Received_Date") }),
    product: cell(store, r, "Plan_Product", { source: s(r, "Source_File") || undefined, date: iso(r, "Received_Date") }),
    status: cell(store, r, "Elig_Status", {
      source: s(r, "Source_File") || undefined,
      date: iso(r, "Received_Date"),
      flags: /terminated/i.test(s(r, "Elig_Status")) ? [{ tag: "conflicting", note: s(r, "Quality_Flag") }] : undefined,
    }),
    start: cell(store, r, "Elig_Start", { date: iso(r, "Elig_Start") }),
    end: cell(store, r, "Elig_End", { date: iso(r, "Elig_End") }),
  }));

  const allergyRows = store.rows("06", memberId).filter((r) => s(r, "Allergies"));
  const allergyValues = uniqueBy(allergyRows.map((r) => cell(store, r, "Allergies", { date: iso(r, "Doc_Date"), source: s(r, "Doc_Type") })));
  const pcpValues = elig.map((r) =>
    cell(store, r, "Attributed_PCP", {
      source: s(r, "Source_File") || undefined,
      date: iso(r, "Received_Date"),
      flags: [
        ...(new Set(elig.map((x) => s(x, "PCP_NPI"))).size > 1 ? [{ tag: "conflicting" as const, note: "Differs across coverage files" }] : []),
        ...(/never seen/i.test(s(r, "Attributed_PCP")) ? [{ tag: "unverified" as const, note: "Never seen by the member" }] : []),
      ],
    }),
  );
  const household = latestElig ? cell(store, latestElig, "Household_Link", { date: iso(latestElig, "Received_Date"), flags: /not linked/i.test(s(latestElig, "Household_Link")) ? [{ tag: "unverified", note: "Not linked in the member file" }] : undefined }) : missing("Eligibility file");

  const duplicateFlags = flags.filter((f) => f.type === "possible_duplicate_profile");
  const duplicateBanner = duplicateFlags.length
    ? {
        title: "Possible duplicate profile",
        detail: duplicateFlags.map((f) => `${f.title}. ${f.detail}`).join(" "),
        evidence: duplicateFlags.flatMap((f) => f.evidence),
      }
    : null;

  const briefing = signals.slice(0, 4).map((sig) => {
    const first = firstSentences(sig.detail);
    // Some details open by restating the title, so skip to the sentence that adds something.
    const next = first.replace(/\.$/, "") === sig.title ? sig.detail.slice(first.length).trim() : first;
    return `${sig.title}. ${firstSentences(next)}`;
  });

  const languageGuide = reach.interpreterRequired ? `Use a ${String(reach.language.value)} interpreter. Do not use an English IVR.` : null;
  const callGuide = buildCallGuide(signals.map((sig) => ({ code: sig.code, severity: sig.severity })), languageGuide);
  const assessmentFields = buildAssessmentFields(store, memberId, { reach, sdoh, meds }, allergyValues, pcpValues, dobs);

  return {
    flags,
    chemo,
    scoreInput: { id: memberId, clocks, riskRows: store.rows("09", memberId), signals, changes: changes.items, commitments, reach },
    member: {
      id: memberId,
      name,
      recordedNames,
      dobs,
      age,
      sex,
      trigger: index ? cell(store, index, "Trigger", { date: null, source: "Patient index" }) : missing("Patient index"),
      scenario: index ? cell(store, index, "Scenario_Headline", { date: null, source: "Patient index" }) : missing("Patient index"),
      assignedCm: index ? cell(store, index, "Assigned_CM", { date: null, source: "Patient index" }) : missing("Patient index"),
      acuity: index ? cell(store, index, "Acuity", { date: null, source: "Patient index" }) : missing("Patient index"),
      coverage,
      allergies: allergyValues,
      attributedPcps: pcpValues,
      household,
      duplicateBanner,
      briefing,
      freshness: buildFreshness(store, memberId),
      reachability: reach,
      clocks,
      signals,
      changes,
      medications: meds,
      conditions: { ...conditions, egfr },
      risk,
      sdoh,
      assessments,
      carePlan,
      journey,
      actions,
      callGuide,
      assessmentFields,
      flagIds: flags.map((f) => f.id),
    },
  };
}

function toQueueRow(member: MemberRecord, flags: QualityFlag[]): QueueRow {
  const reach = member.reachability;
  const shown = member.clocks.filter((c) => clockPressure(c) > 0).slice(0, 2);
  const own = flags.filter((f) => f.memberId === member.id && f.type !== "source_flag");
  return {
    id: member.id,
    rank: member.priority.rank,
    score: member.priority.score,
    topTier: member.priority.topTier,
    topTierReasons: member.priority.topTierReasons,
    name: member.name,
    age: member.age,
    sex: member.sex,
    trigger: member.trigger,
    language: reach.language,
    interpreterRequired: reach.interpreterRequired,
    assignedCm: member.assignedCm,
    reachabilityLabel: reach.label,
    reachabilityBand: reach.band,
    drivers: member.priority.drivers,
    commitments: member.priority.commitments,
    clocks: shown,
    freshness: member.freshness,
    action: member.actions[0] ?? null,
    primaryNumber: reach.primary,
    bestContact: reach.best,
    alternatives: reach.options.filter((o) => o.kind === "phone" && o.key !== reach.primary?.key),
    callDemoted: reach.callDemoted,
    demotionReason: reach.demotionReason,
    preferredAction: reach.preferredAction,
    smsAvailable: reach.smsAvailable,
    smsReason: reach.smsReason,
    bestTime: reach.bestTime,
    lastConfirmed: reach.lastConfirmed,
    flagCount: own.length,
    severeFlagCount: own.filter((f) => f.severity === "severe").length,
    snoozeWindow: reach.best?.bestWindow?.start ?? null,
  };
}

/** Replays a real discharge row for the lowest-ranked member as if it had just arrived. */
function buildSimulatedAlert(store: Store, assembled: Assembled[], members: MemberRecord[], weights: Weights, flags: QualityFlag[]): SimulatedAlert | null {
  const ordered = [...members].sort((a, b) => b.priority.rank - a.priority.rank);
  for (const target of ordered) {
    const row = store.rows("03", target.id).filter((r) => s(r, "HL7_Event") === "A03" && isRealAlert(r)).at(-1);
    if (!row) continue;
    const input = assembled.find((a) => a.member.id === target.id)!.scoreInput;
    const simClock: Clock = {
      id: `${target.id}:simulated`,
      cls: "toc_contact",
      label: "TOC contact (simulated replay)",
      startAt: null,
      dueAt: null,
      hoursLeft: 12,
      status: "final24",
      display: "Under 24 h left (simulated)",
      detail: `Simulated: ${s(row, "Alert_ID")} replayed as if it had just arrived late, leaving under 24 hours.`,
      countedFrom: "event",
      evidence: [ev(row)],
    };
    const simChange = {
      id: `${target.id}:simulated`,
      title: `Simulated alert: ${s(row, "Event_Type")}`,
      detail: `Replay of ${s(row, "Alert_ID")}`,
      severity: "severe" as Severity,
      arrivalAt: store.asOf,
      arrivalHoursAgo: 0,
      eventAt: null,
      source: "Simulation",
      evidence: [ev(row)],
    };
    const rescored = rankMembers(
      assembled.map((a) => {
        const isTarget = a.member.id === target.id;
        const scoreInput = isTarget ? { ...a.scoreInput, clocks: [simClock, ...input.clocks], changes: [simChange, ...input.changes] } : a.scoreInput;
        const reasons = topTierReasons(scoreInput.clocks, a.scoreInput.signals);
        return { id: a.member.id, drivers: computeDrivers(scoreInput, weights), reasons, commitments: a.scoreInput.commitments };
      }),
    );
    const reordered = rescored
      .sort((a, b) => a.priority.rank - b.priority.rank)
      .map(({ id, priority }) => {
        const member = members.find((m) => m.id === id)!;
        const row2 = toQueueRow({ ...member, priority }, flags);
        return id === target.id ? { ...row2, clocks: [simClock, ...row2.clocks].slice(0, 2) } : row2;
      });
    return {
      memberId: target.id,
      memberName: String(target.name.value ?? target.id),
      alertId: s(row, "Alert_ID"),
      eventType: s(row, "Event_Type"),
      facility: s(row, "Facility"),
      evidence: [ev(row)],
      reordered,
    };
  }
  return null;
}

function buildReport(sheets: IngestedSheet[], store: Store, dataset: Dataset, flags: QualityFlag[], weights: Weights, workbookName: string): RunReport {
  const datasetSheets = sheets.filter((x) => x.info.kind === "dataset");
  const totals = {
    sheets: sheets.length,
    rows: sheets.reduce((sum, x) => sum + x.info.rows, 0),
    datasetRows: datasetSheets.reduce((sum, x) => sum + x.info.rows, 0),
    members: dataset.members.length,
    rowsWithSourceFlag: store.all.filter((r) => /^\d{2}$/.test(r.prefix) && s(r, "Quality_Flag")).length,
  };

  const flagsByType = FLAG_TYPES.map((t) => ({ ...t, count: flags.filter((f) => f.type === t.type).length }));
  const severityCount = (sev: Severity) => flags.filter((f) => f.severity === sev).length;
  const flagsBySeverity = { severe: severityCount("severe"), high: severityCount("high"), medium: severityCount("medium"), low: severityCount("low") };

  const members = dataset.members;
  const derived = [
    { label: "Cross-source signals", value: members.reduce((n, m) => n + m.signals.length, 0) },
    { label: "Clocks", value: members.reduce((n, m) => n + m.clocks.length, 0) },
    { label: "Reachability options ranked", value: members.reduce((n, m) => n + m.reachability.options.length, 0) },
    { label: "Changes since last contact", value: members.reduce((n, m) => n + m.changes.items.length, 0) },
    { label: "Medication rows compared", value: members.reduce((n, m) => n + m.medications.rows.length, 0) },
    { label: "Medication conflicts", value: members.reduce((n, m) => n + m.medications.rows.filter((r) => r.conflict).length, 0) },
    { label: "Suggested actions", value: members.reduce((n, m) => n + m.actions.length, 0) },
    { label: "Journey events", value: members.reduce((n, m) => n + m.journey.length, 0) },
    { label: "SDOH statements", value: members.reduce((n, m) => n + m.sdoh.length, 0) },
  ];

  const plantedCoverage: PlantedCoverage[] = store.reference("Planted_Imperfections").map((row) => {
    const id = s(row, "Imp_ID");
    const memberId = row.memberId ?? "";
    const expectedRules = PLANTED_EXPECTATIONS[id] ?? [];
    const own = flags.filter((f) => f.memberId === memberId);
    const missingRules = expectedRules.filter((rule) => !own.some((f) => f.type === rule));
    const matched = own.filter((f) => expectedRules.includes(f.type)).map((f) => f.id);
    return {
      id,
      memberId,
      datasets: s(row, "Dataset(s)"),
      imperfection: s(row, "Imperfection"),
      expectedRules,
      matchedFlagIds: matched,
      missingRules,
      covered: expectedRules.length > 0 && missingRules.length === 0,
      evidence: ev(row),
    };
  });

  const workbookRanks = new Map(store.reference("Monday_8am").map((r) => [r.memberId, Number(s(r, "Queue_Rank")) || null]));
  const rankAudit: RankAudit[] = [...members]
    .sort((a, b) => a.priority.rank - b.priority.rank)
    .map((m) => ({
      memberId: m.id,
      name: String(m.name.value ?? m.id),
      computedRank: m.priority.rank,
      workbookRank: workbookRanks.get(m.id) ?? null,
      topTier: m.priority.topTier,
      score: m.priority.score,
    }));

  const scoring: ScoringRow[] = [...members]
    .sort((a, b) => a.priority.rank - b.priority.rank)
    .map((m) => ({
      memberId: m.id,
      name: String(m.name.value ?? m.id),
      rank: m.priority.rank,
      topTier: m.priority.topTier,
      drivers: m.priority.drivers.map((d) => ({ key: d.key, points: d.points, weight: d.weight, reason: d.reason })),
      baseScore: m.priority.baseScore,
      score: m.priority.score,
    }));

  const warnings = [...store.warnings];
  const statedFlags = flags.filter((f) => f.type === "stated_vs_computed");
  for (const f of statedFlags) warnings.push(`${f.memberId}: ${f.title}`);
  const uncovered = plantedCoverage.filter((p) => !p.covered);
  if (uncovered.length > 0) warnings.push(`Planted imperfections not yet covered: ${uncovered.map((p) => p.id).join(", ")}`);
  if (GUARDRAILS.safetyTopTierSignals.length > 0) {
    warnings.push("Top tier includes safety signals as well as the brief's TOC rule. See docs/scoring.md.");
  }

  const stages: RunReport["stages"] = [
    {
      id: "ingest",
      name: "1. Ingest",
      description: "Read every sheet. Detect member ID and date columns. Record sheets, columns and row counts.",
      counts: [
        { label: "Sheets read", value: totals.sheets },
        { label: "Rows read", value: totals.rows },
        { label: "Dataset rows", value: totals.datasetRows },
        { label: "Sheets with a member ID column", value: sheets.filter((x) => x.info.memberIdColumn).length },
        { label: "Date columns detected", value: sheets.reduce((n, x) => n + x.info.dateColumns.length, 0) },
      ],
    },
    {
      id: "standardise",
      name: "2. Standardise",
      description: "ISO dates, trimmed text, normalised member IDs and phone numbers. Event time kept separate from arrival time. Code labels only from the workbook.",
      counts: [
        { label: "Members", value: totals.members },
        { label: "Rows with event time", value: store.all.filter((r) => r.eventAt).length },
        { label: "Rows with arrival time", value: store.all.filter((r) => r.arrivalAt).length },
        { label: "Code labels harvested", value: store.codeLabels.size },
      ],
    },
    {
      id: "quality",
      name: "3. Quality flags",
      description: "Every flag carries a member, evidence (sheet and row) and a severity.",
      counts: [
        { label: "Flags", value: flags.length },
        { label: "Rule flags", value: flags.filter((f) => f.type !== "source_flag").length },
        { label: "Source-declared flags", value: flags.filter((f) => f.type === "source_flag").length },
        { label: "Severe", value: flagsBySeverity.severe },
      ],
    },
    {
      id: "derive",
      name: "4. Derive per member",
      description: "Signals, clocks counted from event time, reachability, changes, medication comparison, priority score, next actions.",
      counts: derived,
    },
    {
      id: "output",
      name: "5. Output",
      description: "data/processed.json, generated by predev and prebuild, plus this report.",
      counts: [
        { label: "Queue rows", value: dataset.queue.length },
        { label: "Member records", value: members.length },
        { label: "Warnings", value: warnings.length },
      ],
    },
  ];

  return {
    workbookName,
    asOf: store.asOf,
    asOfSource: store.asOfSource,
    sheets: sheets.map((x) => x.info),
    totals,
    stages,
    flagsByType,
    flagsBySeverity,
    flagTotal: flags.length,
    derived,
    warnings,
    plantedCoverage,
    rankAudit,
    weights,
    scoring,
    codeLabels: [...store.codeLabels.entries()].map(([code, v]) => ({ code, label: v.label, evidence: v.evidence })),
  };
}

const TEXT_KEYS = new Set(["title", "detail", "reason", "summary", "explanation", "demotionReason", "baselineLabel", "note"]);
const readableTimes = (text: string) => text.replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/g, "$1 $2");

/** Sentences are for reading, so ISO's "T" goes. Date fields keep it, because the app parses them. */
function humanise<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) humanise(item);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (typeof item === "string" && TEXT_KEYS.has(key)) record[key] = readableTimes(item);
      else if (key === "briefing" && Array.isArray(item)) record[key] = (item as string[]).map(readableTimes);
      else humanise(item);
    }
  }
  return value;
}

/** The one pipeline function. Pure: no real clock, no disk, no network. */
export function runPipeline(workbook: WorkBook, options: PipelineOptions = {}): PipelineResult {
  const weights = options.weights ?? WEIGHTS;
  const sheets = ingest(workbook);
  const errors = validateSchema(sheets);
  if (errors.length > 0) throw new SchemaError(errors);
  const store = standardise(sheets);

  const assembled = store.memberIds.map((id) => assembleMember(store, id));
  const flags = assembled.flatMap((a) => a.flags);

  const ranked = rankMembers(
    assembled.map((a) => ({
      id: a.member.id,
      drivers: computeDrivers(a.scoreInput, weights),
      reasons: topTierReasons(a.scoreInput.clocks, a.scoreInput.signals),
      commitments: a.scoreInput.commitments,
    })),
  );
  const members: MemberRecord[] = assembled.map((a) => ({ ...a.member, priority: ranked.find((r) => r.id === a.member.id)!.priority }));
  const queue = [...members].sort((a, b) => a.priority.rank - b.priority.rank).map((m) => toQueueRow(m, flags));

  const dataset: Dataset = {
    asOf: store.asOf,
    asOfSource: store.asOfSource,
    members,
    queue,
    flags,
    simulatedAlert: buildSimulatedAlert(store, assembled, members, weights, flags),
    demo: {},
  };
  const report = buildReport(sheets, store, dataset, flags, weights, options.workbookName ?? "Uploaded workbook");
  return { dataset: humanise(dataset), report: humanise(report) };
}
