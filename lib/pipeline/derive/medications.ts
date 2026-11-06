import { THRESHOLDS } from "../../config/scoring";
import { addDays, daysBetween, toMin } from "../dates";
import {
  CLASS_ANTICOAGULANT,
  CLASS_ICS,
  CLASS_RESCUE,
  CONTROLLER_CLASSES,
  DRUGS,
  findDrugs,
  type DrugEntry,
} from "../dictionaries";
import { ev, iso, num, s, type Store } from "../standardise";
import type { Evidence, MedConflict, MedEntry, MedicationView, MedRow, Severity, StdRow } from "../types";

const REPORT_MARKER = /'[^']{3,}'|\bper member\b|\breports?\b|\btold\b|\buses\b/i;
const GENERAL_MED_TALK = /\bmeds?\b|\bmedicine\b|\bpills?\b|\bVA\b/;

function splitSegments(text: string): string[] {
  return text
    .split(/;|\.\s+(?=[A-Z'])/)
    .map((x) => x.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A fill row may hold several drugs. Unknown drugs keep their workbook name and have no class. */
function drugsInCell(text: string): { key: string; label: string; drugClass: string | null; entry: DrugEntry | null }[] {
  const known = findDrugs(text);
  if (known.length > 0) return known.map((entry) => ({ key: entry.key, label: entry.label, drugClass: entry.drugClass, entry }));
  return [{ key: slug(text), label: text, drugClass: null, entry: null }];
}

const SEVERITY_ORDER: Record<Severity, number> = { severe: 0, high: 1, medium: 2, low: 3 };

export function buildMedications(store: Store, memberId: string): MedicationView {
  const rows = new Map<string, MedRow>();
  const generalStatements: MedEntry[] = [];
  const labContradictions = new Map<string, { text: string; evidence: Evidence }>();

  const rowFor = (key: string, label: string, drugClass: string | null): MedRow => {
    if (!rows.has(key)) rows.set(key, { key, label, drugClass, ordered: [], dispensed: [], reported: [], active: false, conflict: null });
    return rows.get(key)!;
  };

  /* Pharmacy sheet: fills are Dispensed; statuses without a fill are Ordered or Member-reported. */
  for (const row of store.rows("05", memberId)) {
    const drugText = s(row, "Drug");
    const fillDate = iso(row, "Fill_Date");
    const source = s(row, "Source");
    const sig = s(row, "Strength_Sig");
    const pharmacy = s(row, "Pharmacy");
    const parts = [sig, pharmacy].filter(Boolean).join(" · ");
    for (const d of drugsInCell(drugText)) {
      const med = rowFor(d.key, d.label, d.drugClass);
      if (fillDate) {
        const supply = num(row, "Days_Supply");
        const runoutAt = supply ? addDays(fillDate, supply) : null;
        const external = !/^PBM$/i.test(source);
        const administered = /facility claim|claim not yet|medical benefit/i.test(`${source} ${pharmacy}`);
        med.dispensed.push({
          text: parts || drugText,
          status: administered ? "administered" : "dispensed",
          source: source || "Pharmacy fills",
          date: fillDate,
          evidence: [ev(row, "Fill_Date")],
          runoutAt,
          daysPastRunout: runoutAt ? Math.max(0, daysBetween(runoutAt, store.asOf)) : null,
          external,
          flags: external ? [{ tag: "unverified", note: "Not in the PBM feed" }] : undefined,
        });
      } else if (/hra|free text|self/i.test(source)) {
        med.reported.push({
          text: parts || drugText,
          status: "reported",
          source,
          date: row.arrivalAt,
          evidence: [ev(row, "Drug")],
          flags: [{ tag: "self-reported" }],
        });
      } else {
        const rejected = /reject/i.test(source);
        med.ordered.push({
          text: parts || `Prescribed by ${s(row, "Prescriber")}`,
          status: rejected ? "rejected" : "not_dispensed",
          source: source || "Pharmacy fills",
          date: row.arrivalAt,
          evidence: [ev(row, "Rx_ID")],
        });
      }
    }
  }

  /* Clinical documents: every drug a document lists is Ordered, with that document as the source. */
  for (const row of store.rows("06", memberId)) {
    const listed = s(row, "Medications_Listed");
    if (!listed) continue;
    const date = iso(row, "Doc_Date");
    const source = s(row, "Doc_Type");
    const isPlan = /^plan:/i.test(listed);
    for (const segment of splitSegments(listed)) {
      if (/none active per patient/i.test(segment)) {
        generalStatements.push({
          text: segment,
          status: "reported",
          source,
          date,
          evidence: [ev(row, "Medications_Listed")],
          flags: [{ tag: "self-reported" }],
        });
        continue;
      }
      for (const entry of findDrugs(segment)) {
        const status: MedEntry["status"] = /discontinued/i.test(segment)
          ? "discontinued"
          : /pending/i.test(segment)
            ? "pending"
            : isPlan
              ? "planned"
              : "listed";
        rowFor(entry.key, entry.label, entry.drugClass).ordered.push({
          text: segment,
          status,
          source,
          date,
          evidence: [ev(row, "Medications_Listed")],
        });
      }
    }
  }

  /* Member-reported: mined from quoted statements in free text. Always tagged self-reported. */
  const reportSources: { rows: StdRow[]; column: string }[] = [
    { rows: store.rows("06", memberId), column: "Key_Content" },
    { rows: store.rows("11", memberId), column: "Key_Responses" },
    { rows: store.rows("03", memberId), column: "Note" },
    { rows: store.rows("12", memberId), column: "Outcome" },
    { rows: store.rows("15", memberId), column: "Summary" },
  ];
  const seen = new Set<string>();
  for (const { rows: sourceRows, column } of reportSources) {
    for (const row of sourceRows) {
      const text = s(row, column);
      if (!text) continue;
      const label = store.sheetLabels.get(row.prefix) ?? row.sheet;
      const date = row.eventAt ?? row.arrivalAt;
      const add = (key: string, drugLabel: string, drugClass: string | null, statement: string) => {
        const dedupe = `${key}|${statement}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        rowFor(key, drugLabel, drugClass).reported.push({
          text: statement,
          status: "reported",
          source: label,
          date,
          evidence: [ev(row, column)],
          flags: [{ tag: "self-reported" }, { tag: "unverified" }],
        });
      };
      if (/per member/i.test(text)) {
        for (const entry of findDrugs(text)) add(entry.key, entry.label, entry.drugClass, text);
        continue;
      }
      for (const segment of splitSegments(text)) {
        if (!REPORT_MARKER.test(segment)) continue;
        const drugs = findDrugs(segment);
        if (drugs.length > 0) {
          for (const entry of drugs) add(entry.key, entry.label, entry.drugClass, segment);
        } else if (GENERAL_MED_TALK.test(segment)) {
          const dedupe = `general|${segment}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            generalStatements.push({
              text: segment,
              status: "reported",
              source: label,
              date,
              evidence: [ev(row, column)],
              flags: [{ tag: "self-reported" }, { tag: "unverified" }],
            });
          }
        }
      }
    }
  }

  /* Toxicology that contradicts what is reported, for example "buprenorphine NEG". */
  for (const row of store.rows("07", memberId)) {
    if (!/drug screen/i.test(s(row, "Test"))) continue;
    for (const part of s(row, "Value").split(";")) {
      if (!/\bNEG\b/i.test(part)) continue;
      for (const entry of findDrugs(part)) {
        labContradictions.set(entry.key, { text: `${s(row, "Test")} on ${iso(row, "Result_Date") ?? "unknown date"}: ${part.trim()}`, evidence: ev(row, "Value") });
      }
    }
  }

  const all = [...rows.values()];
  for (const med of all) {
    med.dispensed.sort((a, b) => toMin(b.date ?? "1900-01-01") - toMin(a.date ?? "1900-01-01"));
    med.active = med.dispensed.some((d) => d.runoutAt && toMin(d.runoutAt) >= toMin(store.asOf.slice(0, 10)));
  }

  assignConflicts(all, labContradictions);

  all.sort((a, b) => {
    const sa = a.conflict ? SEVERITY_ORDER[a.conflict.severity] : 9;
    const sb = b.conflict ? SEVERITY_ORDER[b.conflict.severity] : 9;
    return sa - sb || a.label.localeCompare(b.label);
  });

  /* Asthma Medication Ratio, recomputed from fills in the as-of year. */
  const year = store.asOf.slice(0, 4);
  const countFills = (predicate: (m: MedRow) => boolean) => {
    const matched = all.filter(predicate).flatMap((m) => m.dispensed.filter((d) => d.date?.startsWith(year)));
    return { count: matched.length, evidence: matched.flatMap((d) => d.evidence) };
  };
  const controller = countFills((m) => Boolean(m.drugClass && CONTROLLER_CLASSES.includes(m.drugClass)));
  const rescue = countFills((m) => m.drugClass === CLASS_RESCUE);
  const amr =
    rescue.count + controller.count > 0 && (rescue.count > 0 || controller.count > 0)
      ? {
          value: Math.round((controller.count / (controller.count + rescue.count)) * 100) / 100,
          controllerUnits: controller.count,
          rescueUnits: rescue.count,
          evidence: [...controller.evidence, ...rescue.evidence],
        }
      : null;

  return { rows: all, generalStatements, amr };
}

const describeFill = (med: MedRow): string => {
  const last = med.dispensed[0];
  if (!last) return `${med.label}: no fill found`;
  const until = last.runoutAt ? `, supply to ${last.runoutAt}` : "";
  return `${med.label} last filled ${last.date}${until}`;
};

function assignConflicts(all: MedRow[], labs: Map<string, { text: string; evidence: Evidence }>) {
  const setConflict = (med: MedRow, conflict: MedConflict) => {
    if (!med.conflict || SEVERITY_ORDER[conflict.severity] < SEVERITY_ORDER[med.conflict.severity]) med.conflict = conflict;
  };
  const evidenceOf = (med: MedRow): Evidence[] =>
    [...med.ordered, ...med.dispensed, ...med.reported].flatMap((e) => e.evidence).slice(0, 8);

  /* Same class, two or more drugs in supply at once: never resolved by the system. */
  const anticoagulants = all.filter((m) => m.drugClass === CLASS_ANTICOAGULANT);
  const activeAnticoagulants = anticoagulants.filter((m) => m.active);
  if (activeAnticoagulants.length >= 2) {
    const summary = `Possible duplicate anticoagulation. ${activeAnticoagulants.map(describeFill).join("; ")}. Sources disagree and stay side by side until a clinician records the reconciliation.`;
    const evidence = activeAnticoagulants.flatMap(evidenceOf);
    for (const med of activeAnticoagulants) setConflict(med, { severity: "severe", summary, evidence });
  }

  /* Two controllers from different sources, neither currently in supply. */
  const controllers = all.filter((m) => m.drugClass === CLASS_ICS && m.ordered.length > 0);
  if (controllers.length >= 2 && controllers.every((m) => !m.active)) {
    const summary = `Two inhaled controllers ordered, none in current supply. ${controllers.map(describeFill).join("; ")}.`;
    const evidence = controllers.flatMap(evidenceOf);
    for (const med of controllers) setConflict(med, { severity: "high", summary, evidence });
  }

  for (const med of all) {
    const entry = DRUGS.find((d) => d.key === med.key);
    const last = med.dispensed[0];
    const lab = labs.get(med.key);
    const reportedText = med.reported[0]?.text;

    /* A document says discontinued while supply is still active. */
    if (med.active && med.ordered.some((o) => o.status === "discontinued")) {
      setConflict(med, {
        severity: "severe",
        summary: `${describeFill(med)}, but a document lists it as discontinued.`,
        evidence: evidenceOf(med),
      });
    }

    /* PBM stopped, an outside source continues. */
    const pbmFills = med.dispensed.filter((d) => !d.external);
    const externalActive = med.dispensed.find((d) => d.external && d.runoutAt && (d.daysPastRunout ?? 0) === 0);
    if (pbmFills.length > 0 && externalActive && (pbmFills[0].daysPastRunout ?? 0) > 0) {
      setConflict(med, {
        severity: "medium",
        summary: `PBM shows no fill since ${pbmFills[0].date} (${pbmFills[0].daysPastRunout} days past run-out), but ${externalActive.source.split(" - ")[0]} filled it on ${externalActive.date}. Treat the PBM gap as unverified.`,
        evidence: evidenceOf(med),
      });
      continue;
    }

    /* Ordered, with no dispensing record at all. */
    if (med.dispensed.length === 0 && med.ordered.length > 0) {
      const blocked = med.ordered.find((o) => o.status === "not_dispensed" || o.status === "rejected");
      if (entry?.invisibleToPbm && !blocked && med.reported.length === 0) continue;
      if (entry?.invisibleToPbm && !blocked) {
        setConflict(med, {
          severity: "medium",
          summary: `Over-the-counter, so pharmacy data cannot see it. Member-reported: ${reportedText}.`,
          evidence: evidenceOf(med),
        });
        continue;
      }
      setConflict(med, {
        severity: blocked ? "high" : "medium",
        summary: `No fill found. Ordered: ${(blocked ?? med.ordered[0]).text}.`,
        evidence: evidenceOf(med),
      });
    }

    /* Reported use with nothing in pharmacy data. */
    if (med.dispensed.length === 0 && med.ordered.length === 0 && med.reported.length > 0) {
      setConflict(med, {
        severity: "medium",
        summary: `Reported by the member, no fill found: ${reportedText}.`,
        evidence: evidenceOf(med),
      });
    }

    /* Supply ran out and nothing follows. */
    if (last && !med.active && !entry?.gapExempt && (last.daysPastRunout ?? 0) >= THRESHOLDS.medGapDays) {
      const onlyHistorical = med.ordered.length === 0;
      const notes = [
        `Last fill ${last.date}, ${last.daysPastRunout} days past run-out. No fill found since.`,
        onlyHistorical ? "Absent from every current medication list." : null,
        reportedText ? `Member-reported: ${reportedText}.` : null,
        lab ? `${lab.text}.` : null,
      ].filter(Boolean);
      setConflict(med, {
        severity: reportedText || lab ? "high" : "medium",
        summary: notes.join(" "),
        evidence: [...evidenceOf(med), ...(lab ? [lab.evidence] : [])],
      });
    }
  }
}

/** Three or more PBM drugs stopping on one date, with the same drugs filled elsewhere, is a source switch. */
export function detectSourceSwitch(store: Store, memberId: string): { rows: StdRow[]; external: StdRow[]; fillDate: string } | null {
  const fills = store.rows("05", memberId).filter((r) => iso(r, "Fill_Date"));
  const external = fills.filter((r) => /\bVA\b|not in PBM/i.test(s(r, "Source")));
  if (external.length === 0) return null;
  const groups = new Map<string, StdRow[]>();
  for (const row of fills.filter((r) => /^PBM$/i.test(s(r, "Source")))) {
    const date = iso(row, "Fill_Date")!;
    const supply = num(row, "Days_Supply");
    if (!supply || daysBetween(addDays(date, supply), store.asOf) <= 0) continue;
    groups.set(date, [...(groups.get(date) ?? []), row]);
  }
  for (const [fillDate, rows] of groups) {
    if (rows.length >= THRESHOLDS.sourceSwitchMinDrugs) return { rows, external, fillDate };
  }
  return null;
}

/** A denial whose stated reason is a documentation gap, while abnormal kidney labs were already on file. */
export function findReversibleDenials(store: Store, memberId: string): { denial: StdRow; labs: StdRow[] }[] {
  const out: { denial: StdRow; labs: StdRow[] }[] = [];
  for (const denial of store.rows("08", memberId)) {
    if (!/denied|upheld/i.test(s(denial, "Status"))) continue;
    if (!/not documented|no new clinical/i.test(s(denial, "Pend_Or_Denial_Reason"))) continue;
    const decidedAt = iso(denial, "Decision_Date");
    const labs = store.rows("07", memberId).filter((lab) => {
      const value = num(lab, "Value");
      const date = iso(lab, "Result_Date");
      if (value === null || !date || (decidedAt && toMin(date) > toMin(decidedAt))) return false;
      return (/egfr/i.test(s(lab, "Test")) && value < THRESHOLDS.egfrCkdBelow) || (/albumin/i.test(s(lab, "Test")) && value >= 30);
    });
    if (labs.length > 0) out.push({ denial, labs });
  }
  return out;
}
