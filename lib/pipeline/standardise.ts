import { nextMondayAt8, parseLooseDate, toMin } from "./dates";
import type { IngestedSheet } from "./ingest";
import type { Evidence, Sourced, StdRow } from "./types";

/** Event time and arrival time are kept apart for every dataset. See docs/data-map.md. */
const TIME_COLUMNS: Record<string, { event: string[]; arrival: string[] }> = {
  "01": { event: ["Elig_Start"], arrival: ["Received_Date"] },
  "02": { event: ["Last_Verified"], arrival: [] },
  "03": { event: ["Event_DateTime"], arrival: ["Received_DateTime"] },
  "04": { event: ["Service_Date_To", "Service_Date"], arrival: ["Received_Date"] },
  "05": { event: ["Fill_Date"], arrival: ["Received_Date"] },
  "06": { event: ["Doc_Date"], arrival: ["Received_Date"] },
  "07": { event: ["Result_Date"], arrival: ["Received_Date"] },
  "08": { event: ["Request_Date"], arrival: ["Decision_Date"] },
  "09": { event: ["Data_As_Of"], arrival: ["Score_Date"] },
  "10": { event: ["Due_Date"], arrival: ["Last_Refresh"] },
  "11": { event: ["Date"], arrival: [] },
  "12": { event: ["DateTime"], arrival: [] },
  "13": { event: ["Open_Date"], arrival: [] },
  "14": { event: ["Appt_DateTime"], arrival: ["Received_Date"] },
  "15": { event: ["DateTime"], arrival: ["Received_By_CM_System"] },
  "16": { event: ["Service_Date"], arrival: ["Request_Date"] },
  "17": { event: ["Reading_Date"], arrival: ["Received_Date"] },
  "18": { event: ["Last_Contact"], arrival: [] },
};

/** Columns whose dates describe something that already happened. Used for the as-of fallback. */
const PAST_EVENT_COLUMNS: Record<string, string[]> = {
  "03": ["Event_DateTime", "Received_DateTime"],
  "04": ["Service_Date_To", "Received_Date"],
  "05": ["Fill_Date", "Received_Date"],
  "06": ["Doc_Date", "Received_Date"],
  "07": ["Result_Date", "Received_Date"],
  "12": ["DateTime"],
  "15": ["DateTime", "Received_By_CM_System"],
  "17": ["Reading_Date", "Received_Date"],
};

export const normaliseMemberId = (value: string | number | null) =>
  value === null ? null : String(value).trim().toUpperCase();

export interface NormalisedPhone {
  digits: string;
  extension: string | null;
  display: string;
}

/** "555-555-0100 x12 (front desk)" becomes digits 5555550100, extension 12. Non-phones are null. */
export function normalisePhone(value: string | null): NormalisedPhone | null {
  if (!value) return null;
  const match = /(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?:\s*(?:x|ext\.?)\s*(\d+))?/i.exec(value);
  if (!match) return null;
  const digits = `${match[1]}${match[2]}${match[3]}`;
  const extension = match[4] ?? null;
  return {
    digits,
    extension,
    display: `${match[1]}-${match[2]}-${match[3]}${extension ? ` x${extension}` : ""}`,
  };
}

export interface Store {
  asOf: string;
  asOfSource: string;
  memberIds: string[];
  /** Every sheet's standardised rows. Reference sheets are included for the audit. */
  all: StdRow[];
  byPrefix: Map<string, StdRow[]>;
  byMember: Map<string, Map<string, StdRow[]>>;
  sheetLabels: Map<string, string>;
  codeLabels: Map<string, { label: string; evidence: Evidence }>;
  warnings: string[];
  rows(prefix: string, memberId?: string): StdRow[];
  reference(name: string): StdRow[];
}

