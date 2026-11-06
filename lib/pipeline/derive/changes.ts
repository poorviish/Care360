import { dateOnly, hasTime, toArrivalMin, toMin, formatDuration } from "../dates";
import { CM_RELEVANT_WORDS, RED_FLAG_WORDS, findDrugs } from "../dictionaries";
import { computed, ev, iso, num, s, type Store } from "../standardise";
import type { ChangeItem, ExceptionFlag, MedicationView, Severity, Sourced, StdRow, WhatChanged } from "../types";
import { isRealAlert } from "./signals";
import { successfulContacts } from "./reachability";

const SEVERITY_ORDER: Record<Severity, number> = { severe: 0, high: 1, medium: 2, low: 3 };

/** The anchor for "what changed": last successful contact, else the open case's start. */
function baselineFor(store: Store, memberId: string): Pick<WhatChanged, "baselineType" | "baselineAt" | "baselineLabel" | "baselineEvidence"> {
  const contact = successfulContacts(store, memberId)[0];
  if (contact?.eventAt) {
    return {
      baselineType: "last_contact",
      baselineAt: contact.eventAt,
      baselineLabel: `Since the last successful contact on ${contact.eventAt.slice(0, 10)}`,
      baselineEvidence: [ev(contact, "Outcome")],
    };
  }
  const open = store
    .rows("13", memberId)
    .filter((r) => !/closed/i.test(s(r, "Case_Status")) && iso(r, "Open_Date"))
    .sort((a, b) => toMin(iso(b, "Open_Date")!) - toMin(iso(a, "Open_Date")!))[0];
  if (open) {
    return {
      baselineType: "case_open",
      baselineAt: iso(open, "Open_Date"),
      baselineLabel: `No successful contact on record, so since the case opened on ${iso(open, "Open_Date")}`,
      baselineEvidence: [ev(open, "Open_Date")],
    };
  }
  return { baselineType: "none", baselineAt: null, baselineLabel: "No successful contact and no open case in source data", baselineEvidence: [] };
}

