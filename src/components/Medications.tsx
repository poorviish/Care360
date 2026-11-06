"use client";

import { AlertOctagon, AlertTriangle, PackageX } from "lucide-react";
import { useState } from "react";
import type { MedEntry, MedicationView, MedRow } from "@lib/pipeline/types";
import { fmt, pluralise } from "@/lib/format";
import { ExceptionChip, NotInSource, SeverityBadge } from "./chips";
import { evidenceTip } from "./Sourced";
import { Hover } from "./Hover";

const STATUS_LABEL: Partial<Record<MedEntry["status"], string>> = {
  discontinued: "Listed as discontinued",
  planned: "Planned",
  pending: "Pending",
  not_dispensed: "Not dispensed",
  rejected: "Rejected",
  administered: "Given or dispensed outside pharmacy",
};

function Entry({ entry }: { entry: MedEntry }) {
  const label = `${entry.source}${entry.date ? ` · ${fmt(entry.date)}` : ""}`;
  return (
    <Hover focusable={false} className="block" content={evidenceTip(entry.source, entry.date, entry.evidence, entry.flags)}>
      <span className="tnum block leading-snug">{entry.text}</span>
      {(STATUS_LABEL[entry.status] || entry.flags?.length || (entry.daysPastRunout ?? 0) > 0) && (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {STATUS_LABEL[entry.status] && <span className="chip chip-quiet">{STATUS_LABEL[entry.status]}</span>}
          {(entry.daysPastRunout ?? 0) > 0 && <span className="chip chip-quiet tnum">{entry.daysPastRunout} d past run-out</span>}
          {entry.flags?.map((flag) => <ExceptionChip key={`${flag.tag}-${flag.note ?? ""}`} flag={flag} />)}
        </span>
      )}
      <span className="muted tnum mt-0.5 block">{label}</span>
    </Hover>
  );
}

function Column({ entries, empty }: { entries: MedEntry[]; empty: React.ReactNode }) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-2.5">
      {entries.map((entry) => (
        <Entry key={`${entry.evidence[0]?.sheet}-${entry.evidence[0]?.row}-${entry.text}`} entry={entry} />
      ))}
    </div>
  );
}

const NoFill = () => (
  <span className="chip chip-amber">
    <PackageX size={12} aria-hidden />
    No fill found
  </span>
);

/** Conflict summaries, used in the top block. They say "no fill found", never a verdict on the member. */
export function MedConflictList({ rows }: { rows: MedRow[] }) {
  const [showClean, setShowClean] = useState(false);
  const conflicts = rows.filter((row) => row.conflict);
  const clean = rows.filter((row) => !row.conflict);
  const counts = (
    <div className="mb-3 text-foot">
      <p className="tnum font-medium">
        {pluralise(rows.length, "medication")}, {pluralise(conflicts.length, "conflict")}
      </p>
      {clean.length > 0 && (
        <button type="button" className="tnum text-cap text-action hover:opacity-70" aria-expanded={showClean} onClick={() => setShowClean((v) => !v)}>
          {showClean ? "Hide" : "Show"} {pluralise(clean.length, "medication")} with no conflict
        </button>
      )}
      {showClean && <p className="mt-1 leading-snug text-ink-2">{clean.map((row) => row.label).join(", ")}</p>}
    </div>
  );
  if (conflicts.length === 0) return counts;
  // Rows that share one summary (a class conflict) are shown once, naming every drug in it.
  const seen = new Map<string, { labels: string[]; row: MedRow }>();
  for (const row of conflicts) {
    const key = row.conflict!.summary;
    if (seen.has(key)) seen.get(key)!.labels.push(row.label);
    else seen.set(key, { labels: [row.label], row });
  }
  return (
    <>
      {counts}
      <ul className="space-y-3.5">
        {[...seen.values()].map(({ labels, row }) => (
          <li key={row.key} className="text-foot">
            <div className="flex flex-wrap items-center gap-1.5">
              <SeverityBadge severity={row.conflict!.severity} />
              <span className="font-semibold">{labels.join(" and ")}</span>
            </div>
            <Hover focusable={false} className="mt-1 block" content={evidenceTip("Medication comparison", null, row.conflict!.evidence)}>
              <span className="tnum leading-snug text-ink-2">{row.conflict!.summary}</span>
            </Hover>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Ordered, Dispensed and Member-reported stay in separate columns and are never merged. */
export function MedicationTable({ view }: { view: MedicationView }) {
  if (view.rows.length === 0) return <NotInSource />;
  return (
    <div>
      {view.amr && (
        <p className="tnum mb-2 text-foot">
          Asthma medication ratio from fills this year: <strong className="font-semibold">{view.amr.value}</strong> ({view.amr.controllerUnits} controller, {view.amr.rescueUnits} rescue)
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="tbl min-w-[46rem] table-fixed">
          <thead>
            <tr>
              <th className="w-[15%]">Drug</th>
              <th className="w-[29%]">Ordered (EHR and discharge)</th>
              <th className="w-[28%]">Dispensed (claims and pharmacy)</th>
              <th className="w-[28%]">Member reported</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.key} className={row.conflict?.severity === "severe" ? "bg-crimson-tint/60" : ""}>
                <td className={row.conflict?.severity === "severe" ? "rounded-l-lg pl-2!" : ""}>
                  <p className="font-semibold">{row.label}</p>
                  {row.drugClass && <p className="muted">{row.drugClass}</p>}
                  {row.conflict && (
                    <p className="mt-1 flex items-center gap-1">
                      {row.conflict.severity === "severe" ? <AlertOctagon size={13} aria-hidden className="text-crimson" /> : <AlertTriangle size={13} aria-hidden />}
                      <span className={`text-cap font-medium ${row.conflict.severity === "severe" ? "text-crimson" : ""}`}>Conflict</span>
                    </p>
                  )}
                </td>
                <td>
                  <Column entries={row.ordered} empty={<NotInSource />} />
                </td>
                <td>
                  <Column entries={row.dispensed} empty={row.ordered.length > 0 || row.reported.length > 0 ? <NoFill /> : <NotInSource />} />
                </td>
                <td className={row.conflict?.severity === "severe" ? "rounded-r-lg pr-2!" : ""}>
                  <Column entries={row.reported} empty={<NotInSource />} />
                </td>
              </tr>
            ))}
            {view.generalStatements.length > 0 && (
              <tr>
                <td>
                  <p className="font-semibold">General statements</p>
                  <p className="muted">Not tied to one drug</p>
                </td>
                <td>
                  <NotInSource />
                </td>
                <td>
                  <NotInSource />
                </td>
                <td>
                  <Column entries={view.generalStatements} empty={null} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