/** Trimmed text, or an empty string when the cell is empty. */
export const s = (row: StdRow, column: string) => row.f[column] ?? "";
export const has = (row: StdRow, column: string) => Boolean(row.f[column]);
export const iso = (row: StdRow, column: string) => row.iso[column] ?? null;
export function num(row: StdRow, column: string): number | null {
  const value = row.f[column];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const ev = (row: StdRow, column?: string): Evidence =>
  column ? { sheet: row.sheet, row: row.row, column } : { sheet: row.sheet, row: row.row };

/** Builds a Sourced value from a cell. Empty cells stay null and render "Not in source data". */
export function cell(store: Store, row: StdRow, column: string, options: { date?: string | null; flags?: Sourced["flags"]; source?: string } = {}): Sourced {
  return {
    value: row.f[column] ?? null,
    source: options.source ?? store.sheetLabels.get(row.prefix) ?? row.sheet,
    date: options.date !== undefined ? options.date : (row.arrivalAt ?? row.eventAt),
    evidence: [ev(row, column)],
    ...(options.flags?.length ? { flags: options.flags } : {}),
  };
}

export function computed(value: string | number | null, rule: string, evidence: Evidence[], date: string | null, flags?: Sourced["flags"]): Sourced {
  return { value, source: "Computed", date, evidence, computed: rule, ...(flags?.length ? { flags } : {}) };
}

export const missing = (source: string): Sourced => ({ value: null, source, date: null, evidence: [] });

/** First sentences of free text. Only splits at punctuation then a space, so 0.25 and 38.3 stay whole. */
export function firstSentences(text: string, count = 1): string {
  return text.split(/(?<=[.!?])\s+(?=[A-Z'"(])/).slice(0, count).join(" ").trim();
}

/** Harvests "CODE label" pairs from cells that contain them. Nothing external is consulted. */
const ICD_TOKEN = /\b([A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)\b(?:\s+([^;]+))?/g;

function harvestCodeLabels(rows: StdRow[], columns: string[], into: Store["codeLabels"]) {
  for (const row of rows) {
    for (const column of columns) {
      const text = row.f[column];
      if (!text) continue;
      for (const match of text.matchAll(ICD_TOKEN)) {
        const [, code, rawLabel] = match;
        const label = rawLabel?.trim();
        if (!label || /^BP\b/.test(label)) continue;
        if (!into.has(code)) into.set(code, { label, evidence: ev(row, column) });
      }
    }
  }
}

function findAsOf(readme: IngestedSheet | undefined, datasetRows: StdRow[]): { asOf: string; source: string } {
  if (readme) {
    const candidates = [
      ...readme.rows.map((r) => ({ label: r.cells[0], value: r.cells[1], row: r.row })),
    ];
    for (const candidate of candidates) {
      if (typeof candidate.label === "string" && /as-?of/i.test(candidate.label) && typeof candidate.value === "string") {
        const parsed = parseLooseDate(candidate.value);
        if (parsed) return { asOf: parsed, source: `${readme.info.name}!B${candidate.row}` };
      }
    }
  }
  let latest: string | null = null;
  for (const row of datasetRows) {
    for (const column of PAST_EVENT_COLUMNS[row.prefix] ?? []) {
      const value = row.iso[column];
      if (value && (!latest || toMin(value) > toMin(latest))) latest = value;
    }
  }
  if (!latest) throw new Error("No as-of date in the workbook and no dated events to derive one from.");
  return { asOf: nextMondayAt8(latest), source: `Derived: Monday 08:00 after the latest event (${latest})` };
}

/** Stage 2. Trims text, converts dates to ISO, normalises member IDs and splits event from arrival time. */
export function standardise(sheets: IngestedSheet[]): Store {
  const all: StdRow[] = [];
  const byPrefix = new Map<string, StdRow[]>();
  const byMember = new Map<string, Map<string, StdRow[]>>();

  for (const sheet of sheets) {
    const prefix = /^(\d{2})_/.exec(sheet.info.name)?.[1] ?? sheet.info.name;
    const memberColumn = sheet.info.memberIdColumn;
    const times = TIME_COLUMNS[prefix];
    for (const { row, cells } of sheet.rows) {
      const f: StdRow["f"] = {};
      const isoValues: StdRow["iso"] = {};
      sheet.headers.forEach((header, index) => {
        if (!header) return;
        const value = cells[index];
        f[header] = value === null || value === undefined ? null : String(value).replace(/\s+/g, " ").trim();
        isoValues[header] = parseLooseDate(f[header]);
      });
      const memberRaw = memberColumn ? f[memberColumn] : null;
      const memberId = memberRaw && /^[A-Za-z]{1,3}-\d{4,6}$/.test(memberRaw) ? normaliseMemberId(memberRaw) : null;
      const firstDate = (columns: string[] | undefined) => columns?.map((c) => isoValues[c]).find(Boolean) ?? null;
      const std: StdRow = {
        sheet: sheet.info.name,
        prefix,
        row,
        memberId,
        f,
        iso: isoValues,
        eventAt: firstDate(times?.event),
        arrivalAt: firstDate(times?.arrival),
      };
      all.push(std);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix)!.push(std);
      if (memberId && sheet.info.kind === "dataset") {
        if (!byMember.has(memberId)) byMember.set(memberId, new Map());
        const perMember = byMember.get(memberId)!;
        if (!perMember.has(prefix)) perMember.set(prefix, []);
        perMember.get(prefix)!.push(std);
      }
    }
  }

  const datasetRows = all.filter((r) => /^\d{2}$/.test(r.prefix));
  const { asOf, source } = findAsOf(sheets.find((x) => /^readme$/i.test(x.info.name)), datasetRows);

  const dictionary = byPrefix.get("Dataset_Dictionary") ?? [];
  const sheetLabels = new Map<string, string>();
  for (const row of dictionary) {
    const code = s(row, "Sheet");
    const label = s(row, "Dataset");
    if (code && label) sheetLabels.set(code.padStart(2, "0"), label);
  }

  const codeLabels: Store["codeLabels"] = new Map();
  harvestCodeLabels(byPrefix.get("04") ?? [], ["Primary_Dx_ICD10", "Secondary_Dx"], codeLabels);
  harvestCodeLabels(byPrefix.get("03") ?? [], ["Diagnosis_In_Alert"], codeLabels);

  const memberIds = [...new Set((byPrefix.get("01") ?? []).map((r) => r.memberId).filter((v): v is string => Boolean(v)))];

  const warnings: string[] = [];
  for (const [id] of byMember) {
    if (!memberIds.includes(id)) warnings.push(`Member ${id} has dataset rows but no eligibility row, so it is left out of the queue.`);
  }
  // Formula cells: compare cached values with a fresh computation so any drift is visible.
  for (const row of byPrefix.get("03") ?? []) {
    const event = row.iso["Event_DateTime"];
    const received = row.iso["Received_DateTime"];
    const cached = num(row, "Latency_Hours");
    if (event && received && cached !== null) {
      const fresh = Math.round(((toMin(received) - toMin(event)) / 60) * 10) / 10;
      if (Math.abs(fresh - cached) > 0.051) warnings.push(`${row.sheet} row ${row.row}: cached latency ${cached} h differs from computed ${fresh} h.`);
    }
  }

  return {
    asOf,
    asOfSource: source,
    memberIds,
    all,
    byPrefix,
    byMember,
    sheetLabels,
    codeLabels,
    warnings,
    rows(prefix, memberId) {
      if (memberId) return byMember.get(memberId)?.get(prefix) ?? [];
      return byPrefix.get(prefix) ?? [];
    },
    reference(name) {
      return byPrefix.get(name) ?? [];
    },
  };
}
