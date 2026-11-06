import { toArrivalMin, toMin, daysBetween, hoursBetween } from "../dates";
import { cell, ev, iso, num, s, type Store } from "../standardise";
import type { AppointmentItem, AuthItem, CarePlan, CarePlanTask, CareTeamMember, CaseSummary, Commitment, GapItem, JourneyEvent, VendorItem } from "../types";
import { isRealAlert } from "./signals";

const TASK_OPEN = /open|overdue|pending/i;

export function buildCarePlan(store: Store, memberId: string): CarePlan {
  const rows = store.rows("13", memberId);
  const caseMap = new Map<string, CaseSummary>();
  for (const row of rows) {
    const id = s(row, "Case_ID");
    if (!caseMap.has(id)) {
      const closeReason = row.f["Close_Reason"] ?? null;
      caseMap.set(id, {
        id,
        status: s(row, "Case_Status"),
        program: s(row, "Program"),
        openAt: iso(row, "Open_Date"),
        closeAt: iso(row, "Close_Date"),
        closeReason,
        closeReasonFlag: closeReason && /incarcerat|\(per\s/i.test(closeReason) ? "Hearsay: do not carry forward" : closeReason && /utr|unable to reach/i.test(closeReason) ? "Review: may not reflect a true attempt" : null,
        assignedCm: row.f["Assigned_CM"] ?? null,
        acuity: row.f["Acuity"] ?? null,
        evidence: [ev(row)],
      });
    }
  }

  const tasks: CarePlanTask[] = rows
    .filter((row) => /task|goal|barrier|referral/i.test(s(row, "Item_Type")) && s(row, "Goal_Barrier_Or_Task") !== "-")
    .map((row) => {
      const due = iso(row, "Due_Date");
      const closed = /closed/i.test(s(row, "Case_Status"));
      const status = row.f["Item_Status"] ?? null;
      return {
        id: `${row.sheet}:${row.row}`,
        caseId: row.f["Case_ID"] ?? null,
        itemType: s(row, "Item_Type"),
        text: cell(store, row, "Goal_Barrier_Or_Task", { date: iso(row, "Open_Date") }),
        status,
        dueAt: due,
        overdue: Boolean(due && !closed && toArrivalMin(due) < toMin(store.asOf)) || /overdue/i.test(status ?? ""),
        open: !closed && TASK_OPEN.test(status ?? ""),
        note: row.f["Quality_Flag"] ?? row.f["Note"] ?? null,
      };
    });

  const auths: AuthItem[] = store.rows("08", memberId).map((row) => {
    const requested = iso(row, "Request_Date");
    const pended = /pended/i.test(s(row, "Status"));
    return {
      id: cell(store, row, "Auth_ID", { date: iso(row, "Decision_Date") ?? requested }),
      service: s(row, "Service_Requested"),
      status: cell(store, row, "Status", { date: iso(row, "Decision_Date") ?? requested }),
      reason: row.f["Pend_Or_Denial_Reason"] ?? null,
      validFrom: iso(row, "Valid_From"),
      validTo: iso(row, "Valid_To"),
      daysInQueue: pended && requested ? daysBetween(requested, store.asOf) : num(row, "Days_In_Queue"),
      owner: row.f["Owner_Queue"] ?? null,
      note: row.f["Quality_Flag"] ?? row.f["Note"] ?? null,
    };
  });

  const appointments: AppointmentItem[] = store
    .rows("14", memberId)
    .map((row) => {
      const at = iso(row, "Appt_DateTime");
      const flag = s(row, "Quality_Flag");
      const unverified = /unverified/i.test(s(row, "Status")) || /never told/i.test(flag);
      return {
        id: `${row.sheet}:${row.row}`,
        label: cell(store, row, "Provider_Facility", { date: row.arrivalAt, flags: unverified ? [{ tag: "unverified", note: s(row, "Status") }] : undefined }),
        type: s(row, "Type"),
        at,
        status: row.f["Status"] ?? null,
        distanceMiles: num(row, "Distance_Miles"),
        note: flag || (row.f["Note"] ?? null),
        upcoming: Boolean(at && toMin(at) >= toMin(store.asOf)),
      };
    })
    .sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));

  const gaps: GapItem[] = store.rows("10", memberId).map((row) => ({
    code: cell(store, row, "Measure_Code", { date: iso(row, "Last_Refresh") }),
    name: s(row, "Measure_Name"),
    status: row.f["Status"] ?? null,
    dueAt: iso(row, "Due_Date"),
    detail: row.f["Gap_Detail"] ?? null,
    flag: row.f["Quality_Flag"] ?? row.f["Note"] ?? null,
  }));

  const vendors: VendorItem[] = store.rows("16", memberId).map((row) => ({
    service: cell(store, row, "Benefit_Or_Service", { date: iso(row, "Request_Date") }),
    vendor: row.f["Vendor_Or_Agency"] ?? null,
    eligibility: row.f["Eligibility"] ?? null,
    status: row.f["Status"] ?? null,
    detail: row.f["Detail"] ?? null,
    flag: row.f["Quality_Flag"] ?? null,
  }));

  const careTeam: CareTeamMember[] = store.rows("18", memberId).map((row) => ({
    role: s(row, "Role"),
    name: cell(store, row, "Name", { date: iso(row, "Last_Contact") }),
    organisation: row.f["Organisation"] ?? null,
    network: row.f["Network_Status"] ?? null,
    lastContact: row.f["Last_Contact"] ?? null,
    flag: row.f["Quality_Flag"] ?? null,
  }));

  return { cases: [...caseMap.values()], tasks, auths, appointments, gaps, vendors, careTeam };
}

