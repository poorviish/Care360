"use client";

import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GUARDRAILS, WEIGHTS } from "@lib/config/scoring";
import type { QualityFlag, RunReport, Severity } from "@lib/pipeline/types";
import { useDemo } from "@/lib/demoStore";
import { fmt } from "@/lib/format";
import { SeverityBadge } from "./chips";

const SEVERITIES: Severity[] = ["severe", "high", "medium", "low"];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tnum font-semibold">{value}</dd>
    </div>
  );
}

function Section({ id, title, children, aside }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-2 flex items-baseline justify-between gap-4 px-5">
        <h2 className="text-head font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="panel p-5">{children}</div>
    </section>
  );
}

export function PipelineView({ report: initialReport, flags: initialFlags, names: initialNames }: { report: RunReport; flags: QualityFlag[]; names: Record<string, string> }) {
  const { upload } = useDemo();
  const report = upload?.report ?? initialReport;
  const flags = upload?.dataset.flags ?? initialFlags;
  const names = useMemo(() => (upload ? Object.fromEntries(upload.dataset.members.map((m) => [m.id, String(m.name.value ?? m.id)])) : initialNames), [upload, initialNames]);

  const [member, setMember] = useState("all");
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [includeSource, setIncludeSource] = useState(true);

  const shown = useMemo(
    () => flags.filter((f) => (member === "all" || f.memberId === member) && (type === "all" || f.type === type) && (severity === "all" || f.severity === severity) && (includeSource || f.type !== "source_flag")),
    [flags, member, type, severity, includeSource],
  );
  const labelOf = useMemo(() => new Map(report.flagsByType.map((t) => [t.type, t.label])), [report]);
  const covered = report.plantedCoverage.filter((p) => p.covered).length;
  const matches = report.rankAudit.filter((r) => r.workbookRank === r.computedRank).length;

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-7 px-6 pt-6 pb-16" data-flag-total={report.flagTotal}>
      <div className="px-5">
        <h1 className="text-large font-bold">Pipeline</h1>
        <p className="tnum mt-1 text-foot text-ink-2">
          {report.workbookName}. As-of {fmt(report.asOf)}, from {report.asOfSource}.
        </p>
        <nav aria-label="On this page" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-foot">
          {[
            ["stages", "Stages"],
            ["planted", `Planted imperfections (${covered}/${report.plantedCoverage.length})`],
            ["scoring", "Scoring"],
            ["flags", `Quality flags (${report.flagTotal})`],
            ["sheets", `Sheets (${report.sheets.length})`],
            ["warnings", `Warnings (${report.warnings.length})`],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="tnum text-action no-underline hover:opacity-70">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <Section id="stages" title="Stages">
        <ol className="grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {report.stages.map((stage) => (
            <li key={stage.id} className="min-w-0">
              <h3 className="text-foot font-semibold">{stage.name}</h3>
              <p className="mt-0.5 text-cap text-ink-3">{stage.description}</p>
              <dl className="mt-2 text-foot">
                {stage.counts.map((count) => (
                  <Stat key={count.label} label={count.label} value={count.value} />
                ))}
              </dl>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="planted"
        title="Planted imperfections"
        aside={
          <p className="tnum flex items-center gap-1.5 text-foot font-medium">
            {covered === report.plantedCoverage.length ? <CircleCheck size={15} aria-hidden /> : <TriangleAlert size={15} aria-hidden className="text-crimson" />}
            {covered} of {report.plantedCoverage.length} flagged
          </p>
        }
      >
        <p className="mb-3 max-w-[75ch] text-foot text-ink-2">The register sheet is audit-only: it checks the detectors and never feeds them. A row counts as covered when every rule type listed for it fired for that member. Each flag is listed below and on that member&apos;s record.</p>
        {report.plantedCoverage.length === 0 ? (
          <p className="text-foot text-ink-2">This workbook has no Planted_Imperfections sheet, so there is nothing to audit against.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Member</th>
                  <th>Imperfection</th>
                  <th>Pipeline rules that fired</th>
                  <th>Flags</th>
                  <th>Register row</th>
                </tr>
              </thead>
              <tbody>
                {report.plantedCoverage.map((row) => (
                  <tr key={row.id}>
                    <td className="tnum font-semibold whitespace-nowrap">{row.id}</td>
                    <td className="whitespace-nowrap">
                      <Link className="text-action no-underline hover:opacity-70" href={`/member/${row.memberId}#flags`}>
                        {names[row.memberId] ?? row.memberId}
                      </Link>
                    </td>
                    <td className="max-w-[46ch]">{row.imperfection}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {row.expectedRules.map((rule) => (
                          <span key={rule} className={`chip ${row.missingRules.includes(rule) ? "chip-crimson" : "chip-quiet"}`}>
                            {row.missingRules.includes(rule) ? <CircleX size={12} aria-hidden /> : <CircleCheck size={12} aria-hidden />}
                            {labelOf.get(rule) ?? rule}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="tnum">{row.matchedFlagIds.length}</td>
                    <td className="tnum whitespace-nowrap text-ink-3">
                      {row.evidence.sheet}, row {row.evidence.row}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="scoring" title="Scoring">
        <p className="mb-3 max-w-[75ch] text-foot text-ink-2">
          Score is the sum of the driver points shown. Rank uses the top tier first, then the score without Contactable now, so reachability can only break an exact tie and can never lower a rank. Weights live in <code>lib/config/scoring.ts</code>; rules are in <code>docs/scoring.md</code>.
        </p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Member</th>
                <th>Tier</th>
                {report.scoring[0]?.drivers.map((d) => (
                  <th key={d.key} className="text-right!">
                    <span className="block">{driverLabel(d.key)}</span>
                    <span className="tnum block font-normal">max {d.weight}</span>
                  </th>
                ))}
                <th className="text-right!">Rank basis</th>
                <th className="text-right!">Score</th>
                <th className="text-right!">Workbook rank</th>
              </tr>
            </thead>
            <tbody>
              {report.scoring.map((row) => {
                const audit = report.rankAudit.find((r) => r.memberId === row.memberId);
                return (
                  <tr key={row.memberId}>
                    <td className="tnum font-semibold">{row.rank}</td>
                    <td className="whitespace-nowrap">
                      <Link className="text-action no-underline hover:opacity-70" href={`/member/${row.memberId}`}>
                        {row.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{row.topTier ? <span className="chip chip-crimson-solid">Top tier</span> : <span className="chip chip-quiet">Standard</span>}</td>
                    {row.drivers.map((d) => (
                      <td key={d.key} className="tnum text-right" title={d.reason}>
                        {d.points}
                      </td>
                    ))}
                    <td className="tnum text-right">{row.baseScore}</td>
                    <td className="tnum text-right font-semibold">{row.score}</td>
                    <td className="tnum text-right">{audit?.workbookRank ?? "Not in source data"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="tnum mt-3 text-foot text-ink-2">
          Computed rank matches the workbook&apos;s Monday_8am sheet for {matches} of {report.rankAudit.length} members. That sheet is compared here and never used as an input.
        </p>
        <dl className="mt-4 grid gap-x-10 gap-y-3 text-foot md:grid-cols-2">
          <div>
            <dt className="font-semibold">Guardrail from the brief</dt>
            <dd className="text-ink-2">A TOC contact clock in its final {GUARDRAILS.tocFinalHours} hours or breached goes to the top tier. Reachability never lowers a rank.</dd>
          </div>
          <div>
            <dt className="font-semibold">Added beyond the brief</dt>
            <dd className="text-ink-2">{GUARDRAILS.safetyTopTierSignals.length > 0 ? "A red-flag symptom call or two anticoagulants in supply also go to the top tier, because the workbook requires red-flag calls to reach the top and treats the conflict as same-day." : "None active."}</dd>
          </div>
          <div>
            <dt className="font-semibold">Default weights</dt>
            <dd className="tnum text-ink-2">
              Deadline {WEIGHTS.deadline}, Clinical risk {WEIGHTS.clinicalRisk}, New signal {WEIGHTS.newSignal}, Open commitments {WEIGHTS.openCommitments}, Contactable now {WEIGHTS.contactableNow}.
            </dd>
          </div>
        </dl>
      </Section>

      <Section id="flags" title="Quality flags">
        <div className="mb-5 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Flag type</th>
                <th>What it means</th>
                <th>Source</th>
                <th className="text-right!">Count</th>
              </tr>
            </thead>
            <tbody>
              {report.flagsByType
                .filter((t) => t.count > 0)
                .map((t) => (
                  <tr key={t.type}>
                    <td className="font-medium whitespace-nowrap">
                      <button type="button" className="text-left text-action hover:opacity-70" onClick={() => setType(t.type)}>
                        {t.label}
                      </button>
                    </td>
                    <td className="text-ink-2">{t.description}</td>
                    <td className="whitespace-nowrap text-ink-3">{t.fromBrief ? "Named in the brief" : t.type === "source_flag" ? "Workbook" : "Added rule"}</td>
                    <td className="tnum text-right font-semibold" data-flag-type={t.type}>
                      {t.count}
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-line-2 py-2 font-semibold" colSpan={3}>
                  Total
                </td>
                <td className="tnum border-t border-line-2 py-2 text-right font-semibold">{report.flagTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="material sticky top-14 z-10 -mx-5 flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2 text-foot">
          <label className="flex items-center gap-1.5">
            <span className="text-ink-3">Member</span>
            <select className="select" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="all">All</option>
              {Object.entries(names).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-3">Type</span>
            <select className="select max-w-60" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All</option>
              {report.flagsByType
                .filter((t) => t.count > 0)
                .map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-3">Severity</span>
            <select className="select capitalize" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="all">All</option>
              {SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {sev} ({report.flagsBySeverity[sev]})
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={includeSource} onChange={(e) => setIncludeSource(e.target.checked)} />
            Include source-declared flags
          </label>
          <span className="tnum ml-auto text-ink-3">
            Showing {shown.length} of {flags.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Member</th>
                <th>Type</th>
                <th>Finding</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((flag) => (
                <tr key={flag.id}>
                  <td>
                    <SeverityBadge severity={flag.severity} />
                  </td>
                  <td className="whitespace-nowrap">{names[flag.memberId] ?? flag.memberId}</td>
                  <td className="whitespace-nowrap text-ink-2">{labelOf.get(flag.type) ?? flag.type}</td>
                  <td className="max-w-[72ch]">
                    <p className="font-medium">{flag.type === "source_flag" ? flag.detail : flag.title}</p>
                    {flag.type !== "source_flag" && <p className="text-ink-2">{flag.detail}</p>}
                  </td>
                  <td className="tnum whitespace-nowrap text-ink-3">
                    {flag.evidence.slice(0, 4).map((e) => (
                      <p key={`${e.sheet}-${e.row}-${e.column ?? ""}`}>
                        {e.sheet}, row {e.row}
                      </p>
                    ))}
                    {flag.evidence.length > 4 && <p>and {flag.evidence.length - 4} more rows</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="py-4 text-foot text-ink-2">No flags match these filters. Clear a filter to see more.</p>}
        </div>
      </Section>

      <Section id="sheets" title="Sheets read">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Sheet</th>
                <th className="text-right!">Rows</th>
                <th className="text-right!">Columns</th>
                <th>Member ID column</th>
                <th>Date columns detected</th>
              </tr>
            </thead>
            <tbody>
              {report.sheets.map((sheet) => (
                <tr key={sheet.name}>
                  <td className="font-medium whitespace-nowrap">{sheet.name}</td>
                  <td className="tnum text-right" data-sheet-rows={sheet.name}>
                    {sheet.rows}
                  </td>
                  <td className="tnum text-right">{sheet.columns.length}</td>
                  <td className="text-ink-2">{sheet.memberIdColumn ?? "None"}</td>
                  <td className="text-ink-2">{sheet.dateColumns.join(", ") || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="warnings" title="Warnings">
        {report.warnings.length === 0 ? (
          <p className="text-foot text-ink-2">No warnings on this run.</p>
        ) : (
          <ul className="max-w-[90ch] space-y-1.5 text-foot">
            {report.warnings.map((warning) => (
              <li key={warning} className="tnum">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function driverLabel(key: string) {
  return { deadline: "Deadline", clinicalRisk: "Clinical risk", newSignal: "New signal", openCommitments: "Open commitments", contactableNow: "Contactable now" }[key] ?? key;
}
