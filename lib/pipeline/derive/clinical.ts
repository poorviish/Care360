import { THRESHOLDS } from "../../config/scoring";
import { addDays, ageInYears, daysBetween, toMin } from "../dates";
import { cell, ev, iso, num, s, type Store } from "../standardise";
import type { ChecklistItem, ConditionCode, DocumentedProblem, EgfrTrend, Evidence, LabRow, RiskModel, Sourced } from "../types";

/* ---------- Chemo calendar, derived from the UM auth and the oncology schedule ---------- */

export interface ChemoCalendar {
  regimenLabel: string;
  lastCycleAt: string;
  lastCycleNumber: number | null;
  dayPostChemo: number;
  nadirStart: string;
  nadirEnd: string;
  nextCycleAt: string | null;
  evidence: Evidence[];
}

export function buildChemoCalendar(store: Store, memberId: string): ChemoCalendar | null {
  const cycles = store.rows("14", memberId).filter((r) => /cycle\s*\d+/i.test(s(r, "Type")));
  const completed = cycles
    .filter((r) => /completed/i.test(s(r, "Status")) && iso(r, "Appt_DateTime"))
    .sort((a, b) => toMin(iso(b, "Appt_DateTime")!) - toMin(iso(a, "Appt_DateTime")!));
  const last = completed[0];
  if (!last) return null;
  const lastAt = iso(last, "Appt_DateTime")!;
  const lastDate = lastAt.slice(0, 10);
  const next = cycles
    .filter((r) => /scheduled/i.test(s(r, "Status")) && iso(r, "Appt_DateTime"))
    .sort((a, b) => toMin(iso(a, "Appt_DateTime")!) - toMin(iso(b, "Appt_DateTime")!))[0];
  const auth = store.rows("08", memberId).find((r) => /cycles?/i.test(s(r, "Service_Requested")) || /cycles?/i.test(s(r, "Units_Approved")));
  return {
    regimenLabel: s(last, "Type"),
    lastCycleAt: lastAt,
    lastCycleNumber: Number(/cycle\s*(\d+)/i.exec(s(last, "Type"))?.[1] ?? NaN) || null,
    dayPostChemo: daysBetween(lastDate, store.asOf),
    nadirStart: addDays(lastDate, THRESHOLDS.chemoNadirStartDay),
    nadirEnd: addDays(lastDate, THRESHOLDS.chemoNadirEndDay),
    nextCycleAt: next ? iso(next, "Appt_DateTime") : null,
    evidence: [ev(last, "Appt_DateTime"), ...(next ? [ev(next, "Appt_DateTime")] : []), ...(auth ? [ev(auth, "Service_Requested")] : [])],
  };
}

/* ---------- eGFR trend: charted values plus one recomputed from creatinine ---------- */

