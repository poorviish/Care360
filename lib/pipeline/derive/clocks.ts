import { DEADLINE, GUARDRAILS, THRESHOLDS } from "../../config/scoring";
import { addBusinessDays, addDays, dateOnly, daysBetween, formatDuration, hasTime, toArrivalMin, toMin, fromMin } from "../dates";
import { ev, iso, s, type Store } from "../standardise";
import type { Clock, ClockClass, ClockStatus, Evidence, Signal } from "../types";
import { communityDischarges, followUpBooked } from "./signals";
import type { ChemoCalendar } from "./clinical";
import { isSuccessfulContact } from "./reachability";

const hoursLeft = (due: string, asOf: string) => (toArrivalMin(due) - toMin(asOf)) / 60;

function statusFor(hours: number): ClockStatus {
  if (hours <= 0) return "breached";
  if (hours <= GUARDRAILS.tocFinalHours) return "final24";
  return "running";
}

/** How much a clock counts towards the Deadline driver. Used to pick the clocks shown first. */
export function clockPressure(clock: Pick<Clock, "cls" | "hoursLeft" | "status">): number {
  if (clock.status === "met" || clock.status === "info" || clock.hoursLeft === null) return 0;
  const weight = DEADLINE.classWeight[clock.cls];
  const remaining = Math.max(0, clock.hoursLeft);
  const step = DEADLINE.urgency.find((u) => remaining <= u.maxHours);
  return (step ? step.value : DEADLINE.urgencyBeyond) * weight;
}

const CLASS_ORDER: ClockClass[] = ["safety", "toc_contact", "toc_visit", "task", "toc_window", "appointment", "measure", "admin", "info"];

/** Timed deadlines show hours; date-only deadlines show days, so no false precision is implied. */
export function clockText(clock: Pick<Clock, "hoursLeft" | "status" | "dueAt" | "detail">, asOf: string): string {
  if (clock.status === "met") return "Met";
  if (clock.hoursLeft === null || !clock.dueAt) return clock.detail;
  if (hasTime(clock.dueAt)) {
    return clock.hoursLeft <= 0 ? `Breached ${formatDuration(clock.hoursLeft)} ago` : `${formatDuration(clock.hoursLeft)} left`;
  }
  const days = daysBetween(asOf, clock.dueAt);
  if (days < 0) return `Overdue ${-days} d`;
  return days === 0 ? "Due today" : `${days} d left`;
}

/**
 * Stage 4b. Transition-of-care clocks count from the EVENT, never from arrival. The discharge
 * must be to the community and inside the TOC window, and a successful contact stops the clock.
 */
