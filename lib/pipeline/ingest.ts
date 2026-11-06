import * as XLSX from "xlsx";
import { UPLOAD } from "../config/scoring";
import { parseLooseDate, serialToIso } from "./dates";
import type { SheetInfo, ValidationError } from "./types";

export type CellValue = string | number | null;

export interface IngestedSheet {
  info: SheetInfo;
  headers: string[];
  /** Positional cell values for each non-empty data row, with the Excel row number. */
  rows: { row: number; cells: CellValue[] }[];
}

const MEMBER_ID_HEADER = /^(patient|member)[ _]?id$/i;
const MEMBER_ID_VALUE = /^[A-Z]{1,3}-\d{4,6}$/;

/** Reads bytes into a workbook. Formulas and macros are ignored: cached values are all we use. */
export function readWorkbookBytes(bytes: Uint8Array | Buffer): XLSX.WorkBook {
  return XLSX.read(bytes, {
    type: "buffer",
    cellDates: false,
    cellNF: true,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
    bookVBA: false,
    sheetRows: UPLOAD.maxRowsPerSheet,
  });
}

function cellValue(cell: XLSX.CellObject | undefined): CellValue {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === "n" && typeof cell.v === "number") {
    return cell.z && XLSX.SSF.is_date(String(cell.z)) ? serialToIso(cell.v) : cell.v;
  }
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "e") return null;
  const text = String(cell.v).trim();
  return text === "" ? null : text;
}

function detectMemberColumn(headers: string[], rows: IngestedSheet["rows"]): string | null {
  const hit = headers.findIndex((h) => MEMBER_ID_HEADER.test(h));
  if (hit >= 0) return headers[hit];
  for (let col = 0; col < headers.length; col++) {
    const values = rows.map((r) => r.cells[col]).filter((v): v is string | number => v !== null);
    if (values.length === 0) continue;
    const matches = values.filter((v) => typeof v === "string" && MEMBER_ID_VALUE.test(v)).length;
    if (headers[col] && matches / values.length >= 0.8) return headers[col];
  }
  return null;
}

function detectDateColumns(headers: string[], rows: IngestedSheet["rows"]): string[] {
  const out: string[] = [];
  headers.forEach((header, col) => {
    if (!header) return;
    const values = rows.map((r) => r.cells[col]).filter((v): v is string | number => v !== null);
    if (values.length === 0) return;
    const parsed = values.filter((v) => typeof v === "string" && parseLooseDate(v)).length;
    if (parsed / values.length >= 0.5) out.push(header);
  });
  return out;
}

/** Stage 1. Reads every sheet and records its columns, row count, member ID and date columns. */
export function ingest(workbook: XLSX.WorkBook): IngestedSheet[] {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) {
      return {
        info: { name, kind: "reference", rows: 0, columns: [], memberIdColumn: null, dateColumns: [] },
        headers: [],
        rows: [],
      } satisfies IngestedSheet;
    }
    const range = XLSX.utils.decode_range(ref);
    const read = (r: number, c: number) => cellValue(ws[XLSX.utils.encode_cell({ r, c })]);
    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const value = read(range.s.r, c);
      headers.push(value === null ? "" : String(value).trim());
    }
    const rows: IngestedSheet["rows"] = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cells: CellValue[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) cells.push(read(r, c));
      if (cells.some((v) => v !== null)) rows.push({ row: r + 1, cells });
    }
    const columns = headers.filter(Boolean);
    return {
      info: {
        name,
        kind: /^\d{2}_/.test(name) ? "dataset" : "reference",
        rows: rows.length,
        columns,
        memberIdColumn: detectMemberColumn(headers, rows),
        dateColumns: detectDateColumns(headers, rows),
      },
      headers,
      rows,
    } satisfies IngestedSheet;
  });
}

/** Columns the derivations rely on, by dataset prefix. */
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  "01": ["Patient_ID", "Name_As_Recorded", "DOB_As_Recorded", "Line_Of_Business", "Plan_Product", "Elig_Status", "Attributed_PCP", "Language_On_File", "Address_On_File"],
  "02": ["Patient_ID", "Record_Type", "Value", "Owner_Of_Contact", "Label_In_System", "Status", "Best_Time"],
  "03": ["Patient_ID", "Alert_ID", "HL7_Event", "Event_Type", "Event_DateTime", "Received_DateTime", "Discharge_Disposition"],
  "04": ["Patient_ID", "Claim_ID", "Service_Date", "Primary_Dx_ICD10", "Adjudication_Status", "Received_Date"],
  "05": ["Patient_ID", "Rx_ID", "Fill_Date", "Drug", "Days_Supply", "Source"],
  "06": ["Patient_ID", "Doc_ID", "Doc_Type", "Doc_Date", "Received_Date", "Medications_Listed"],
  "07": ["Patient_ID", "Result_Date", "Received_Date", "Test", "Value"],
  "08": ["Patient_ID", "Auth_ID", "Service_Requested", "Status"],
  "09": ["Patient_ID", "Model", "Score_Date", "Score", "Tier"],
  "10": ["Patient_ID", "Measure_Code", "Status", "Due_Date"],
  "11": ["Patient_ID", "Assessment", "Date", "Respondent", "Completion_Pct", "Key_Responses"],
  "12": ["Patient_ID", "Attempt_ID", "DateTime", "Channel", "Number_Or_Address_Used", "Outcome"],
  "13": ["Patient_ID", "Case_ID", "Case_Status", "Item_Type", "Goal_Barrier_Or_Task", "Due_Date", "Item_Status"],
  "14": ["Patient_ID", "Appt_ID", "Appt_DateTime", "Provider_Facility", "Type", "Status"],
  "15": ["Patient_ID", "Interaction_ID", "DateTime", "Summary", "Routed_To_CM"],
  "16": ["Patient_ID", "Benefit_Or_Service", "Status"],
  "17": ["Patient_ID", "Reading_Date", "Metric", "Value", "Flag"],
  "18": ["Patient_ID", "Role", "Name"],
};

/** Schema check for uploads. Returns every problem found rather than stopping at the first. */
export function validateSchema(sheets: IngestedSheet[]): ValidationError[] {
  const errors: ValidationError[] = [];
  // Sorted because JavaScript lists keys like "10" ahead of keys like "01".
  for (const [prefix, required] of Object.entries(REQUIRED_COLUMNS).sort(([a], [b]) => a.localeCompare(b))) {
    const sheet = sheets.find((s) => s.info.name.startsWith(`${prefix}_`));
    if (!sheet) {
      errors.push({ sheet: null, message: `Missing a dataset sheet whose name starts with "${prefix}_".` });
      continue;
    }
    const missing = required.filter((c) => !sheet.info.columns.includes(c));
    if (missing.length > 0) {
      errors.push({ sheet: sheet.info.name, message: `Missing required column(s): ${missing.join(", ")}.` });
    }
  }
  if (!errors.length) {
    const hasMember = sheets.some((s) => s.info.name.startsWith("01_") && s.rows.length > 0);
    if (!hasMember) errors.push({ sheet: "01_Member_Eligibility", message: "No member rows found." });
  }
  return errors;
}