function ckdEpi2021(creatinine: number, age: number, female: boolean): number {
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = creatinine / kappa;
  return 142 * Math.min(ratio, 1) ** alpha * Math.max(ratio, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
}

export function buildEgfrTrend(store: Store, memberId: string): EgfrTrend | null {
  const labs = store.rows("07", memberId);
  const points: EgfrTrend["points"] = [];
  const seen = new Set<string>();
  const add = (date: string, value: number, derived: boolean, source: string, evidence: Evidence[]) => {
    if (seen.has(date)) return;
    seen.add(date);
    points.push({ date, value, derived, source, evidence });
  };
  for (const row of labs.filter((r) => /egfr/i.test(s(r, "Test")))) {
    const date = iso(row, "Result_Date");
    const value = num(row, "Value");
    if (date && value !== null) add(date, value, false, s(row, "Source"), [ev(row, "Value")]);
    const priorDate = iso(row, "Prior_Value_Date");
    const prior = num(row, "Prior_Value");
    if (priorDate && prior !== null) add(priorDate, prior, false, s(row, "Source"), [ev(row, "Prior_Value")]);
  }
  if (points.length === 0) return null;

  let fromCreatinine: EgfrTrend["computedFromCreatinine"] = null;
  const elig = store.rows("01", memberId)[0];
  const creatinineRow = labs.find((r) => /creatinine/i.test(s(r, "Test")) && !/ratio/i.test(s(r, "Test")));
  if (creatinineRow && elig) {
    const value = num(creatinineRow, "Value");
    const date = iso(creatinineRow, "Result_Date");
    const dob = iso(elig, "DOB_As_Recorded");
    if (value !== null && date && dob) {
      const egfr = Math.round(ckdEpi2021(value, ageInYears(dob, date), s(elig, "Sex") === "F"));
      add(date, egfr, true, s(creatinineRow, "Source"), [ev(creatinineRow, "Value")]);
      const stated = /~\s*(\d+)/.exec(s(creatinineRow, "Quality_Flag"));
      fromCreatinine = { value: egfr, statedInWorkbook: stated ? stated[1] : null, evidence: [ev(creatinineRow, "Value")] };
    }
  }
  points.sort((a, b) => toMin(a.date) - toMin(b.date));

  /* Least-squares slope in mL/min per year. Needs two or more points a real distance apart. */
  let slope: number | null = null;
  if (points.length >= 2) {
    const t0 = toMin(points[0].date);
    const xs = points.map((p) => (toMin(p.date) - t0) / (1440 * 365.25));
    const ys = points.map((p) => p.value);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const denominator = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
    if (denominator > 0) slope = Math.round((xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / denominator) * 10) / 10;
  }
  return { points, slopePerYear: slope, computedFromCreatinine: fromCreatinine };
}

/* ---------- Conditions ---------- */

const ICD = /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/g;

export function buildConditions(store: Store, memberId: string): { coded: ConditionCode[]; documented: DocumentedProblem[]; labs: LabRow[] } {
  const codes = new Map<string, ConditionCode>();
  const addCode = (code: string, sourced: Sourced) => {
    if (!codes.has(code)) {
      const known = store.codeLabels.get(code);
      codes.set(code, { code, label: known?.label ?? null, labelEvidence: known?.evidence ?? null, mentions: [], firstSeen: null, lastSeen: null });
    }
    const entry = codes.get(code)!;
    entry.mentions.push(sourced);
    const date = sourced.date;
    if (date) {
      if (!entry.firstSeen || date < entry.firstSeen) entry.firstSeen = date;
      if (!entry.lastSeen || date > entry.lastSeen) entry.lastSeen = date;
    }
  };
  for (const row of store.rows("04", memberId)) {
    const date = iso(row, "Service_Date");
    for (const column of ["Primary_Dx_ICD10", "Secondary_Dx"]) {
      for (const match of s(row, column).matchAll(ICD)) {
        addCode(match[0], cell(store, row, column, { date, source: `Claim ${s(row, "Claim_ID")}` }));
      }
    }
  }
  for (const row of store.rows("03", memberId)) {
    for (const match of s(row, "Diagnosis_In_Alert").matchAll(ICD)) {
      addCode(match[0], cell(store, row, "Diagnosis_In_Alert", { date: row.eventAt, source: `ADT ${s(row, "Alert_ID")}` }));
    }
  }
  const documented: DocumentedProblem[] = [];
  for (const row of store.rows("06", memberId)) {
    const problems = s(row, "Problems");
    if (!problems) continue;
    documented.push({ text: problems, source: cell(store, row, "Problems", { date: iso(row, "Doc_Date"), source: s(row, "Doc_Type") }) });
  }
  const labs: LabRow[] = store
    .rows("07", memberId)
    .slice()
    .sort((a, b) => (iso(b, "Result_Date") ?? "").localeCompare(iso(a, "Result_Date") ?? ""))
    .map((row) => {
      const flagged = /only inside|appears only/i.test(s(row, "Source")) || /not in lab feed/i.test(s(row, "Quality_Flag"));
      return {
        test: cell(store, row, "Test", { date: iso(row, "Result_Date"), source: s(row, "Source") }),
        value: cell(store, row, "Value", {
          date: iso(row, "Result_Date"),
          source: s(row, "Source"),
          flags: flagged ? [{ tag: "unverified", note: "Appears only in a faxed document, not the lab feed" }] : undefined,
        }),
        unit: row.f["Unit"] ?? null,
        refRange: row.f["Ref_Range"] ?? null,
        flag: row.f["Flag"] ?? null,
        prior: row.f["Prior_Value"] ? `${s(row, "Prior_Value")} (${iso(row, "Prior_Value_Date") ?? "date not in source data"})` : null,
      };
    });
  const seen = [...codes.values()].sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  return { coded: seen, documented, labs };
}

/* ---------- Risk models ---------- */

export function buildRisk(store: Store, memberId: string, externalFillsExist: boolean): RiskModel[] {
  return store.rows("09", memberId).map((row) => {
    const reasons = s(row, "Top_Reason_Codes")
      .split(";")
      .map((x) => x.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    const refutable = externalFillsExist ? reasons.filter((r) => /adherence/i.test(r)) : [];
    const inferred = reasons.filter((r) => /inferred/i.test(r));
    const scoredAt = iso(row, "Score_Date");
    return {
      model: cell(store, row, "Model", { date: scoredAt }),
      score: cell(store, row, "Score", { date: scoredAt, flags: refutable.length ? [{ tag: "conflicting", note: `Reason code contradicted by outside fills: ${refutable[0]}` }] : undefined }),
      tier: cell(store, row, "Tier", { date: scoredAt }),
      prior: row.f["Prior_Score"] && row.f["Prior_Score"] !== "n/a" ? `${s(row, "Prior_Score")}${iso(row, "Prior_Score_Date") ? ` (${iso(row, "Prior_Score_Date")})` : ""}` : null,
      reasons,
      refutableReasons: [...refutable, ...inferred],
      dataAsOf: iso(row, "Data_As_Of"),
      triggeredCase: row.f["Trigger_For_Case"] ?? null,
      note: row.f["Quality_Flag"] ?? null,
    };
  });
}

/* ---------- Call guide ---------- */

const GUIDE_BY_SIGNAL: Record<string, { text: string; why: string }> = {
  red_flag_symptom: { text: "Ask for the current temperature and whether the member reached the ED or the on-call line", why: "Outcome of the reported symptoms is unknown" },
  duplicate_anticoagulation: { text: "Confirm which anticoagulant is actually being taken, and ask about bleeding", why: "Sources disagree and no one has reconciled them" },
  erx_not_dispensed: { text: "Check which ordered medicines are in the home; agree a working pharmacy", why: "An e-prescription shows no fill found" },
  opioid_overdose_no_moud: { text: "Ask whether the member wants treatment restarted, and check for thoughts of self-harm", why: "Recent overdose with no recent treatment fill found" },
  consent_blocks_source: { text: "Renew the expired consent before discussing what it covers", why: "A source is blocked until consent is renewed" },
  two_controllers_none_home: { text: "Teach-back on controller versus rescue; check for a spacer", why: "Two controllers ordered, none in supply" },
  allergen_housing_joined: { text: "Ask about mold, pests and smoke in the home", why: "Allergy results and housing notes point the same way" },
  source_switch: { text: "Confirm where medicines are filled now, with doses", why: "The pharmacy gap may be a change of source, not a lapse" },
  nsaid_in_ckd: { text: "Ask about over-the-counter pain relief", why: "Reported NSAID use with reduced kidney function" },
  discharged_without_services: { text: "Ask who is helping at home and whether services have started", why: "Home services are not yet approved" },
  caregiver_role: { text: "Ask who is caring for the person the member looks after", why: "The member is a caregiver and this is not on record" },
  no_followup_booked: { text: "Offer to book the follow-up visit", why: "No follow-up is booked" },
  renewal_stale_address: { text: "Confirm the current address for the renewal packet", why: "The renewal will go to an old address" },
  life_appointment: { text: "Ask about the non-clinical appointment and whether transport is needed", why: "Missing it could interrupt care" },
};

export function buildCallGuide(signalCodes: { code: string; severity: ChecklistItem["severity"] }[], languageNote: string | null): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (languageNote) items.push({ id: "guide-language", text: languageNote, why: "Language on file differs across sources", severity: "high" });
  for (const { code, severity } of signalCodes) {
    const guide = GUIDE_BY_SIGNAL[code];
    if (guide && !items.some((i) => i.text === guide.text)) items.push({ id: `guide-${code}`, text: guide.text, why: guide.why, severity });
  }
  items.push({ id: "guide-contact", text: "Confirm the best number, the best time, and who may be spoken to", why: "Contact details decay quickly", severity: "low" });
  return items;
}