export function buildClocks(store: Store, memberId: string, signals: Signal[], chemo: ChemoCalendar | null): Clock[] {
  const clocks: Clock[] = [];
  const asOf = store.asOf;
  const push = (id: string, cls: ClockClass, label: string, startAt: string | null, dueAt: string | null, detail: string, evidence: Evidence[], extra: Partial<Clock> = {}) => {
    const hours = dueAt ? hoursLeft(dueAt, asOf) : null;
    clocks.push({
      id: `${memberId}:${id}`,
      cls,
      label,
      startAt,
      dueAt,
      hoursLeft: hours === null ? null : Math.round(hours * 100) / 100,
      status: hours === null ? "info" : statusFor(hours),
      display: "",
      detail,
      countedFrom: "event",
      evidence,
      ...extra,
    });
  };

  /* ---- Safety clocks, from signals ---- */
  const redFlag = signals.find((sig) => sig.code === "red_flag_symptom");
  if (redFlag) {
    const call = store.rows("15", memberId).find((r) => redFlag.evidence.some((e) => e.sheet === r.sheet && e.row === r.row));
    if (call?.eventAt) {
      const due = fromMin(toMin(call.eventAt) + GUARDRAILS.redFlagTriageHours * 60);
      push("redflag", "safety", "Same-hour triage of red-flag call", call.eventAt, due, `Reported ${call.eventAt}, reached the CM system ${call.arrivalAt ?? "never"}. Outcome not in source data.`, redFlag.evidence);
    }
  }
  const duplicate = signals.find((sig) => sig.code === "duplicate_anticoagulation");
  if (duplicate) {
    const pad = String(GUARDRAILS.sameDayCutoffHour).padStart(2, "0");
    push("medrec", "safety", "Same-day medication reconciliation", asOf, `${dateOnly(asOf)}T${pad}:00`, "Rule: two anticoagulants in supply make reconciliation a same-day task, whatever the quality measure allows.", duplicate.evidence, { countedFrom: "as-of" });
  }

  /* ---- Transition-of-care clocks ---- */
  const discharges = communityDischarges(store, memberId);
  const contacts = store.rows("12", memberId).filter(isSuccessfulContact);
  const contactAfter = (at: string) => contacts.find((r) => r.eventAt && toMin(r.eventAt) > toMin(at));
  const tocTasks = store.rows("13", memberId).filter((r) => /business day/i.test(s(r, "Goal_Barrier_Or_Task")));
  discharges.forEach((row, index) => {
    const event = row.eventAt!;
    const facility = `${s(row, "Event_Type")}, ${s(row, "Facility")}`;
    const contactDue = addBusinessDays(event, THRESHOLDS.tocContactBusinessDays);
    const arrivalDue = row.arrivalAt ? addBusinessDays(row.arrivalAt, THRESHOLDS.tocContactBusinessDays) : null;
    const delay = row.arrivalAt ? Math.round(((toMin(row.arrivalAt) - toMin(event)) / 60) * 10) / 10 : null;
    const met = contactAfter(event);
    const id = `toc-contact-${index}`;
    const label = index === 0 ? `TOC contact within ${THRESHOLDS.tocContactBusinessDays} business days` : `Earlier TOC contact window (${dateOnly(event)})`;
    const evidence = [ev(row, "Event_DateTime"), ...(index === 0 ? tocTasks.map((t) => ev(t)) : [])];
    if (index === 0) {
      push(id, "toc_contact", label, event, contactDue, `${facility}. Counted from the event at ${event}${delay !== null ? `, which arrived ${delay} h later` : ""}.`, evidence, { arrivalDueAt: arrivalDue, feedDelayHours: delay });
    } else {
      // Earlier windows are history: shown, but they do not drive the score twice.
      push(id, "info", label, event, contactDue, `${facility}. Window has passed with no successful contact.`, evidence, { arrivalDueAt: arrivalDue, feedDelayHours: delay });
      clocks[clocks.length - 1].status = met ? "met" : "breached";
    }
    if (met && index === 0) {
      clocks[clocks.length - 1].status = "met";
      clocks[clocks.length - 1].detail = `Contact made ${met.eventAt}.`;
    }
    if (index === 0) {
      const booked = followUpBooked(store, memberId, event);
      push("toc-visit", "toc_visit", `Follow-up visit within ${THRESHOLDS.tocVisitDays} days`, event, addDays(event, THRESHOLDS.tocVisitDays), booked ? `Booked: ${s(booked, "Type")} on ${iso(booked, "Appt_DateTime")}.` : "No appointment exists.", [ev(row, "Event_DateTime"), ...(booked ? [ev(booked)] : [])]);
      if (booked) clocks[clocks.length - 1].status = "met";
      push("toc-30", "toc_window", `${THRESHOLDS.tocWindowDays}-day transition window`, event, addDays(event, THRESHOLDS.tocWindowDays), "Window for reconciliation and engagement measures.", [ev(row, "Event_DateTime")]);
    }
  });

  /* ---- Open tasks ---- */
  for (const row of store.rows("13", memberId)) {
    const text = s(row, "Goal_Barrier_Or_Task");
    const due = iso(row, "Due_Date");
    if (!due || /closed/i.test(s(row, "Case_Status")) || /^met$/i.test(s(row, "Item_Status"))) continue;
    // These restate the TOC clocks above, which count from the event instead.
    if (discharges.length > 0 && (/business day|within \d+ days/i.test(text))) continue;
    push(`task-${row.row}`, "task", text, iso(row, "Open_Date"), due, `${s(row, "Item_Status")}. ${s(row, "Program")}.`, [ev(row, "Due_Date")], { countedFrom: "due date" });
  }

  /* ---- Upcoming appointments within the TOC window length ---- */
  for (const row of store.rows("14", memberId)) {
    const at = iso(row, "Appt_DateTime");
    if (!at || toMin(at) < toMin(asOf) || daysBetween(asOf, at) > THRESHOLDS.tocWindowDays) continue;
    if (!/scheduled|instruction|unverified/i.test(s(row, "Status"))) continue;
    push(`appt-${row.row}`, "appointment", s(row, "Type"), null, at, `${s(row, "Provider_Facility")}. ${s(row, "Status")}.`, [ev(row, "Appt_DateTime")], { countedFrom: "due date" });
  }

  /* ---- Quality-measure windows ---- */
  for (const row of store.rows("10", memberId)) {
    const due = iso(row, "Due_Date");
    const status = s(row, "Status");
    if (!due || /closed|excluded/i.test(status)) continue;
    push(`gap-${row.row}`, "measure", `${s(row, "Measure_Code")} measure window`, null, due, `${status}. ${s(row, "Gap_Detail")}`, [ev(row, "Due_Date")], { countedFrom: "due date" });
    if (/missed/i.test(status) && !/open/i.test(status)) clocks[clocks.length - 1].status = "breached";
  }

  /* ---- Admin dates ---- */
  const elig = store.rows("01", memberId);
  const last = elig[elig.length - 1];
  const end = last ? iso(last, "Elig_End") : null;
  if (end && toMin(end) > toMin(asOf) && daysBetween(asOf, end) <= THRESHOLDS.renewalWatchDays) {
    push("renewal", "admin", "Coverage renewal", null, end, s(last, "Elig_Status"), [ev(last, "Elig_End")], { countedFrom: "due date" });
  }
  for (const row of store.rows("02", memberId)) {
    const expiry = iso(row, "Consent_Expiry");
    if (expiry && /expired/i.test(s(row, "Consent_Status"))) {
      push(`consent-${row.row}`, "admin", `${s(row, "Consent_Type")} expired`, null, expiry, s(row, "Quality_Flag"), [ev(row, "Consent_Expiry")], { countedFrom: "due date" });
    }
  }

  /* ---- Derived treatment window ---- */
  if (chemo) {
    push("nadir", "info", "Chemo nadir window opens", chemo.lastCycleAt, chemo.nadirStart, `Day ${chemo.dayPostChemo} after cycle at as-of. Window ${chemo.nadirStart} to ${chemo.nadirEnd}, derived from the schedule.`, chemo.evidence, { countedFrom: "due date" });
    clocks[clocks.length - 1].status = "info";
  }

  for (const clock of clocks) clock.display = clockText(clock, asOf);
  // Among equal pressure, a clock that can still be met comes before one already lost.
  const stillOpen = (c: Clock) => ((c.hoursLeft ?? 0) > 0 ? 0 : 1);
  return clocks.sort(
    (a, b) =>
      clockPressure(b) - clockPressure(a) ||
      CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) ||
      stillOpen(a) - stillOpen(b) ||
      (a.hoursLeft ?? 1e9) - (b.hoursLeft ?? 1e9),
  );
}

