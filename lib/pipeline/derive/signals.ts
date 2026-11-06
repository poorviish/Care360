import { THRESHOLDS } from "../../config/scoring";
import { daysBetween, toMin } from "../dates";
import { CLASS_ANTICOAGULANT, CM_RELEVANT_WORDS, RED_FLAG_WORDS, SYMPTOM_CHANNEL } from "../dictionaries";
import { ev, iso, num, s, type Store } from "../standardise";
import type { EgfrTrend, MedicationView, Reachability, Severity, Signal, StdRow } from "../types";
import type { ChemoCalendar } from "./clinical";
import { detectSourceSwitch, findReversibleDenials } from "./medications";

const SEVERITY_ORDER: Record<Severity, number> = { severe: 0, high: 1, medium: 2, low: 3 };

export const isRealAlert = (row: StdRow) => !/^\(none/i.test(s(row, "Alert_ID"));

/** The latest A03 discharge to the community (not to another facility) inside the TOC window. */
export function communityDischarges(store: Store, memberId: string): StdRow[] {
  return store
    .rows("03", memberId)
    .filter((r) => s(r, "HL7_Event") === "A03" && r.eventAt && !/skilled nursing|\bSNF\b|transfer/i.test(s(r, "Discharge_Disposition")))
    .filter((r) => daysBetween(r.eventAt!, store.asOf) <= THRESHOLDS.tocWindowDays)
    .sort((a, b) => toMin(b.eventAt!) - toMin(a.eventAt!));
}

/** A real visit (not a lab, an instruction or a court date) booked inside the follow-up window. */
export function followUpBooked(store: Store, memberId: string, dischargeAt: string): StdRow | null {
  return (
    store
      .rows("14", memberId)
      .filter((r) => {
        const at = iso(r, "Appt_DateTime");
        if (!at || toMin(at) < toMin(dischargeAt)) return false;
        if (daysBetween(dischargeAt, at) > THRESHOLDS.tocVisitDays) return false;
        if (!/scheduled|completed/i.test(s(r, "Status")) || /standing/i.test(s(r, "Status"))) return false;
        return /visit|follow-up|new patient|primary care/i.test(s(r, "Type"));
      })
      .sort((a, b) => toMin(iso(a, "Appt_DateTime")!) - toMin(iso(b, "Appt_DateTime")!))[0] ?? null
  );
}

interface SignalInput {
  store: Store;
  memberId: string;
  meds: MedicationView;
  reach: Reachability;
  chemo: ChemoCalendar | null;
  egfr: EgfrTrend | null;
  hasDuplicateProfile: boolean;
}

/** Cross-source signals: each one joins two or more datasets into a statement a nurse can act on. */
export function buildSignals({ store, memberId, meds, reach, chemo, egfr, hasDuplicateProfile }: SignalInput): Signal[] {
  const out: Signal[] = [];
  const add = (code: string, severity: Severity, clinical: boolean, title: string, detail: string, rows: StdRow[]) => {
    out.push({ code, severity, clinical, title, detail, evidence: rows.map((r) => ev(r)) });
  };
  const adt = store.rows("03", memberId);
  const realAdt = adt.filter(isRealAlert);
  const calls = store.rows("15", memberId);
  const fills = store.rows("05", memberId);
  const auths = store.rows("08", memberId);
  const appts = store.rows("14", memberId);
  const vendors = store.rows("16", memberId);
  const labs = store.rows("07", memberId);
  const claims = store.rows("04", memberId);

  /* Red-flag symptom call with no later hospital event. */
  for (const call of calls) {
    const summary = s(call, "Summary");
    const at = call.eventAt;
    if (!at || !RED_FLAG_WORDS.test(summary) || !SYMPTOM_CHANNEL.test(`${s(call, "Channel")} ${s(call, "Reason_Category")}`)) continue;
    if (daysBetween(at, store.asOf) > THRESHOLDS.redFlagRecentDays) continue;
    const later = realAdt.filter((r) => r.eventAt && toMin(r.eventAt) > toMin(at));
    if (later.length > 0) continue;
    const reading = store.rows("17", memberId).find((r) => iso(r, "Reading_Date")?.slice(0, 10) === at.slice(0, 10) && /^h/i.test(s(r, "Flag")));
    const dayNote = chemo ? ` Day ${daysBetween(chemo.lastCycleAt, at)} after chemo at the time of the call.` : "";
    add(
      "red_flag_symptom",
      "severe",
      true,
      "Red-flag symptom call, no ADT since",
      `${summary} ${s(call, "Resolution")}.${dayNote} Reported ${at}, reached the CM system ${call.arrivalAt ?? "never"}.`,
      [call, ...(reading ? [reading] : []), ...adt.filter((r) => /watch/i.test(s(r, "Alert_ID")))],
    );
  }

  /* Two anticoagulants in supply at once. */
  const anticoagulants = meds.rows.filter((m) => m.drugClass === CLASS_ANTICOAGULANT && m.conflict?.severity === "severe");
  if (anticoagulants.length >= 2) {
    const evidence = anticoagulants.flatMap((m) => m.conflict!.evidence);
    out.push({
      code: "duplicate_anticoagulation",
      severity: "severe",
      clinical: true,
      title: "Possible duplicate anticoagulation",
      detail: anticoagulants[0].conflict!.summary,
      evidence,
    });
  }

  /* Discharge joined with auths, fills and appointments. */
  const discharge = communityDischarges(store, memberId)[0];
  if (discharge?.eventAt) {
    const dischargeAt = discharge.eventAt;
    const pendedHomeHealth = auths.find((r) => /home health/i.test(s(r, "Service_Requested")) && /pended/i.test(s(r, "Status")));
    if (pendedHomeHealth) {
      const days = iso(pendedHomeHealth, "Request_Date") ? daysBetween(iso(pendedHomeHealth, "Request_Date")!, store.asOf) : null;
      add(
        "discharged_without_services",
        "high",
        true,
        "Home since discharge with no services",
        `Discharged ${dischargeAt}. ${s(pendedHomeHealth, "Auth_ID")} pended ${days ?? "?"} days: ${s(pendedHomeHealth, "Pend_Or_Denial_Reason")}.`,
        [discharge, pendedHomeHealth],
      );
    }
    if (!followUpBooked(store, memberId, dischargeAt)) {
      const fillsSince = fills.filter((r) => iso(r, "Fill_Date") && daysBetween(dischargeAt, iso(r, "Fill_Date")!) >= 0 && /^PBM$/i.test(s(r, "Source")));
      const orderedNoFill = meds.rows.filter((m) => m.dispensed.length === 0 && m.conflict && /no fill found/i.test(m.conflict.summary));
      const title =
        fillsSince.length === 0
          ? "No fill since discharge, no follow-up booked"
          : orderedNoFill.length > 0
            ? `Ordered at discharge, no fill found (${orderedNoFill.map((m) => m.label).join(", ")}); no follow-up booked`
            : "No follow-up booked after discharge";
      add("no_followup_booked", "high", true, title, `Discharge event ${dischargeAt}. No visit appears in the appointment feed since then.`, [discharge]);
    }
  }

  /* Chemo calendar derived from auth and schedule. */
  if (chemo) {
    const closeToNadir = chemo.dayPostChemo >= THRESHOLDS.chemoNadirStartDay - 2 && chemo.dayPostChemo <= THRESHOLDS.chemoNadirEndDay;
    out.push({
      code: "chemo_calendar",
      severity: closeToNadir ? "high" : "medium",
      clinical: true,
      title: `Day ${chemo.dayPostChemo} after ${chemo.regimenLabel}`,
      detail: `Derived from the UM auth and the oncology schedule. Nadir window ${chemo.nadirStart} to ${chemo.nadirEnd}. Next cycle ${chemo.nextCycleAt ?? "not in source data"}.`,
      evidence: chemo.evidence,
    });
  }

  /* e-Rx that never became a fill. */
  const notDispensed = fills.filter((r) => !iso(r, "Fill_Date") && /surescripts|e-rx/i.test(s(r, "Source")));
  if (notDispensed.length > 0) {
    const names = notDispensed.map((r) => s(r, "Drug")).join("; ");
    const closed = notDispensed.some((r) => /closed/i.test(s(r, "Pharmacy")));
    add(
      "erx_not_dispensed",
      "high",
      true,
      closed ? "e-Prescription sent to a closed pharmacy: no fill found" : "e-Prescription received, no fill found",
      `${names}. Pharmacy: ${s(notDispensed[0], "Pharmacy")}. Status: ${s(notDispensed[0], "Source")}.`,
      notDispensed,
    );
  }

  /* NEMT booked with an address that differs from the member file. */
  const elig = store.rows("01", memberId);
  for (const vendor of vendors) {
    const detail = s(vendor, "Detail");
    const zip = /\b(\d{5})\b/.exec(detail)?.[1];
    if (!zip || !/address/i.test(detail)) continue;
    if (elig.some((r) => s(r, "ZIP") === zip)) continue;
    add("vendor_address_wrong", "high", false, "Ride booked to the wrong address", `${s(vendor, "Vendor_Or_Agency")}: ${s(vendor, "Status")}. ${detail}.`, [vendor]);
  }

  /* Reversed overdose with no treatment fill since. */
  const overdoseClaim = claims.find((r) => /\bT40\.\d/.test(s(r, "Primary_Dx_ICD10")));
  const moud = meds.rows.find((m) => m.key === "buprenorphine-naloxone");
  if (overdoseClaim && moud && !moud.active) {
    const lastFill = moud.dispensed[0];
    add(
      "opioid_overdose_no_moud",
      "severe",
      true,
      "Reversed overdose, no treatment fill found since",
      `${s(overdoseClaim, "Primary_Dx_ICD10")} on ${iso(overdoseClaim, "Service_Date")} (claim arrived ${iso(overdoseClaim, "Received_Date")}). ${moud.label} last filled ${lastFill?.date ?? "not in source data"}.`,
      [overdoseClaim],
    );
  }

  /* ED frequency, counted with a caveat when matches are low. */
  const edVisits = realAdt.filter((r) => s(r, "HL7_Event") === "A04" && /\bED\b/i.test(`${s(r, "Event_Type")} ${s(r, "Facility")}`) && r.eventAt && daysBetween(r.eventAt, store.asOf) <= THRESHOLDS.edFrequentWindowDays);
  if (edVisits.length >= THRESHOLDS.edFrequentCount) {
    const low = edVisits.filter((r) => (num(r, "Match_Confidence") ?? 1) < THRESHOLDS.matchConfidence).length;
    add(
      "ed_frequent",
      "high",
      true,
      `${edVisits.length} ED visits in ${THRESHOLDS.edFrequentWindowDays} days`,
      low > 0 ? `${low} of them matched below ${THRESHOLDS.matchConfidence}: confirm they are the same person.` : "All matched above the threshold.",
      edVisits,
    );
  }

  /* Part 2 or similar consent blocking a source. */
  for (const consent of store.rows("02", memberId)) {
    if (/expired/i.test(s(consent, "Consent_Status")) && /part 2/i.test(s(consent, "Consent_Type"))) {
      add("consent_blocks_source", "high", false, "Expired consent blocks a treatment source", `${s(consent, "Consent_Type")} expired ${iso(consent, "Consent_Expiry") ?? "date not in source data"}. ${s(consent, "Note")}`, [consent]);
    }
  }

  /* Two controllers, none in supply. */
  const controllers = meds.rows.filter((m) => m.conflict && /two inhaled controllers/i.test(m.conflict.summary));
  if (controllers.length >= 2) {
    out.push({
      code: "two_controllers_none_home",
      severity: "high",
      clinical: true,
      title: "Two controllers ordered, none in supply",
      detail: `${controllers[0].conflict!.summary}${meds.amr ? ` Asthma medication ratio ${meds.amr.value} (${meds.amr.controllerUnits} controller, ${meds.amr.rescueUnits} rescue fills).` : ""}`,
      evidence: controllers[0].conflict!.evidence,
    });
  }

  /* Repeat asthma ED visits. */
  const asthmaEd = realAdt.filter((r) => s(r, "HL7_Event") === "A04" && /\bJ45/.test(s(r, "Diagnosis_In_Alert")) && r.eventAt && daysBetween(r.eventAt, store.asOf) <= 75);
  if (asthmaEd.length >= 2) {
    const urgent = claims.filter((r) => /urgent care/i.test(s(r, "Claim_Type")) && iso(r, "Service_Date") && daysBetween(iso(r, "Service_Date")!, store.asOf) <= 75);
    const bursts = meds.rows.find((m) => m.key === "prednisolone")?.dispensed.filter((d) => d.date && daysBetween(d.date, store.asOf) <= 75).length ?? 0;
    add(
      "repeat_ed_asthma",
      "high",
      true,
      `${asthmaEd.length} asthma ED visits in 75 days`,
      `Also ${urgent.length} urgent care visit visible only by claim, and ${bursts} steroid bursts.`,
      [...asthmaEd, ...urgent],
    );
  }

  /* Allergy results joined with housing evidence. */
  const allergen = labs.find((r) => /allergen/i.test(s(r, "Test")) && /pos/i.test(s(r, "Flag")));
  if (allergen) {
    const housing = [
      ...claims.filter((r) => /\bZ59\./.test(s(r, "Secondary_Dx"))),
      ...store.rows("06", memberId).filter((r) => /mold|cockroach|pests?\b/i.test(s(r, "Key_Content"))),
      ...store.rows("11", memberId).filter((r) => /mold|cockroach|pests?\b/i.test(s(r, "Key_Responses"))),
    ];
    if (housing.length > 0) {
      add("allergen_housing_joined", "medium", true, "Allergy results and housing problems point the same way", `${s(allergen, "Value")} (${iso(allergen, "Result_Date")}), with mold or pests recorded in ${housing.length} other sources.`, [allergen, ...housing]);
    }
  }

  /* Kidney function trend, including a value recomputed from outside creatinine. */
  if (egfr && egfr.slopePerYear !== null && egfr.slopePerYear <= -THRESHOLDS.egfrRapidDeclinePerYear && egfr.points.length >= 3) {
    const trail = egfr.points.map((p) => `${p.value}${p.derived ? " (derived)" : ""}`).join(", ");
    out.push({
      code: "rapid_egfr_decline",
      severity: "high",
      clinical: true,
      title: `eGFR falling about ${Math.abs(egfr.slopePerYear)} mL/min per year`,
      detail: `Values over time: ${trail}. Fitted across ${egfr.points.length} points.`,
      evidence: egfr.points.flatMap((p) => p.evidence),
    });
  }
  const latestEgfr = egfr?.points.filter((p) => !p.derived).at(-1)?.value ?? null;

  /* NSAID reported, kidney function reduced. */
  const nsaid = meds.rows.find((m) => m.drugClass === "NSAID" && m.reported.length > 0);
  if (nsaid && latestEgfr !== null && latestEgfr < THRESHOLDS.egfrCkdBelow) {
    out.push({
      code: "nsaid_in_ckd",
      severity: "high",
      clinical: true,
      title: "Reported NSAID use with reduced kidney function",
      detail: `${nsaid.reported[0].text}. Latest eGFR ${latestEgfr}. Pharmacy data cannot see over-the-counter use.`,
      evidence: nsaid.reported.flatMap((r) => r.evidence),
    });
  }

  /* Metformin above the reduced-kidney-function dose ceiling. */
  const metformin = fills.find((r) => /metformin/i.test(s(r, "Drug")) && /(\d+)\s*mg BID/i.test(s(r, "Strength_Sig")));
  if (metformin && latestEgfr !== null && latestEgfr >= 30 && latestEgfr < 45) {
    const dose = Number(/(\d+)\s*mg BID/i.exec(s(metformin, "Strength_Sig"))![1]) * 2;
    if (dose > 1000) {
      add("metformin_dose_review", "medium", true, "Metformin dose needs review", `${s(metformin, "Strength_Sig")} (${dose} mg a day) at eGFR ${latestEgfr}.`, [metformin]);
    }
  }

  /* Source switch: the adherence story does not hold. */
  const sourceSwitch = detectSourceSwitch(store, memberId);
  if (sourceSwitch) {
    add(
      "source_switch",
      "high",
      false,
      `${sourceSwitch.rows.length} drugs stopped on one date: likely a pharmacy source switch`,
      `PBM fills end ${sourceSwitch.fillDate}. ${s(sourceSwitch.external[0], "Pharmacy")} shows fills outside the PBM feed. Adherence gap is unverified until confirmed with the member.`,
      [...sourceSwitch.rows, ...sourceSwitch.external],
    );
  }

  /* Denial the plan's own labs would reverse. */
  const reversible = findReversibleDenials(store, memberId);
  if (reversible.length > 0) {
    const { denial, labs: evidenceLabs } = reversible[0];
    add(
      "denial_reversible",
      "high",
      true,
      "Plan holds the evidence that reverses a denial",
      `${s(denial, "Auth_ID")} ${s(denial, "Service_Requested")}: ${s(denial, "Pend_Or_Denial_Reason")}. On file: ${evidenceLabs.map((l) => `${s(l, "Test")} ${s(l, "Value")}`).join(", ")}.`,
      [denial, ...evidenceLabs],
    );
  }

  /* Unassigned referral. */
  for (const row of store.rows("13", memberId)) {
    if (/unassigned/i.test(s(row, "Assigned_CM"))) {
      const days = iso(row, "Open_Date") ? daysBetween(iso(row, "Open_Date")!, store.asOf) : null;
      add("referral_unassigned", "high", false, `Referral unassigned for ${days ?? "?"} days`, `${s(row, "Goal_Barrier_Or_Task")}. ${s(row, "Item_Status")}.`, [row]);
    }
  }

  /* Home BP from a vendor feed, averaged only over the rows actually present. */
  const bp = store.rows("17", memberId).filter((r) => s(r, "Metric") === "BP" && /\d+\/\d+/.test(s(r, "Value")));
  if (bp.length > 0 && bp.some((r) => /^h/i.test(s(r, "Flag")))) {
    const sys = bp.map((r) => Number(s(r, "Value").split("/")[0]));
    const dia = bp.map((r) => Number(s(r, "Value").split("/")[1]));
    const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const stated = bp.map((r) => s(r, "Note")).find((n) => /mean/i.test(n));
    add(
      "bp_device_high",
      bp.some((r) => /urgent/i.test(s(r, "Flag"))) ? "high" : "medium",
      true,
      "Home blood pressure above threshold",
      `${bp.length} readings in the workbook: mean ${mean(sys)}/${mean(dia)}, highest ${Math.max(...sys)}/${Math.max(...dia)}.${stated ? ` The source note says: "${stated}"` : ""}`,
      bp,
    );
  }

  /* Appointment missed at a time the member is known to be asleep. */
  const avoid = reach.best?.avoidWindows ?? [];
  if (avoid.length > 0) {
    const missed = appts.filter((r) => /no-?show/i.test(s(r, "Status")));
    if (missed.length > 0) {
      const hint = /(\d{2}:\d{2}) telehealth/.exec(missed.map((r) => s(r, "Quality_Flag")).join(" "))?.[0];
      add("appointment_misfit", "medium", false, "Missed visit was booked while the member sleeps", `${s(missed[0], "Type")} at ${iso(missed[0], "Appt_DateTime")}: ${s(missed[0], "Status")}.${hint ? ` Option on record: ${hint}.` : ""}`, missed);
    }
  }

  /* Caregiver role that no one has recorded. */
  const caregiverRow = store.rows("02", memberId).find((r) => /caregiver/i.test(s(r, "Record_Type")) && /not recorded/i.test(s(r, "Label_In_System")));
  if (caregiverRow) {
    add("caregiver_role", "high", false, "Member is a caregiver, not on record", `${s(caregiverRow, "Value")}. Source: ${s(caregiverRow, "Source")}.`, [caregiverRow]);
  }

  /* Recent calls that carried care-management content and never reached the CM. */
  for (const call of calls) {
    if (!/^n/i.test(s(call, "Routed_To_CM")) || !call.eventAt) continue;
    if (daysBetween(call.eventAt, store.asOf) > 14 || RED_FLAG_WORDS.test(s(call, "Summary"))) continue;
    if (!CM_RELEVANT_WORDS.test(s(call, "Summary"))) continue;
    add("unrouted_call", "medium", false, `${s(call, "Caller")} call never reached the CM`, `Coded "${s(call, "Reason_Category")}". ${s(call, "Summary")}`, [call]);
  }

  /* Standing monitoring order that outlived its drug. */
  const standing = appts.find((r) => /\bINR\b/.test(s(r, "Type")) && /standing/i.test(s(r, "Status")));
  if (standing && meds.rows.some((m) => m.key === "warfarin" && m.ordered.some((o) => o.status === "discontinued"))) {
    add("standing_order_inconsistent", "medium", false, "Standing monitoring order after the drug was stopped", `${s(standing, "Type")} on ${iso(standing, "Appt_DateTime")} continues, while a document lists the drug as discontinued. Keep visible until cancellation is confirmed.`, [standing]);
  }

  /* Referral sitting with no owner. */
  for (const vendor of vendors) {
    const requested = iso(vendor, "Request_Date");
    if (/pending/i.test(s(vendor, "Status")) && requested && daysBetween(requested, store.asOf) >= THRESHOLDS.referralSlaDays) {
      add("referral_stuck", "medium", false, `${s(vendor, "Benefit_Or_Service")} pending ${daysBetween(requested, store.asOf)} days`, `${s(vendor, "Vendor_Or_Agency")}. ${s(vendor, "Detail")}.`, [vendor]);
    }
  }

  /* Non-clinical appointment that could interrupt care. */
  for (const row of appts) {
    if (!/external/i.test(s(row, "Appt_ID")) || !iso(row, "Appt_DateTime")) continue;
    add("life_appointment", "medium", false, `${s(row, "Type")}: ${iso(row, "Appt_DateTime")!.slice(0, 10)}`, `${s(row, "Status")}. ${s(row, "Quality_Flag")}`, [row]);
  }

  /* Renewal paperwork heading to an address the member has left. */
  const lastElig = elig[elig.length - 1];
  const end = lastElig ? iso(lastElig, "Elig_End") : null;
  if (end && reach.addressUnreliable && daysBetween(store.asOf, end) > 0 && daysBetween(store.asOf, end) <= THRESHOLDS.renewalWatchDays) {
    add("renewal_stale_address", "medium", false, `Coverage renewal due ${end}, packet goes to an old address`, `Address on file: ${s(lastElig, "Address_On_File")}.`, [lastElig]);
  }

  /* Positive depression screen with no follow-up. */
  for (const row of store.rows("11", memberId)) {
    if (/PHQ-2/i.test(s(row, "Assessment")) && (num(row, "Score") ?? 0) >= THRESHOLDS.voicePhq2PositiveAtOrAbove) {
      add("positive_screen", "medium", true, `Positive PHQ-2 (${s(row, "Score")}) not followed up`, `${s(row, "Source_System")}, ${iso(row, "Date")}. ${s(row, "Quality_Flag")}`, [row]);
    }
  }

  if (hasDuplicateProfile) {
    add("identity_review", "medium", false, "Identity needs review", "Records for this member disagree or matched at low confidence. Nothing has been merged.", store.rows("01", memberId));
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