/** The list behind the Open commitments driver. Items that restate one another are skipped. */
export function buildCommitments(store: Store, memberId: string): Commitment[] {
  const out: Commitment[] = [];
  const add = (label: string, overdue: boolean, row: Parameters<typeof ev>[0]) => out.push({ label, overdue, evidence: [ev(row)] });

  const tasks = store.rows("13", memberId).filter((r) => !/closed/i.test(s(r, "Case_Status")) && /^(task|referral)/i.test(s(r, "Item_Type")));
  for (const row of tasks) {
    const status = s(row, "Item_Status");
    const due = iso(row, "Due_Date");
    const overdue = /overdue/i.test(status) || Boolean(due && toArrivalMin(due) < toMin(store.asOf));
    add(s(row, "Goal_Barrier_Or_Task"), overdue, row);
  }
  const hasVisitTask = tasks.some((r) => /visit/i.test(s(r, "Goal_Barrier_Or_Task")));

  for (const row of store.rows("08", memberId)) {
    const status = s(row, "Status");
    if (/pended/i.test(status)) {
      const requested = iso(row, "Request_Date");
      add(`${s(row, "Auth_ID")} pended`, Boolean(requested && hoursBetween(requested, store.asOf) >= 48), row);
    } else if (/pending/i.test(status)) {
      add(`${s(row, "Service_Requested")}: pending`, false, row);
    } else if (/approved/i.test(status) && /no confirmation/i.test(s(row, "Quality_Flag"))) {
      add(`${s(row, "Service_Requested")}: delivery unconfirmed`, false, row);
    }
  }
  for (const row of store.rows("14", memberId)) {
    const status = s(row, "Status");
    if (/not scheduled/i.test(status) && !hasVisitTask) add(`${s(row, "Type")}: not scheduled`, false, row);
    if (/no-?show/i.test(status) && /no reschedule/i.test(s(row, "Quality_Flag"))) add(`${s(row, "Type")}: no-show, not rebooked`, false, row);
  }
  for (const row of store.rows("15", memberId)) {
    if (s(row, "Grievance_ID") && /opened/i.test(s(row, "Resolution")) && !/appeal/i.test(s(row, "Resolution"))) add(`Grievance ${s(row, "Grievance_ID")} open`, false, row);
  }
  for (const row of store.rows("16", memberId)) {
    const status = s(row, "Status");
    const requested = iso(row, "Request_Date");
    if (/pending acceptance/i.test(status)) add(`${s(row, "Benefit_Or_Service")}: pending acceptance`, Boolean(requested && daysBetween(requested, store.asOf) >= 7), row);
    else if (/no-?show/i.test(status)) add(`${s(row, "Benefit_Or_Service")}: booking to fix`, false, row);
    else if (/not activated/i.test(status) && /asked/i.test(s(row, "Quality_Flag"))) add(`${s(row, "Benefit_Or_Service")}: asked for, not activated`, false, row);
  }
  for (const row of store.rows("05", memberId)) {
    if (iso(row, "Fill_Date")) continue;
    if (/surescripts|e-rx|no claim ever/i.test(s(row, "Source"))) add(`${s(row, "Drug")}: no fill found`, false, row);
  }
  return out;
}