export function buildChanges(store: Store, memberId: string, meds: MedicationView): WhatChanged {
  const baseline = baselineFor(store, memberId);
  const baselineMin = baseline.baselineAt ? toMin(baseline.baselineAt) : -Infinity;
  const asOfMin = toMin(store.asOf);
  const items: ChangeItem[] = [];
  const severeDrugs = new Set(meds.rows.filter((m) => m.conflict?.severity === "severe").map((m) => m.key));

  const add = (row: StdRow, arrivalAt: string | null, severity: Severity, title: string, detail: string, column?: string, flags?: ExceptionFlag[]) => {
    if (!arrivalAt) return;
    const arrivalMin = toArrivalMin(arrivalAt);
    if (arrivalMin <= baselineMin) return;
    const effective = Math.min(arrivalMin, asOfMin);
    if (toMin(arrivalAt) > asOfMin) return;
    items.push({
      id: `${row.sheet}:${row.row}`,
      title,
      detail,
      severity,
      arrivalAt,
      arrivalHoursAgo: Math.round(((asOfMin - effective) / 60) * 10) / 10,
      eventAt: row.eventAt,
      source: store.sheetLabels.get(row.prefix) ?? row.sheet,
      evidence: [ev(row, column)],
      ...(flags?.length ? { flags } : {}),
    });
  };

  for (const row of store.rows("03", memberId)) {
    if (!isRealAlert(row)) continue;
    const isDischarge = s(row, "HL7_Event") === "A03";
    add(row, row.arrivalAt, "high", `${s(row, "Event_Type")}: ${s(row, "Facility")}`, `Event ${row.eventAt}. ${s(row, "Diagnosis_In_Alert") || "No diagnosis"}.${isDischarge ? ` Disposition: ${s(row, "Discharge_Disposition") || "not in source data"}.` : ""}`, "Received_DateTime");
  }
  for (const row of store.rows("04", memberId)) {
    const dx = `${s(row, "Primary_Dx_ICD10")} ${s(row, "Secondary_Dx")}`;
    const severity: Severity = /\bT40\./.test(dx) ? "high" : /\bZ59\.|pended/i.test(`${dx} ${s(row, "Adjudication_Status")}`) ? "medium" : "low";
    add(row, row.arrivalAt, severity, `Claim ${s(row, "Claim_ID")}: ${s(row, "Claim_Type")}`, `${s(row, "Adjudication_Status")}. ${s(row, "Primary_Dx_ICD10") || "No diagnosis"}.`, "Received_Date");
  }
  for (const row of store.rows("05", memberId)) {
    const drugs = findDrugs(s(row, "Drug"));
    const filled = iso(row, "Fill_Date");
    const severity: Severity = drugs.some((d) => severeDrugs.has(d.key)) ? "severe" : filled ? "low" : "high";
    add(row, row.arrivalAt, severity, filled ? `Fill: ${s(row, "Drug")}` : `No fill found: ${s(row, "Drug")}`, `${s(row, "Pharmacy")}. ${s(row, "Source")}.`, "Received_Date");
  }
  for (const row of store.rows("06", memberId)) {
    if (s(row, "Doc_ID").startsWith("(")) continue;
    const drugs = findDrugs(s(row, "Medications_Listed"));
    const severity: Severity = drugs.some((d) => severeDrugs.has(d.key)) ? "severe" : /free text/i.test(s(row, "Structured_Or_Free_Text")) ? "high" : "medium";
    add(row, row.arrivalAt, severity, s(row, "Doc_Type"), `${s(row, "Source_Organisation")}, dated ${iso(row, "Doc_Date")}. ${s(row, "Key_Content")}`, "Received_Date");
  }
  for (const row of store.rows("07", memberId)) {
    const flag = s(row, "Flag");
    const severity: Severity = /^(h|l|pos)/i.test(flag) ? "medium" : "low";
    add(row, row.arrivalAt, severity, `${s(row, "Test")}: ${s(row, "Value")} ${s(row, "Unit")}`.trim(), `Result ${iso(row, "Result_Date")}. ${s(row, "Source")}.`, "Received_Date");
  }
  for (const row of store.rows("08", memberId)) {
    const status = s(row, "Status");
    const when = iso(row, "Decision_Date") ?? iso(row, "Request_Date");
    const severity: Severity = /pended|denied|upheld/i.test(status) ? "high" : "low";
    add(row, when, severity, `${s(row, "Service_Requested")}: ${status}`, s(row, "Pend_Or_Denial_Reason") || `Requested by ${s(row, "Requesting_Provider") || "not in source data"}.`, "Status");
  }
  for (const row of store.rows("09", memberId)) {
    const prior = num(row, "Prior_Score");
    const score = num(row, "Score");
    add(row, iso(row, "Score_Date"), prior !== null && score !== null && score > prior ? "medium" : "low", `${s(row, "Model")}: ${s(row, "Score")}`, `Tier ${s(row, "Tier")}. Prior ${s(row, "Prior_Score") || "not in source data"}.`, "Score");
  }
  for (const row of store.rows("11", memberId)) {
    const date = iso(row, "Date");
    if (!date) continue;
    add(row, date, "low", `${s(row, "Assessment")} captured`, `${s(row, "Respondent")}. ${s(row, "Score") || s(row, "Key_Responses")}`, "Date", s(row, "Respondent") && s(row, "Respondent") !== "n/a" ? [{ tag: "self-reported" }] : undefined);
  }
  for (const row of store.rows("12", memberId)) {
    const outcome = s(row, "Outcome");
    add(row, row.eventAt, /^replied/i.test(outcome) ? "high" : "low", `Outreach ${s(row, "Attempt_ID")}: ${s(row, "Channel")}`, outcome, "Outcome");
  }
  for (const row of store.rows("13", memberId)) {
    if (/closed/i.test(s(row, "Case_Status")) || !/^(task|referral)/i.test(s(row, "Item_Type"))) continue;
    add(row, iso(row, "Open_Date"), "low", `Case item: ${s(row, "Goal_Barrier_Or_Task")}`, `${s(row, "Program")}. ${s(row, "Item_Status")}.`, "Open_Date");
  }
  for (const row of store.rows("14", memberId)) {
    const status = s(row, "Status");
    add(row, row.arrivalAt, /no-?show/i.test(status) ? "medium" : "low", `Appointment: ${s(row, "Type")}`, `${s(row, "Provider_Facility")}, ${iso(row, "Appt_DateTime") ?? "no date"}. ${status}.`, "Status");
  }
  for (const row of store.rows("15", memberId)) {
    const summary = s(row, "Summary");
    const arrival = row.arrivalAt ?? row.eventAt;
    const severity: Severity = RED_FLAG_WORDS.test(summary) ? "severe" : CM_RELEVANT_WORDS.test(summary) ? "high" : "medium";
    add(row, arrival, severity, `${s(row, "Caller")}: ${s(row, "Reason_Category")}`, summary, "Summary", [{ tag: "unverified", note: `Routed to CM: ${s(row, "Routed_To_CM")}` }]);
  }
  for (const row of store.rows("17", memberId)) {
    const flag = s(row, "Flag");
    if (!s(row, "Metric")) continue;
    add(row, row.arrivalAt, /urgent/i.test(flag) ? "high" : /^(h|l)/i.test(flag) ? "medium" : "low", `${s(row, "Metric")}: ${s(row, "Value")} ${s(row, "Unit")}`.trim(), `${s(row, "Source")}. Reading ${iso(row, "Reading_Date")}.`, "Value");
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.arrivalHoursAgo - b.arrivalHoursAgo);
  return { ...baseline, items };
}

/** The newest arrival across every dated feed, used as the freshness stamp. */
export function buildFreshness(store: Store, memberId: string): Sourced {
  const rows = [...(store.byMember.get(memberId)?.values() ?? [])].flat();
  const asOfMin = toMin(store.asOf);
  let best: StdRow | null = null;
  let bestAt: string | null = null;
  let bestMin = -Infinity;
  for (const row of rows) {
    if (!["03", "04", "05", "06", "07", "14", "15", "17"].includes(row.prefix)) continue;
    const at = row.arrivalAt;
    if (!at || toMin(at) > asOfMin) continue;
    const min = Math.min(toArrivalMin(at), asOfMin);
    const sameDay = bestAt !== null && dateOnly(bestAt) === dateOnly(at);
    // On the same day, a real timestamp beats a date with no time.
    const better = sameDay ? hasTime(at) && (!hasTime(bestAt!) || min > bestMin) : min > bestMin;
    if (better) {
      best = row;
      bestAt = at;
      bestMin = min;
    }
  }
  if (!best || !bestAt) return { value: null, source: "Freshness", date: null, evidence: [] };
  const rule = "Newest arrival time across dated feeds, measured to the as-of time";
  if (!hasTime(bestAt)) return computed(`Newest data dated ${bestAt}`, rule, [ev(best)], bestAt);
  const age = (asOfMin - toMin(bestAt)) / 60;
  return computed(`Newest data ${age < 1 ? "under 1 h" : formatDuration(age)} old`, rule, [ev(best)], bestAt);
}

