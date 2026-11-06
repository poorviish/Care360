import { THRESHOLDS } from "../config/scoring";
import { addBusinessDays, addDays, daysBetween, hoursBetween, inWindow, minutesOfDay, toMin } from "./dates";
import { GAP_LINKS, MONITORING_ORDERS, RED_FLAG_WORDS, CM_RELEVANT_WORDS, SYMPTOM_CHANNEL, findDrugs } from "./dictionaries";
import type { EgfrTrend, Evidence, FlagTypeInfo, MedicationView, QualityFlag, Reachability, SdohItem, Severity, StdRow } from "./types";
import type { ChemoCalendar } from "./derive/clinical";
import { detectSourceSwitch, findReversibleDenials } from "./derive/medications";
import { isRealAlert } from "./derive/signals";
import { ev, iso, normalisePhone, num, s, type Store } from "./standardise";

const FAIL_OUTCOME = /no answer|voicemail|hung up|not in service|refused/i;

/** Every flag type the pipeline can raise. The first six are the types the brief names. */
export const FLAG_TYPES: FlagTypeInfo[] = [
  { type: "possible_duplicate_profile", label: "Possible duplicate profile", description: "Records for one member disagree on name or date of birth, or match at low confidence.", fromBrief: true },
  { type: "conflicting_medication", label: "Conflicting medication lists", description: "Ordered, dispensed and member-reported sources disagree.", fromBrief: true },
  { type: "delayed_or_pending_claim", label: "Delayed or pending claim", description: "A claim is pended, expected but not received, absent, or arrived late.", fromBrief: true },
  { type: "bad_or_wrong_person_phone", label: "Bad or wrong-person contact", description: "A number is dead, belongs to someone else, or is otherwise unusable.", fromBrief: true },
  { type: "stale_sdoh", label: "Stale SDOH", description: "An SDOH capture is older than its domain's age limit.", fromBrief: true },
  { type: "missing_field", label: "Missing field", description: "A key field is blank, unknown, or was never captured.", fromBrief: true },
  { type: "red_flag_symptom", label: "Red-flag symptom call", description: "A symptom call with red-flag words and no later hospital event.", fromBrief: false },
  { type: "language_conflict", label: "Language conflict", description: "Sources disagree on the member's language.", fromBrief: false },
  { type: "outreach_language_mismatch", label: "Outreach in the wrong language", description: "Outreach went out with no interpreter or in English to a non-English household.", fromBrief: false },
  { type: "utr_without_interpreter", label: "Closed unable-to-reach without an interpreter", description: "A case was closed unable-to-reach though no attempt used an interpreter.", fromBrief: false },
  { type: "automated_attempts_burned", label: "Automated attempts burned", description: "Auto-dialer attempts failed on a number that does not work for this member.", fromBrief: false },
  { type: "feed_latency", label: "Feed latency", description: "A record arrived long after its event.", fromBrief: false },
  { type: "clock_from_arrival", label: "Clock would run from arrival", description: "A receipt-based clock would end later than the event-based one.", fromBrief: false },
  { type: "missing_event_on_feed", label: "Event absent from the feed", description: "An event generated no alert and is known only from another source.", fromBrief: false },
  { type: "eligibility_gap", label: "Eligibility gap", description: "Coverage was miscoded or a reinstatement arrived late.", fromBrief: false },
  { type: "alert_suppressed", label: "Alert exposed to suppression", description: "An alert predates the plan's sight of a reinstatement.", fromBrief: false },
  { type: "pended_auth", label: "Pended authorisation", description: "An authorisation has been pended beyond the limit.", fromBrief: false },
  { type: "denial_contradicted_by_labs", label: "Denial contradicted by labs", description: "A denial cites missing documentation that the plan's own labs supply.", fromBrief: false },
  { type: "unrouted_member_service", label: "Call not routed to the CM", description: "A member-services interaction never reached the CM system.", fromBrief: false },
  { type: "stale_assessment", label: "Stale assessment", description: "An assessment or screen is past its age limit, or predates a transition.", fromBrief: false },
  { type: "assessment_completion_mismatch", label: "Assessment completion mismatch", description: "Completion percentage and status disagree, or it was never completed.", fromBrief: false },
  { type: "free_text_decisive", label: "Decisive fact in free text", description: "A drug or other-coverage fact exists only as free text in an assessment.", fromBrief: false },
  { type: "proxy_respondent", label: "Proxy respondent", description: "Someone other than the member answered.", fromBrief: false },
  { type: "positive_screen_unfollowed", label: "Positive screen not followed up", description: "A positive provider-side screen has no follow-up.", fromBrief: false },
  { type: "overdue_task", label: "Overdue task", description: "An open task is past its due date.", fromBrief: false },
  { type: "source_switch", label: "Pharmacy source switch", description: "Several drugs stop on one date while fills continue elsewhere.", fromBrief: false },
  { type: "false_reason_code", label: "Refutable risk reason code", description: "A risk model cites non-adherence that outside fills contradict.", fromBrief: false },
  { type: "false_care_gap", label: "Refutable care gap", description: "A quality gap cites no fill while outside fills exist.", fromBrief: false },
  { type: "inbound_reply_siloed", label: "Inbound reply siloed", description: "A member's reply sits on a vendor platform.", fromBrief: false },
  { type: "appointment_misfit", label: "Appointment does not fit", description: "A visit falls while the member sleeps or works, or beyond ride range.", fromBrief: false },
  { type: "outreach_outside_best_time", label: "Outreach outside best time", description: "Attempts were made outside the stated window.", fromBrief: false },
  { type: "miscoded_disposition", label: "Miscoded disposition", description: "A disposition disagrees with what happened.", fromBrief: false },
  { type: "stale_utr_label", label: "Old unable-to-reach label", description: "An unable-to-reach label has outlived its expiry.", fromBrief: false },
  { type: "unassigned_referral", label: "Unassigned referral", description: "A referral has no owner.", fromBrief: false },
  { type: "device_threshold", label: "Device reading out of range", description: "A device reading crosses its threshold.", fromBrief: false },
  { type: "contact_outside_plan_record", label: "Contact outside the plan record", description: "A working contact is held only in another source.", fromBrief: false },
  { type: "address_unreliable", label: "Unreliable address", description: "The address on file differs from where the member is.", fromBrief: false },
  { type: "consent_issue", label: "Consent issue", description: "A consent is expired, absent, or held outside the plan.", fromBrief: false },
  { type: "blocked_source", label: "Blocked or absent source", description: "A record is known to exist but cannot be read.", fromBrief: false },
  { type: "diagnosis_mismatch", label: "Diagnosis upgraded by claim", description: "An ADT diagnosis and a later claim for the same stay differ.", fromBrief: false },
  { type: "close_reason_hearsay", label: "Hearsay close reason", description: "A close reason rests on hearsay or carries a stigmatising label.", fromBrief: false },
  { type: "referral_sla", label: "Referral past SLA", description: "A closed-loop referral has not been accepted.", fromBrief: false },
  { type: "unverified_appointment", label: "Unverified appointment", description: "An appointment is unverified or the member was not told.", fromBrief: false },
  { type: "attribution_mismatch", label: "Attribution mismatch", description: "The attributed PCP is never seen, or differs across files.", fromBrief: false },
  { type: "allergen_housing_unjoined", label: "Allergen and housing unjoined", description: "Sensitisation and housing exposure sit in different systems.", fromBrief: false },
  { type: "erx_not_dispensed", label: "Prescription not dispensed", description: "A prescription has a status but no fill.", fromBrief: false },
  { type: "no_clinical_trace", label: "Treatment with no clinical trace", description: "Treatment is known only from an authorisation and a schedule.", fromBrief: false },
  { type: "vendor_address_mismatch", label: "Vendor address mismatch", description: "A vendor booking differs from the member's address.", fromBrief: false },
  { type: "standing_order_inconsistent", label: "Standing order inconsistent", description: "A monitoring order continues after its drug was stopped.", fromBrief: false },
  { type: "lapsed_med_gap", label: "Lapsed drug linked to a gap", description: "A long-lapsed drug is absent from current lists and bears on a measure.", fromBrief: false },
  { type: "household_unlinked", label: "Household not linked", description: "Household members or their contacts are not linked.", fromBrief: false },
  { type: "caregiver_role_uncaptured", label: "Caregiver role not captured", description: "The member is a caregiver and this is not on record.", fromBrief: false },
  { type: "stated_vs_computed", label: "Stated value differs from the rows", description: "A value in workbook text does not match what its rows compute to.", fromBrief: false },
  { type: "measure_refreshed_before_due", label: "Measure status refreshed before due", description: "A measure shows missed though its last refresh predates the deadline.", fromBrief: false },
  { type: "source_flag", label: "Source-declared flag", description: "A Quality_Flag cell in the workbook, carried through as written.", fromBrief: false },
];