/** Journey timeline: event time and arrival time stay separate, and absences are shown as such. */
export function buildJourney(store: Store, memberId: string): JourneyEvent[] {
  const out: JourneyEvent[] = [];
  const asOfMin = toMin(store.asOf);
  const label = (prefix: string) => store.sheetLabels.get(prefix) ?? prefix;

  for (const row of store.rows("03", memberId)) {
    if (!row.eventAt) continue;
    const real = isRealAlert(row);
    if (!real && /watch/i.test(s(row, "Alert_ID"))) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Acute",
      label: s(row, "Event_Type"),
      detail: `${s(row, "Facility")}. ${s(row, "Diagnosis_In_Alert") || "No diagnosis in alert"}. ${s(row, "Feed_Source")}.`,
      eventAt: row.eventAt,
      endAt: null,
      arrivalAt: row.arrivalAt,
      latencyHours: row.arrivalAt ? Math.round(((toMin(row.arrivalAt) - toMin(row.eventAt)) / 60) * 10) / 10 : null,
      status: real ? "ok" : "gap",
      source: label("03"),
      evidence: [ev(row, "Event_DateTime")],
    });
  }
  for (const row of store.rows("08", memberId)) {
    const from = iso(row, "Valid_From");
    const to = iso(row, "Valid_To");
    if (/snf/i.test(s(row, "Service_Requested")) && from && to) {
      out.push({
        id: `${row.sheet}:${row.row}:stay`,
        lane: "Acute",
        label: `Stay inferred from ${s(row, "Auth_ID")}`,
        detail: `${s(row, "Service_Requested")}, ${from} to ${to}. No ADT covers this admission.`,
        eventAt: from,
        endAt: to,
        arrivalAt: iso(row, "Decision_Date"),
        latencyHours: null,
        status: "inferred",
        source: label("08"),
        evidence: [ev(row, "Valid_From")],
      });
    }
    const requested = iso(row, "Request_Date");
    if (requested) {
      const pended = /pended/i.test(s(row, "Status"));
      out.push({
        id: `${row.sheet}:${row.row}`,
        lane: "Authorisations",
        label: `${s(row, "Auth_ID")}: ${s(row, "Status")}`,
        detail: s(row, "Service_Requested"),
        eventAt: requested,
        endAt: null,
        arrivalAt: iso(row, "Decision_Date"),
        latencyHours: null,
        status: pended ? "pending" : "ok",
        source: label("08"),
        evidence: [ev(row, "Status")],
      });
    }
  }
  for (const row of store.rows("04", memberId)) {
    const date = iso(row, "Service_Date");
    if (!date) continue;
    const status = s(row, "Adjudication_Status");
    const pending = /pended|pending/i.test(status);
    const expected = /not received|no claim|never a claim/i.test(status);
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Claims",
      label: `${s(row, "Claim_Type")}: ${status}`,
      detail: `${s(row, "Provider_Or_Facility")}. ${s(row, "Primary_Dx_ICD10") || "No diagnosis"}. ${s(row, "Claim_ID")}.`,
      eventAt: date,
      endAt: iso(row, "Service_Date_To") !== date ? iso(row, "Service_Date_To") : null,
      arrivalAt: iso(row, "Received_Date"),
      latencyHours: iso(row, "Received_Date") ? daysBetween(iso(row, "Service_Date_To") ?? date, iso(row, "Received_Date")!) * 24 : null,
      status: pending ? "pending" : expected ? "expected" : "ok",
      source: label("04"),
      evidence: [ev(row, "Adjudication_Status")],
    });
  }
  for (const row of store.rows("05", memberId)) {
    const date = iso(row, "Fill_Date");
    if (!date) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Pharmacy",
      label: `Fill: ${s(row, "Drug")}`,
      detail: `${s(row, "Pharmacy")}. ${s(row, "Source")}.`,
      eventAt: date,
      endAt: null,
      arrivalAt: iso(row, "Received_Date"),
      latencyHours: iso(row, "Received_Date") ? daysBetween(date, iso(row, "Received_Date")!) * 24 : null,
      status: "ok",
      source: label("05"),
      evidence: [ev(row, "Fill_Date")],
    });
  }
  for (const row of store.rows("06", memberId)) {
    const date = iso(row, "Doc_Date");
    if (!date || s(row, "Doc_ID").startsWith("(")) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Labs and documents",
      label: s(row, "Doc_Type"),
      detail: `${s(row, "Source_Organisation")}. ${s(row, "Key_Content")}`,
      eventAt: date,
      endAt: null,
      arrivalAt: iso(row, "Received_Date"),
      latencyHours: iso(row, "Received_Date") ? daysBetween(date, iso(row, "Received_Date")!) * 24 : null,
      status: "ok",
      source: label("06"),
      evidence: [ev(row, "Doc_Date")],
    });
  }
  for (const row of store.rows("07", memberId)) {
    const date = iso(row, "Result_Date");
    if (!date) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Labs and documents",
      label: `${s(row, "Test")}: ${s(row, "Value")} ${s(row, "Unit")}`.trim(),
      detail: s(row, "Source"),
      eventAt: date,
      endAt: null,
      arrivalAt: iso(row, "Received_Date"),
      latencyHours: iso(row, "Received_Date") ? daysBetween(date, iso(row, "Received_Date")!) * 24 : null,
      status: "ok",
      source: label("07"),
      evidence: [ev(row, "Value")],
    });
  }
  for (const row of store.rows("12", memberId)) {
    if (!row.eventAt) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Contact",
      label: `${s(row, "Channel")}: ${s(row, "Outcome")}`,
      detail: `${s(row, "Number_Or_Address_Used")}. ${s(row, "Program")}.`,
      eventAt: row.eventAt,
      endAt: null,
      arrivalAt: null,
      latencyHours: null,
      status: "ok",
      source: label("12"),
      evidence: [ev(row, "Outcome")],
    });
  }
  for (const row of store.rows("15", memberId)) {
    if (!row.eventAt) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Contact",
      label: `${s(row, "Caller")}: ${s(row, "Reason_Category")}`,
      detail: s(row, "Summary"),
      eventAt: row.eventAt,
      endAt: null,
      arrivalAt: row.arrivalAt,
      latencyHours: row.arrivalAt ? Math.round(((toMin(row.arrivalAt) - toMin(row.eventAt)) / 60) * 10) / 10 : null,
      status: /^n/i.test(s(row, "Routed_To_CM")) ? "gap" : "ok",
      source: label("15"),
      evidence: [ev(row, "Summary")],
    });
  }
  for (const row of store.rows("14", memberId)) {
    const at = iso(row, "Appt_DateTime");
    if (!at) continue;
    out.push({
      id: `${row.sheet}:${row.row}`,
      lane: "Appointments",
      label: `${s(row, "Type")}: ${s(row, "Status")}`,
      detail: s(row, "Provider_Facility"),
      eventAt: at,
      endAt: null,
      arrivalAt: iso(row, "Received_Date"),
      latencyHours: null,
      status: toMin(at) > asOfMin ? "future" : "ok",
      source: label("14"),
      evidence: [ev(row, "Appt_DateTime")],
    });
  }
  return out.sort((a, b) => toMin(a.eventAt) - toMin(b.eventAt));
}
