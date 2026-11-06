"use client";

import type { Evidence, ExceptionFlag, Sourced as SourcedValue } from "@lib/pipeline/types";
import { fmt, fmtValue } from "@/lib/format";
import { ExceptionChip, NotInSource } from "./chips";
import { Hover } from "./Hover";

function EvidenceLines({ evidence }: { evidence: Evidence[] }) {
  const unique = evidence.filter((e, i) => evidence.findIndex((x) => x.sheet === e.sheet && x.row === e.row) === i);
  return (
    <>
      {unique.slice(0, 5).map((e) => (
        <p key={`${e.sheet}-${e.row}-${e.column ?? ""}`} className="tnum">
          Sheet {e.sheet}, row {e.row}
          {e.column ? ` (${e.column})` : ""}
        </p>
      ))}
      {unique.length > 5 && <p className="tnum">and {unique.length - 5} more rows</p>}
    </>
  );
}

export function evidenceTip(source: string, date: string | null, evidence: Evidence[], flags?: ExceptionFlag[], rule?: string) {
  return (
    <>
      <p className="tnum font-semibold">
        {source}
        {date ? ` · ${fmt(date)}` : ""}
      </p>
      {rule && <p className="mt-1">Rule: {rule}</p>}
      {flags?.some((f) => f.note) && (
        <div className="mt-1">
          {flags.filter((f) => f.note).map((f) => (
            <p key={`${f.tag}-${f.note}`}>{f.note}</p>
          ))}
        </div>
      )}
      <div className="mt-1 text-ink-3">{evidence.length ? <EvidenceLines evidence={evidence} /> : <p>No source row: the workbook has no value here.</p>}</div>
    </>
  );
}

interface SourcedProps {
  v: SourcedValue;
  /**
   * stack: value above its source line. inline: all on one line.
   * tight: value and flags, with the source line in the hover only, for chips and table cells.
   */
  mode?: "stack" | "inline" | "tight";
  className?: string;
  valueClassName?: string;
  focusable?: boolean;
}

/** The one way to show a clinical, operational or demographic value. */
export function Sourced({ v, mode = "stack", className = "", valueClassName = "", focusable = true }: SourcedProps) {
  const label = `${v.source}${v.date ? ` · ${fmt(v.date)}` : ""}`;
  const value = v.value === null || v.value === "" ? <NotInSource /> : <span className={`tnum ${valueClassName}`}>{fmtValue(v.value)}</span>;
  const flags = v.flags?.length ? v.flags.map((flag) => <ExceptionChip key={`${flag.tag}-${flag.note ?? ""}`} flag={flag} />) : null;

  return (
    <Hover
      focusable={focusable}
      className={`${mode === "stack" ? "inline-flex flex-col gap-0.5" : "inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5"} max-w-full ${className}`}
      content={evidenceTip(v.source, v.date, v.evidence, v.flags, v.computed)}
    >
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {value}
        {flags}
      </span>
      {mode !== "tight" && <span className="muted tnum">{label}</span>}
    </Hover>
  );
}