export interface QualityInput {
  store: Store;
  memberId: string;
  meds: MedicationView;
  reach: Reachability;
  sdoh: SdohItem[];
  chemo: ChemoCalendar | null;
  egfr: EgfrTrend | null;
}

/** Stage 3. Detects and records every flag for one member, with evidence and severity. */
export function detectFlags(input: QualityInput): QualityFlag[] {
  const { store, memberId, meds, reach, sdoh, chemo, egfr } = input;
  const flags: QualityFlag[] = [];
  const counters = new Map<string, number>();
  const add = (type: string, severity: Severity, title: string, detail: string, evidence: Evidence[]) => {
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    const unique = evidence.filter((e, i) => evidence.findIndex((x) => x.sheet === e.sheet && x.row === e.row && x.column === e.column) === i);
    flags.push({ id: `${type}:${memberId}:${n}`, type, memberId, severity, title, detail, evidence: unique });
  };

  const eligibility = store.rows("01", memberId);
  const contacts = store.rows("02", memberId);
  const adt = store.rows("03", memberId);
  const claims = store.rows("04", memberId);
  const fills = store.rows("05", memberId);
  const docs = store.rows("06", memberId);
  const labs = store.rows("07", memberId);
  const auths = store.rows("08", memberId);
  const risk = store.rows("09", memberId);
  const gaps = store.rows("10", memberId);
  const assessments = store.rows("11", memberId);
  const outreach = store.rows("12", memberId);
  const tasks = store.rows("13", memberId);
  const appts = store.rows("14", memberId);
  const calls = store.rows("15", memberId);
  const vendors = store.rows("16", memberId);
  const vitals = store.rows("17", memberId);
  const team = store.rows("18", memberId);
  const nonEnglish = !/^english/i.test(String(reach.language.value ?? "english"));

  /* ---- Identity ---- */
  if (eligibility.length >= 2) {
    const names = [...new Set(eligibility.map((r) => s(r, "Name_As_Recorded").toUpperCase()))];
    const dobs = [...new Set(eligibility.map((r) => s(r, "DOB_As_Recorded")))];
    if (names.length > 1 || dobs.length > 1) {
      const placeholder = dobs.some((d) => /-01-01$/.test(d));
      add(
        "possible_duplicate_profile",
        "high",
        "Two source records disagree on identity",
        `Name: ${names.join(" vs ")}. DOB: ${dobs.join(" vs ")}${placeholder ? " (01-01 looks like a placeholder)" : ""}. Nothing has been merged.`,
        eligibility.map((r) => ev(r)),
      );
    }
  }
  const lowMatch = [...adt, ...docs].filter((r) => {
    const value = num(r, "Match_Confidence");
    return value !== null && value < THRESHOLDS.matchConfidence;
  });
  if (lowMatch.length >= 2) {
    const lowest = Math.min(...lowMatch.map((r) => num(r, "Match_Confidence")!));
    const variant = lowMatch.map((r) => /'([A-Z]+)' vs '([A-Z]+)'/.exec(s(r, "Quality_Flag"))).find(Boolean);
    add(
      "possible_duplicate_profile",
      "medium",
      `${lowMatch.length} records matched at ${lowest} or below ${THRESHOLDS.matchConfidence}`,
      `${variant ? `Name variant ${variant[1]} vs ${variant[2]}. ` : ""}Clinician should confirm these are the same person. Low-confidence events are still counted, with this caveat.`,
      lowMatch.map((r) => ev(r, "Match_Confidence")),
    );
  }

  /* ---- Medication ---- */
  for (const med of meds.rows) {
    if (!med.conflict) continue;
    add("conflicting_medication", med.conflict.severity, `${med.label}: sources disagree`, med.conflict.summary, med.conflict.evidence);
  }
  for (const row of fills) {
    if (iso(row, "Fill_Date")) continue;
    const source = s(row, "Source");
    if (/surescripts|e-rx/i.test(source)) {
      const closed = /closed/i.test(s(row, "Pharmacy"));
      add("erx_not_dispensed", closed ? "severe" : "high", `${s(row, "Drug")}: no fill found`, `${source}. Pharmacy: ${s(row, "Pharmacy")}.`, [ev(row, "Rx_ID")]);
    } else if (/no claim ever/i.test(source)) {
      add("erx_not_dispensed", "medium", `${s(row, "Drug")}: prescribed, no fill found`, `${s(row, "Prescriber")}. ${source}.`, [ev(row, "Rx_ID")]);
    }
  }
  const switchHit = detectSourceSwitch(store, memberId);
  if (switchHit) {
    add(
      "source_switch",
      "high",
      `${switchHit.rows.length} drugs stop on one date with fills continuing elsewhere`,
      `PBM fills all end ${switchHit.fillDate}. Outside fills: ${switchHit.external.map((r) => `${s(r, "Rx_ID")} ${iso(r, "Fill_Date")}`).join(", ")}. The eligibility file has no other-coverage field. Treat the gap as unverified until confirmed.`,
      [...switchHit.rows, ...switchHit.external].map((r) => ev(r)),
    );
    for (const row of risk) {
      if (/adherence/i.test(s(row, "Top_Reason_Codes"))) {
        add("false_reason_code", "high", `${s(row, "Model")}: reason code is refutable`, `It cites non-adherence, which outside fills contradict. Reason codes: ${s(row, "Top_Reason_Codes")}.`, [ev(row, "Top_Reason_Codes")]);
      }
    }
    for (const row of gaps) {
      const match = /no (\w+) fill/i.exec(s(row, "Gap_Detail"));
      if (!match) continue;
      const related = meds.rows.find((m) => m.drugClass?.toLowerCase().includes(match[1].toLowerCase()));
      if (related?.active) add("false_care_gap", "high", `${s(row, "Measure_Code")} gap is refutable`, `${s(row, "Gap_Detail")}, but ${related.label} is in supply from an outside source.`, [ev(row, "Gap_Detail")]);
    }
  }
  for (const med of meds.rows) {
    const last = med.dispensed[0];
    if (!last || med.active || med.ordered.length > 0 || (last.daysPastRunout ?? 0) < THRESHOLDS.medLapsedDays) continue;
    const links = GAP_LINKS.filter((l) => l.drugClass === med.drugClass).flatMap((l) => gaps.filter((g) => l.measure.test(s(g, "Measure_Code"))));
    if (links.length === 0) continue;
    const fillRow = fills.find((r) => findDrugs(s(r, "Drug")).some((d) => d.key === med.key));
    add(
      "lapsed_med_gap",
      "medium",
      `${med.label} lapsed; linked to ${links.map((g) => s(g, "Measure_Code")).join(", ")}`,
      `Last fill ${last.date}, ${last.daysPastRunout} days past run-out, and on no current list.${fillRow && s(fillRow, "Note") ? ` History: ${s(fillRow, "Note")}` : ""}`,
      [...last.evidence, ...links.map((g) => ev(g))],
    );
  }
  for (const appt of appts) {
    const link = MONITORING_ORDERS.find((m) => m.order.test(s(appt, "Type")));
    if (!link || !/standing/i.test(s(appt, "Status"))) continue;
    const stopped = meds.rows.find((m) => m.key === link.drugKey)?.ordered.find((o) => o.status === "discontinued");
    if (stopped) add("standing_order_inconsistent", "high", `${s(appt, "Type")} continues after the drug was stopped`, `${stopped.source} lists it as discontinued. Keep the order visible until its cancellation is confirmed.`, [ev(appt), ...stopped.evidence]);
  }

  /* ---- Claims ---- */
  for (const row of claims) {
    const status = s(row, "Adjudication_Status");
    const id = s(row, "Claim_ID");
    const what = `${s(row, "Claim_Type")}${id && !id.startsWith("(") ? ` ${id}` : ""}`;
    if (/pended|pending/i.test(status)) {
      add("delayed_or_pending_claim", /pended/i.test(status) ? "high" : "medium", `Pending claim: ${what}`, `Status: ${status}. Received ${iso(row, "Received_Date") ?? "date not in source data"}.`, [ev(row, "Adjudication_Status")]);
    } else if (/not received/i.test(status)) {
      add("delayed_or_pending_claim", "medium", `Expected, not received: ${what}`, `No claim yet for service ${iso(row, "Service_Date") ?? "date not in source data"}. Absence does not mean nothing happened.`, [ev(row, "Adjudication_Status")]);
    } else if (/no claim|never a claim|no dental/i.test(status)) {
      add("delayed_or_pending_claim", "low", `No claim: ${what}`, status, [ev(row, "Adjudication_Status")]);
    }
    const lag = iso(row, "Service_Date_To") && iso(row, "Received_Date") ? daysBetween(iso(row, "Service_Date_To")!, iso(row, "Received_Date")!) : null;
    if (lag !== null && lag >= THRESHOLDS.claimLagDays) add("delayed_or_pending_claim", "low", `Late claim: ${what}`, `Arrived ${lag} days after service.`, [ev(row, "Received_Date")]);
  }

  /* ---- Contact ---- */
  for (const option of reach.options) {
    if (option.statusClass === "dead") {
      const lookup = /(\d{4}-\d{2}-\d{2})/.exec(String(option.status.value))?.[1];
      const digits = normalisePhone(option.value)?.digits;
      const after = lookup && digits ? outreach.filter((r) => normalisePhone(s(r, "Number_Or_Address_Used"))?.digits === digits && r.eventAt && toMin(r.eventAt.slice(0, 10)) >= toMin(lookup)) : [];
      add("bad_or_wrong_person_phone", option.kind === "phone" ? "severe" : "low", `${option.kind === "phone" ? "Dead number" : "Dead email"}: ${option.value}`, `${String(option.status.value)}.${after.length ? ` ${after.length} attempts on or after the lookup date.` : ""}`, [...option.evidence, ...after.map((r) => ev(r))]);
    } else if (option.statusClass === "do_not_call") {
      add("bad_or_wrong_person_phone", "low", `Do not call: ${option.value}`, String(option.status.value), option.evidence);
    }
    if (option.mislabelled) {
      add("bad_or_wrong_person_phone", "high", `Wrong-person number: ${option.value}`, `Labelled "${option.label}" but belongs to ${String(option.owner.value)}.`, option.evidence);
    }
    if (!option.ownerIsMember && option.consent.state === "none" && option.kind === "phone") {
      add("bad_or_wrong_person_phone", "medium", `No release for ${String(option.owner.value)}`, "Clinical content cannot be discussed on this number.", option.evidence);
    }
    if (!option.inPlanRecord) {
      add("contact_outside_plan_record", "high", `Working contact held outside the plan record: ${option.value}`, `${String(option.owner.value)}. ${option.label}.`, option.evidence);
    }
  }
  const autoFails = outreach.filter((r) => /automated|ivr/i.test(s(r, "Channel")) && FAIL_OUTCOME.test(s(r, "Outcome")));
  if (autoFails.length > 0) {
    add("automated_attempts_burned", "medium", `${autoFails.length} automated attempts failed`, autoFails.map((r) => `${r.eventAt}: ${s(r, "Outcome")}`).join("; "), autoFails.map((r) => ev(r)));
  }
  const lateAttempts = outreach.filter((row) => {
    if (!row.eventAt || !/phone|ivr/i.test(s(row, "Channel"))) return false;
    const digits = normalisePhone(s(row, "Number_Or_Address_Used"))?.digits;
    const option = reach.options.find((o) => o.key === digits);
    if (!option) return false;
    const minute = minutesOfDay(row.eventAt);
    if (option.avoidWindows.some((w) => inWindow(minute, w.start, w.end))) return true;
    return Boolean(option.bestWindow && !inWindow(minute, option.bestWindow.start, option.bestWindow.end));
  });
  if (lateAttempts.length > 0) {
    add("outreach_outside_best_time", lateAttempts.length >= 3 ? "high" : "medium", `${lateAttempts.length} attempts outside the stated best time`, `At ${lateAttempts.map((r) => r.eventAt!.slice(11, 16)).join(", ")}.`, lateAttempts.map((r) => ev(r, "DateTime")));
  }
  for (const row of outreach) {
    if (/coded/i.test(s(row, "Outcome")) || (/refused/i.test(s(row, "Outcome")) && /actually/i.test(s(row, "Disposition_Note")))) {
      add("miscoded_disposition", "high", `Miscoded disposition: ${s(row, "Attempt_ID")}`, `${s(row, "Outcome")}. ${s(row, "Disposition_Note")}.`, [ev(row, "Outcome")]);
    }
    if (/^replied/i.test(s(row, "Outcome"))) {
      add("inbound_reply_siloed", "high", `Member reply sits outside the CM system: ${s(row, "Attempt_ID")}`, `${s(row, "Outcome")}. ${s(row, "Disposition_Note")}.`, [ev(row, "Outcome")]);
    }
  }

  /* ---- Language ---- */
  if (reach.languageConflict) {
    add("language_conflict", "high", "Sources disagree on language", reach.languageValues.map((v) => `${v.source}: ${String(v.value)}`).join("; "), reach.languageValues.flatMap((v) => v.evidence));
  }
  if (nonEnglish) {
    const wrong = outreach.filter((r) => /^no$/i.test(s(r, "Interpreter_Used")) || /english/i.test(`${s(r, "Interpreter_Used")} ${s(r, "Channel")}`));
    if (wrong.length > 0) add("outreach_language_mismatch", "high", `${wrong.length} outreach attempts without language support`, wrong.map((r) => `${s(r, "Attempt_ID")}: ${s(r, "Channel")}`).join("; "), wrong.map((r) => ev(r)));
    for (const row of tasks) {
      if (!/utr|unable to reach/i.test(s(row, "Close_Reason"))) continue;
      const open = iso(row, "Open_Date");
      const close = iso(row, "Close_Date");
      const attempts = outreach.filter((r) => /phone/i.test(s(r, "Channel")) && r.eventAt && open && close && toMin(r.eventAt) >= toMin(open) && toMin(r.eventAt) <= toMin(close) + 1440);
      if (attempts.length > 0 && attempts.every((r) => /^no$/i.test(s(r, "Interpreter_Used")))) {
        add("utr_without_interpreter", "high", `${s(row, "Case_ID")} closed unable-to-reach with no interpreter on any attempt`, `${attempts.length} phone attempts, none with an interpreter, on a ${String(reach.language.value)}-speaking member.`, [ev(row, "Close_Reason"), ...attempts.map((r) => ev(r))]);
      }
    }
  }

  /* ---- Feeds and timing ---- */
  for (const row of adt) {
    if (!isRealAlert(row)) {
      const authHit = /snf/i.test(s(row, "Event_Type")) ? auths.find((r) => /snf/i.test(s(r, "Service_Requested"))) : undefined;
      add(
        "missing_event_on_feed",
        "high",
        `No alert: ${s(row, "Event_Type")}`,
        `${s(row, "Feed_Source")}.${authHit ? ` Stay inferred from ${s(authHit, "Auth_ID")}, valid ${iso(authHit, "Valid_From")} to ${iso(authHit, "Valid_To")}.` : ""}`,
        [ev(row), ...(authHit ? [ev(authHit)] : [])],
      );
      continue;
    }
    if (row.eventAt && row.arrivalAt) {
      const latency = hoursBetween(row.eventAt, row.arrivalAt);
      if (latency >= THRESHOLDS.feedLatencyHours) {
        add("feed_latency", latency >= THRESHOLDS.feedLatencySevereHours ? "high" : "medium", `${s(row, "Alert_ID")} arrived ${Math.round(latency * 10) / 10} h after the event`, `${s(row, "Event_Type")}, ${s(row, "Feed_Source")}.`, [ev(row, "Received_DateTime")]);
        if (s(row, "HL7_Event") === "A03") {
          const fromEvent = addBusinessDays(row.eventAt, THRESHOLDS.tocContactBusinessDays);
          const fromArrival = addBusinessDays(row.arrivalAt, THRESHOLDS.tocContactBusinessDays);
          if (fromEvent !== fromArrival) {
            const task = tasks.find((t) => /business day/i.test(s(t, "Goal_Barrier_Or_Task")));
            add("clock_from_arrival", "medium", "A receipt-based clock would run late", `Counted from the event, contact is due ${fromEvent}. Counted from arrival it would show ${fromArrival}. This app counts from the event.`, [ev(row, "Event_DateTime"), ev(row, "Received_DateTime"), ...(task ? [ev(task)] : [])]);
          }
        }
      }
    }
  }
  for (const row of calls) {
    const at = row.eventAt;
    const arrival = row.arrivalAt;
    if (at && arrival && hoursBetween(at, arrival) >= THRESHOLDS.feedLatencyHours) {
      add("feed_latency", "high", `${s(row, "Interaction_ID")} reached the CM system ${Math.round(hoursBetween(at, arrival) * 10) / 10} h later`, `${s(row, "Channel")}. ${s(row, "Received_By_CM_System")}.`, [ev(row, "Received_By_CM_System")]);
    }
    const summary = s(row, "Summary");
    if (/^n/i.test(s(row, "Routed_To_CM"))) {
      const red = RED_FLAG_WORDS.test(summary);
      const relevant = CM_RELEVANT_WORDS.test(summary);
      add("unrouted_member_service", red ? "severe" : relevant ? "high" : "medium", `${s(row, "Interaction_ID")} not routed to the CM`, `Coded "${s(row, "Reason_Category")}". ${summary}`, [ev(row, "Routed_To_CM")]);
    }
    if (at && RED_FLAG_WORDS.test(summary) && SYMPTOM_CHANNEL.test(`${s(row, "Channel")} ${s(row, "Reason_Category")}`)) {
      const later = adt.filter((r) => isRealAlert(r) && r.eventAt && toMin(r.eventAt) > toMin(at));
      if (later.length === 0) {
        const before = risk.filter((r) => iso(r, "Score_Date") && toMin(iso(r, "Score_Date")!) < toMin(at));
        add("red_flag_symptom", "severe", `Red-flag call with no later hospital event: ${s(row, "Interaction_ID")}`, `${summary} ${s(row, "Resolution")}.${before.length ? ` ${before.length} risk scores predate this call and cannot reflect it.` : ""}`, [ev(row, "Summary"), ...before.map((r) => ev(r, "Score_Date"))]);
      }
    }
  }
  for (const row of docs) {
    const date = iso(row, "Doc_Date");
    const received = iso(row, "Received_Date");
    if (date && received && daysBetween(date, received) >= THRESHOLDS.documentLagDays) {
      add("feed_latency", "medium", `${s(row, "Doc_ID")} arrived ${daysBetween(date, received)} days after the visit`, `${s(row, "Doc_Type")}, ${s(row, "Source_Organisation")}.`, [ev(row, "Received_Date")]);
    }
    if (/^\((blocked|not sent|external)\)/i.test(s(row, "Doc_ID"))) {
      add("blocked_source", "medium", `${s(row, "Doc_Type")}: ${s(row, "Doc_ID").replace(/[()]/g, "")}`, s(row, "Key_Content"), [ev(row)]);
    }
  }
  for (const row of labs) {
    const date = iso(row, "Result_Date");
    const received = iso(row, "Received_Date");
    if (date && received && daysBetween(date, received) >= THRESHOLDS.labLagDays) {
      add("feed_latency", "low", `${s(row, "Test")} arrived ${daysBetween(date, received)} days after the result`, s(row, "Source"), [ev(row, "Received_Date")]);
    }
  }

  /* ---- Eligibility ---- */
  const terminated = eligibility.find((r) => /terminated/i.test(s(r, "Elig_Status")));
  const reinstated = eligibility.find((r) => /reinstated/i.test(s(r, "Elig_Status")));
  if (terminated) {
    add("eligibility_gap", "high", "Termination that may be a suspension", `${s(terminated, "Elig_Status")}. ${s(terminated, "Note")}`, [ev(terminated, "Elig_Status")]);
  }
  if (reinstated) {
    const effective = iso(reinstated, "Elig_Start");
    const received = iso(reinstated, "Received_Date");
    if (effective && received) {
      add("eligibility_gap", "high", `Reinstatement reached the plan ${daysBetween(effective, received)} days late`, `Effective ${effective}, in the file of ${received}.`, [ev(reinstated, "Received_Date")]);
      const exposed = adt.filter((r) => isRealAlert(r) && r.eventAt && toMin(r.eventAt) >= toMin(effective) && toMin(r.eventAt) < toMin(received));
      if (exposed.length > 0) {
        add("alert_suppressed", "high", `${exposed.length} alerts predate the plan's sight of the reinstatement`, `${exposed.map((r) => `${s(r, "Alert_ID")} ${r.eventAt}`).join("; ")}. Clocks here still count from the event.`, exposed.map((r) => ev(r)));
      }
    }
  }

  /* ---- Authorisations and referrals ---- */
  for (const row of auths) {
    const requested = iso(row, "Request_Date");
    if (/pended/i.test(s(row, "Status")) && requested) {
      const hours = hoursBetween(requested, store.asOf);
      if (hours >= THRESHOLDS.pendedAuthHours) {
        add("pended_auth", "high", `${s(row, "Auth_ID")} pended ${daysBetween(requested, store.asOf)} days`, `${s(row, "Service_Requested")}. ${s(row, "Pend_Or_Denial_Reason")}. Owner: ${s(row, "Owner_Queue")}.`, [ev(row, "Status")]);
      }
    }
  }
  for (const { denial, labs: labRows } of findReversibleDenials(store, memberId)) {
    add("denial_contradicted_by_labs", "high", `${s(denial, "Auth_ID")} ${s(denial, "Status")}: the plan holds the evidence`, `${s(denial, "Pend_Or_Denial_Reason")}. Labs on file before the decision: ${labRows.map((l) => `${s(l, "Test")} ${s(l, "Value")}`).join(", ")}.`, [ev(denial, "Pend_Or_Denial_Reason"), ...labRows.map((l) => ev(l, "Value"))]);
  }
  for (const row of vendors) {
    const requested = iso(row, "Request_Date");
    if (/pending/i.test(s(row, "Status")) && requested && daysBetween(requested, store.asOf) >= THRESHOLDS.referralSlaDays) {
      add("referral_sla", "high", `${s(row, "Benefit_Or_Service")} pending ${daysBetween(requested, store.asOf)} days`, `${s(row, "Vendor_Or_Agency")}. ${s(row, "Status")}.`, [ev(row, "Status")]);
    }
    const detail = s(row, "Detail");
    const zip = /\b(\d{5})\b/.exec(detail)?.[1];
    if (zip && /address/i.test(detail) && eligibility.length > 0 && !eligibility.some((r) => s(r, "ZIP") === zip)) {
      const onFile = eligibility[0];
      const grievance = calls.filter((r) => s(r, "Grievance_ID") && /nemt|driver|ride/i.test(s(r, "Summary")));
      const trips = appts.filter((r) => /wrong address/i.test(s(r, "Quality_Flag")));
      add("vendor_address_mismatch", "high", `${s(row, "Vendor_Or_Agency")} booking differs from the member's address`, `${detail}. Member file: ${s(onFile, "Address_On_File")}, ZIP ${s(onFile, "ZIP")}. Upcoming trips affected: ${trips.length}.`, [ev(row, "Detail"), ev(onFile, "ZIP"), ...grievance.map((r) => ev(r)), ...trips.map((r) => ev(r))]);
    }
  }

  /* ---- Assessments ---- */
  const latestDischarge = adt.filter((r) => s(r, "HL7_Event") === "A03" && r.eventAt).map((r) => r.eventAt!).sort().at(-1) ?? null;
  for (const row of assessments) {
    const name = s(row, "Assessment");
    const date = iso(row, "Date");
    const completion = num(row, "Completion_Pct");
    if (date && (completion ?? 0) > 0) {
      const age = daysBetween(date, store.asOf);
      const isHra = /\bHRA\b/i.test(name);
      const limit = isHra ? THRESHOLDS.hraStaleDays : THRESHOLDS.screenStaleDays;
      const isArea = /area-level|SDOH|HRSN|PRAPARE/i.test(name);
      if (!isArea && age > limit) {
        const beforeTransition = latestDischarge ? toMin(date) < toMin(latestDischarge) : false;
        add("stale_assessment", isHra && beforeTransition ? "high" : "medium", `${name} is ${age} days old`, `Limit ${limit} days.${beforeTransition ? ` It predates the discharge of ${latestDischarge!.slice(0, 10)}; no re-assessment since.` : ""}`, [ev(row, "Date")]);
      }
    }
    if (completion !== null && completion < 100 && completion > 0 && /complete/i.test(s(row, "Score"))) {
      add("assessment_completion_mismatch", "high", `${name}: ${completion}% but marked complete`, s(row, "Score"), [ev(row, "Completion_Pct")]);
    } else if (completion === 0 && date) {
      add("assessment_completion_mismatch", "medium", `${name}: sent, not completed`, s(row, "Key_Responses"), [ev(row, "Completion_Pct")]);
    }
    const key = s(row, "Key_Responses");
    for (const segment of key.split(";")) {
      if (/'[^']+'/.test(segment) && (findDrugs(segment).length > 0 || /\bVA\b/.test(segment))) {
        add("free_text_decisive", "medium", `Decisive fact in free text: ${name}`, segment.trim(), [ev(row, "Key_Responses")]);
      }
    }
    const respondent = s(row, "Respondent");
    if (/\bson\b|\bdaughter\b|on member's behalf/i.test(respondent)) {
      add("proxy_respondent", "medium", `${name} answered by proxy`, `Respondent: ${respondent}. ${date ? `Captured ${date}.` : ""}`, [ev(row, "Respondent")]);
    }
    if (/PHQ-2/i.test(name) && (num(row, "Score") ?? 0) >= THRESHOLDS.voicePhq2PositiveAtOrAbove) {
      add("positive_screen_unfollowed", "high", `PHQ-2 of ${s(row, "Score")} not followed up`, `${s(row, "Source_System")}, ${date}. Exists only outside the plan's own store.`, [ev(row, "Score")]);
    }
    if (!date && completion === 0) {
      add("missing_field", "medium", `${name}: never completed`, key || "No capture date.", [ev(row, "Date")]);
    }
  }
  for (const item of sdoh) {
    if (item.stale) {
      add("stale_sdoh", "medium", `Stale ${item.domain}: ${item.ageDays} days old (limit ${item.thresholdDays})`, `${String(item.text.value)}. Source: ${item.assessment}.`, item.text.evidence);
    }
    if (/computed on/i.test(String(item.text.value))) {
      add("address_unreliable", "medium", "Area-level score computed on an unreliable address", String(item.text.value), item.text.evidence);
    }
  }

  /* ---- Appointments ---- */
  for (const row of appts) {
    const at = iso(row, "Appt_DateTime");
    const status = s(row, "Status");
    if (at) {
      const minute = minutesOfDay(at);
      const avoid = reach.options.flatMap((o) => o.avoidWindows).find((w) => inWindow(minute, w.start, w.end));
      if (avoid && !/completed/i.test(status)) {
        add("appointment_misfit", /no-?show/i.test(status) ? "high" : "medium", `${s(row, "Type")} at ${at.slice(11, 16)} falls in ${avoid.start} to ${avoid.end}`, `${status}. ${s(row, "Quality_Flag")}`, [ev(row, "Appt_DateTime")]);
      }
    }
    const miles = num(row, "Distance_Miles");
    if (miles !== null) {
      const radiusRow = vendors.find((v) => /radius\s+\d+/i.test(s(v, "Detail")));
      const radius = radiusRow ? Number(/radius\s+(\d+)/i.exec(s(radiusRow, "Detail"))![1]) : null;
      if (radius !== null && radiusRow && miles > radius && at && toMin(at) > toMin(store.asOf)) {
        add("appointment_misfit", "medium", `${s(row, "Type")} is ${miles} miles away, beyond the ${radius}-mile ride radius`, s(radiusRow, "Detail"), [ev(row, "Distance_Miles"), ev(radiusRow, "Detail")]);
      }
    }
    if (/unverified/i.test(status) || /never told/i.test(s(row, "Quality_Flag"))) {
      add("unverified_appointment", "medium", `${s(row, "Type")}: unverified or not known to the member`, `${status}. ${s(row, "Quality_Flag") || s(row, "Source")}`, [ev(row, "Status")]);
    }
    if (/not scheduled|never referred|^none\b/i.test(status)) {
      add("missing_field", /not scheduled/i.test(status) ? "medium" : "low", `No appointment: ${s(row, "Type")}`, `${s(row, "Provider_Facility")}. ${status}.`, [ev(row, "Status")]);
    }
  }

  /* ---- Cases and tasks ---- */
  for (const row of tasks) {
    const close = s(row, "Close_Reason");
    const closedAt = iso(row, "Close_Date");
    if (/incarcerat|\(per\s/i.test(close)) {
      add("close_reason_hearsay", "high", `${s(row, "Case_ID")} close reason rests on hearsay`, `"${close}". Do not carry this label forward.`, [ev(row, "Close_Reason")]);
    }
    if (/utr|unable to reach/i.test(close) && closedAt && daysBetween(closedAt, store.asOf) > THRESHOLDS.utrLabelExpiryDays) {
      add("stale_utr_label", "medium", `Unable-to-reach label from ${closedAt}`, `Older than ${THRESHOLDS.utrLabelExpiryDays} days. ${s(row, "Quality_Flag")}`, [ev(row, "Close_Reason")]);
    }
    if (/unassigned/i.test(s(row, "Assigned_CM"))) {
      add("unassigned_referral", "high", `${s(row, "Case_ID")} has no owner`, `${s(row, "Goal_Barrier_Or_Task")}. ${s(row, "Item_Status")}.`, [ev(row, "Assigned_CM")]);
    }
    if (/overdue/i.test(s(row, "Item_Status")) && !/closed/i.test(s(row, "Case_Status"))) {
      add("overdue_task", "high", `Overdue: ${s(row, "Goal_Barrier_Or_Task")}`, `Due ${iso(row, "Due_Date") ?? "date not in source data"}. ${s(row, "Item_Status")}.`, [ev(row, "Item_Status")]);
    }
    if (/none authored/i.test(s(row, "Goal_Barrier_Or_Task"))) {
      add("missing_field", "medium", "No goal or barrier authored", s(row, "Program"), [ev(row, "Goal_Barrier_Or_Task")]);
    }
  }

  /* ---- Devices and other missing fields ---- */
  for (const row of vitals) {
    const flag = s(row, "Flag");
    if (/^[hl]\b/i.test(flag)) {
      add("device_threshold", /urgent/i.test(flag) ? "high" : "medium", `${s(row, "Metric")} ${s(row, "Value")} (${flag})`, `${s(row, "Source")}, threshold ${s(row, "Threshold")}. Received ${iso(row, "Received_Date")}.`, [ev(row, "Value")]);
    }
    if (s(row, "Source") === "(none)") {
      add("missing_field", "low", "No device data", s(row, "Quality_Flag"), [ev(row, "Source")]);
    }
  }
  for (const row of contacts) {
    if (!/^phone/i.test(s(row, "Record_Type"))) continue;
    for (const column of ["Best_Time", "Preferred_Channel"]) {
      const value = s(row, column);
      if (value === "" || /^unknown$/i.test(value) || /^not recorded/i.test(value)) {
        add("missing_field", "low", `${column.replace("_", " ")} not captured for ${s(row, "Value")}`, value || "Blank.", [ev(row, column)]);
      }
    }
  }
  for (const row of adt) {
    if (s(row, "HL7_Event") !== "A03") continue;
    const dx = s(row, "Diagnosis_In_Alert");
    if (dx === "" || /blank/i.test(dx)) add("missing_field", "medium", `${s(row, "Alert_ID")} has no diagnosis`, `${s(row, "Event_Type")} at ${s(row, "Facility")}.`, [ev(row, "Diagnosis_In_Alert")]);
  }
  for (const row of vendors) {
    if (/flag absent/i.test(s(row, "Status"))) add("missing_field", "medium", `${s(row, "Benefit_Or_Service")}: flag missing`, s(row, "Status"), [ev(row, "Status")]);
  }
  for (const row of team) {
    if (/^\((unassigned|unknown)\)$/i.test(s(row, "Name"))) add("missing_field", "low", `${s(row, "Role")}: name not known`, s(row, "Organisation"), [ev(row, "Name")]);
  }

  /* ---- Diagnosis upgraded by a later claim ---- */
  for (const row of adt) {
    if (!isRealAlert(row) || !row.eventAt) continue;
    const adtCode = /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/.exec(s(row, "Diagnosis_In_Alert"))?.[0];
    if (!adtCode) continue;
    const facilityWord = s(row, "Facility").split(/\s+/)[0];
    const claim = claims.find((c) => {
      const date = iso(c, "Service_Date");
      return date && daysBetween(date, row.eventAt!) === 0 && s(c, "Provider_Or_Facility").includes(facilityWord);
    });
    const claimCode = claim ? /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/.exec(s(claim, "Primary_Dx_ICD10"))?.[0] : null;
    if (claim && claimCode && claimCode !== adtCode && claimCode[0] === adtCode[0] && s(row, "HL7_Event") === "A04") {
      const lag = iso(claim, "Received_Date") ? daysBetween(row.eventAt, iso(claim, "Received_Date")!) : null;
      add("diagnosis_mismatch", "high", `Claim is more specific than the alert: ${claimCode} vs ${adtCode}`, `Alert: ${s(row, "Diagnosis_In_Alert")}. Claim: ${s(claim, "Primary_Dx_ICD10")}${lag !== null ? `, arrived ${lag} days after the event` : ""}. Rules keyed to the alert's code would not have fired.`, [ev(row, "Diagnosis_In_Alert"), ev(claim, "Primary_Dx_ICD10")]);
    }
  }

  /* ---- Household, attribution, address, consent ---- */
  for (const row of eligibility) {
    if (/not linked/i.test(s(row, "Household_Link"))) add("household_unlinked", "high", "Household not linked", s(row, "Household_Link"), [ev(row, "Household_Link")]);
    if (/never seen/i.test(s(row, "Attributed_PCP"))) add("attribution_mismatch", "medium", "Attributed PCP has never seen the member", s(row, "Attributed_PCP"), [ev(row, "Attributed_PCP")]);
  }
  for (const row of contacts) {
    if (/only on sibling/i.test(s(row, "Label_In_System"))) add("household_unlinked", "high", "Working contact sits on a sibling's record", `${s(row, "Value")}: ${s(row, "Label_In_System")}.`, [ev(row, "Label_In_System")]);
    if (/caregiver/i.test(s(row, "Record_Type")) && /not recorded/i.test(s(row, "Label_In_System"))) add("caregiver_role_uncaptured", "high", "Member is a caregiver, not on record", `${s(row, "Value")}. ${s(row, "Source")}.`, [ev(row, "Value")]);
    const status = s(row, "Consent_Status");
    if (/expired/i.test(status)) add("consent_issue", "high", `${s(row, "Consent_Type")}: expired`, `${s(row, "Status")}. ${s(row, "Note")}`, [ev(row, "Consent_Status")]);
    else if (/not on file/i.test(status)) add("consent_issue", "high", `${s(row, "Consent_Type")}: held outside the plan`, status, [ev(row, "Consent_Status")]);
    else if (/none on file|not obtained/i.test(status)) add("consent_issue", "medium", `${s(row, "Consent_Type")}: ${status}`, s(row, "Quality_Flag"), [ev(row, "Consent_Status")]);
    if (/^address/i.test(s(row, "Record_Type"))) {
      const onFile = eligibility[eligibility.length - 1];
      const returned = outreach.filter((r) => /returned|undeliverable/i.test(s(r, "Outcome")));
      add("address_unreliable", "high", "Address on file differs from where the member is", `On file: ${onFile ? s(onFile, "Address_On_File") : "not in source data"}. Elsewhere: ${s(row, "Value")} (${s(row, "Source")}).${returned.length ? " Mail has come back." : ""} ${s(row, "Quality_Flag")}`, [ev(row, "Value"), ...(onFile ? [ev(onFile, "Address_On_File")] : []), ...returned.map((r) => ev(r))]);
    }
  }
  const pcpIds = [...new Set(eligibility.map((r) => s(r, "PCP_NPI")).filter(Boolean))];
  if (pcpIds.length > 1) {
    add("attribution_mismatch", "high", "PCP differs across coverage files", eligibility.map((r) => `${s(r, "Source_File")}: ${s(r, "Attributed_PCP")}`).join("; "), eligibility.map((r) => ev(r, "Attributed_PCP")));
  }
  const actualPcp = team.find((r) => /actual pcp/i.test(s(r, "Role")));
  if (actualPcp) add("attribution_mismatch", "high", "Care is delivered by someone other than the attributed PCP", `${s(actualPcp, "Name")}, ${s(actualPcp, "Organisation")}. ${s(actualPcp, "Quality_Flag")}`, [ev(actualPcp, "Name")]);

  /* ---- Insight: allergen and housing ---- */
  const allergen = labs.find((r) => /allergen/i.test(s(r, "Test")) && /pos/i.test(s(r, "Flag")));
  if (allergen) {
    const housing = [
      ...claims.filter((r) => /\bZ59\./.test(s(r, "Secondary_Dx"))),
      ...docs.filter((r) => /mold|cockroach|pests?\b/i.test(s(r, "Key_Content"))),
      ...assessments.filter((r) => /mold|cockroach|pests?\b/i.test(s(r, "Key_Responses"))),
    ];
    if (housing.length > 0) add("allergen_housing_unjoined", "high", "Allergy results and housing exposure were never joined", `${s(allergen, "Value")}, with mold or pests noted in ${housing.length} other records.`, [ev(allergen, "Value"), ...housing.map((r) => ev(r))]);
  }

  /* ---- Treatment with no clinical trace ---- */
  if (chemo) {
    const day = chemo.lastCycleAt.slice(0, 10);
    const traces = [
      ...claims.filter((r) => /not received/i.test(s(r, "Adjudication_Status")) && iso(r, "Service_Date") === day),
      ...adt.filter((r) => !isRealAlert(r) && r.eventAt?.startsWith(day)),
      ...docs.filter((r) => /not sent/i.test(s(r, "Doc_ID"))),
    ];
    if (traces.length > 0) add("no_clinical_trace", "high", "Chemo known only from the auth and the schedule", `No ADT, no claim yet, no infusion note for ${day}. Calendar derived: nadir ${chemo.nadirStart} to ${chemo.nadirEnd}.`, [...chemo.evidence, ...traces.map((r) => ev(r))]);
  }

  /* ---- Stated values that the rows do not support ---- */
  const statedCheck = (row: StdRow, column: string, stated: string, actual: string) => {
    add("stated_vs_computed", "low", `Workbook says ${stated}; rows show ${actual}`, s(row, column), [ev(row, column)]);
  };
  for (const row of contacts) {
    const text = s(row, "Quality_Flag");
    const attempts = /all (\d+) outreach attempts/i.exec(text);
    if (attempts) {
      const count = outreach.reduce((sum, r) => sum + (/x(\d+)/i.exec(s(r, "Channel")) ? Number(/x(\d+)/i.exec(s(r, "Channel"))![1]) : 1), 0);
      if (Number(attempts[1]) !== count) statedCheck(row, "Quality_Flag", `${attempts[1]} attempts`, `${count} attempts`);
    }
    const afterLookup = /(\d+) attempts dialled it after carrier lookup/i.exec(text);
    const lookup = /(\d{4}-\d{2}-\d{2})/.exec(s(row, "Status"))?.[1];
    if (afterLookup && lookup) {
      const digits = normalisePhone(s(row, "Value"))?.digits;
      const count = outreach.filter((r) => normalisePhone(s(r, "Number_Or_Address_Used"))?.digits === digits && r.eventAt && toMin(r.eventAt.slice(0, 10)) >= toMin(lookup)).length;
      if (Number(afterLookup[1]) !== count) statedCheck(row, "Quality_Flag", `${afterLookup[1]} attempts after the lookup`, `${count}`);
    }
  }
  const bpRows = vitals.filter((r) => s(r, "Metric") === "BP" && /\d+\/\d+/.test(s(r, "Value")));
  for (const row of vitals) {
    const match = /(\d+) readings .*mean (\d+)\/(\d+)/i.exec(s(row, "Note"));
    if (!match || bpRows.length === 0) continue;
    const mean = (index: number) => Math.round(bpRows.reduce((sum, r) => sum + Number(s(r, "Value").split("/")[index]), 0) / bpRows.length);
    if (Number(match[1]) !== bpRows.length || Number(match[2]) !== mean(0) || Number(match[3]) !== mean(1)) {
      statedCheck(row, "Note", `${match[1]} readings, mean ${match[2]}/${match[3]}`, `${bpRows.length} readings, mean ${mean(0)}/${mean(1)}`);
    }
  }
  for (const row of fills) {
    const match = /lapsed (\d+) months/i.exec(s(row, "Quality_Flag"));
    const fill = iso(row, "Fill_Date");
    const supply = num(row, "Days_Supply");
    if (match && fill && supply) {
      const runout = addDays(fill, supply);
      const months = Math.round((daysBetween(runout, store.asOf) / 30.44) * 10) / 10;
      if (Math.abs(months - Number(match[1])) >= 1) statedCheck(row, "Quality_Flag", `lapsed ${match[1]} months`, `${months} months past run-out`);
    }
  }
  for (const row of labs) {
    const match = /eGFR \(~\s*(\d+)\)/i.exec(s(row, "Quality_Flag"));
    if (match && egfr?.computedFromCreatinine && Math.abs(egfr.computedFromCreatinine.value - Number(match[1])) >= 1) {
      statedCheck(row, "Quality_Flag", `eGFR about ${match[1]}`, `${egfr.computedFromCreatinine.value} by CKD-EPI 2021`);
    }
  }
  for (const row of docs) {
    const match = /arrived (\d+) days after/i.exec(s(row, "Quality_Flag"));
    const date = iso(row, "Doc_Date");
    const received = iso(row, "Received_Date");
    if (match && date && received && daysBetween(date, received) !== Number(match[1])) {
      statedCheck(row, "Quality_Flag", `${match[1]} days`, `${daysBetween(date, received)} days`);
    }
  }
  if (reach.bestTime.flags?.some((f) => f.tag === "conflicting")) {
    const note = reach.bestTime.flags.find((f) => f.tag === "conflicting")!.note ?? "";
    add("stated_vs_computed", "low", `Best time conflict: record says ${String(reach.bestTime.value)}`, note, reach.bestTime.evidence);
  }
  for (const row of gaps) {
    if (!/missed/i.test(s(row, "Status"))) continue;
    const refresh = iso(row, "Last_Refresh");
    const missedOn = /missed\s+(\d{1,2})\/(\d{1,2})/i.exec(s(row, "Status"));
    const due = missedOn && refresh ? `${refresh.slice(0, 4)}-${missedOn[1].padStart(2, "0")}-${missedOn[2].padStart(2, "0")}` : iso(row, "Due_Date");
    if (refresh && due && toMin(refresh) < toMin(due)) {
      add("measure_refreshed_before_due", "low", `${s(row, "Measure_Code")} shows missed before its date`, `Last refreshed ${refresh}, deadline ${due}.`, [ev(row, "Status"), ev(row, "Last_Refresh")]);
    }
  }

  /* ---- Everything the workbook declares itself, as written ---- */
  const datasetRows = [...(store.byMember.get(memberId)?.values() ?? [])].flat();
  for (const row of datasetRows) {
    const text = s(row, "Quality_Flag");
    if (text) add("source_flag", "low", row.sheet, text, [ev(row, "Quality_Flag")]);
  }

  /* De-duplicate identical findings a member may hit twice through different rows. */
  const seen = new Set<string>();
  const unique = flags.filter((f) => {
    const key = `${f.type}|${f.title}|${f.detail}|${JSON.stringify(f.evidence)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique;
}
