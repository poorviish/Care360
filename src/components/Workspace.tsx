"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, ArrowUpRight, AudioLines, BedDouble, Bot, Check, ChevronRight, ClipboardCheck, ClipboardList, Clock3, History, Languages, Lock, MessagesSquare, Mic, NotebookPen, Pause, Pencil, Phone, Pill, Play, ShieldCheck, SkipForward, Sparkles, Square, Stethoscope, TriangleAlert, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CONFIDENCE_BANDS } from "@lib/config/scoring";
import { addBusinessDays, dateOnly } from "@lib/pipeline/dates";
import type { AssessmentField, ContactOption, DemoFact, DemoFixture, MemberRecord, Sourced as SourcedValue } from "@lib/pipeline/types";
import { nowFrom, useElapsedMinutes } from "@/lib/clock";
import { ILLUSTRATIVE_LABEL } from "@/lib/constants";
import { demo, EMPTY_CALL, useDemo, type CallState } from "@/lib/demoStore";
import { fmt, fmtShort, fmtTime, pluralise, shortPerson } from "@/lib/format";
import { SPRING, SPRING_FAST } from "@/lib/motion";
import { useMember } from "@/lib/useApi";
import { ClockBadge, ExceptionChip, NotInSource } from "./chips";
import { MemberLoadFailure } from "./MemberView";
import { LoadingBlocks } from "./overlays";
import { avatarTone, initialsOf } from "./QueueRowView";
import { Sourced } from "./Sourced";
import { Switch } from "./ui";

type Band = "high" | "medium" | "low";

const bandOf = (fact: DemoFact): Band => (fact.confidence >= CONFIDENCE_BANDS.high ? "high" : fact.confidence >= CONFIDENCE_BANDS.medium ? "medium" : "low");
const finalValue = (fact: DemoFact, call: CallState) => call.facts[fact.id]?.edit ?? fact.value;
/** Low-confidence facts never count as confirmed, so they can never reach an output. */
const isConfirmed = (fact: DemoFact, call: CallState) => bandOf(fact) !== "low" && Boolean(call.facts[fact.id]?.confirmed);
const isClinician = (speaker: string) => /nurse|care manager/i.test(speaker);
const reachesAssessment = (fact: DemoFact) => fact.target !== "care_plan";
const reachesCarePlan = (fact: DemoFact) => fact.target !== "assessment";

const AI_LABEL = (
  <span className="chip chip-amber">
    <Bot size={13} aria-hidden />
    {ILLUSTRATIVE_LABEL}
  </span>
);

/** Brings an output into view and pulses it, so the nurse sees where a fact went. */
function showTarget(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.classList.remove("flash-in");
  void element.offsetWidth;
  element.classList.add("flash-in");
}

function WhereItWent({ fact, fieldLabel }: { fact: DemoFact; fieldLabel: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-cap font-medium text-ink-3">Where this went:</span>
      {reachesAssessment(fact) && (
        <button type="button" className="chip chip-tint cursor-pointer" onClick={() => showTarget(`ws-field-${fact.fieldId}`)}>
          <ArrowRight size={13} aria-hidden />
          Assessment: {fieldLabel}
        </button>
      )}
      {reachesCarePlan(fact) && (
        <button type="button" className="chip chip-tint cursor-pointer" onClick={() => showTarget(`ws-plan-${fact.id}`)}>
          <ArrowRight size={13} aria-hidden />
          Care plan: {fact.barrier ? fact.barrier.task : fact.label}
        </button>
      )}
    </div>
  );
}

function FactCard({ fact, memberId, call, now, segment, fieldLabel }: { fact: DemoFact; memberId: string; call: CallState; now: string; segment: { index: number; t: string; text: string } | null; fieldLabel: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const band = bandOf(fact);
  const confirmed = isConfirmed(fact, call);
  const value = finalValue(fact, call);
  const tone = confirmed ? "border-[#c9ecd3] bg-ok-tint" : fact.highRisk ? "border-[#f0cd94] bg-amber-tint" : band === "low" ? "border-line bg-navy-100" : "border-line bg-surface-2";

  const setConfirmed = (next: boolean) => demo.reviewFact(memberId, fact.id, fact.value, { confirmed: next }, next ? "Confirmed" : "Confirmation removed", now);
  const saveDraft = () => {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== value) {
      demo.reviewFact(memberId, fact.id, fact.value, { edit: draft.trim() === fact.value ? null : draft.trim() }, "Edited", now);
    }
    setDraft(null);
  };

  return (
    <li className={`rounded-xl border p-2.5 text-foot ${tone}`}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5" aria-label={fact.highRisk ? `I verified ${fact.label} with the person on the call` : `Confirm ${fact.label}`} checked={confirmed} disabled={band === "low"} onChange={(e) => setConfirmed(e.target.checked)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="leading-snug font-bold text-navy-800">{fact.label}</p>
            {fact.highRisk ? (
              <span className="chip chip-outline shrink-0">
                <TriangleAlert size={13} aria-hidden />
                High risk
              </span>
            ) : fact.barrier ? (
              <span className="chip chip-outline shrink-0">Barrier</span>
            ) : null}
          </div>

          {draft !== null ? (
            <div className="mt-1.5">
              <label className="sr-only" htmlFor={`edit-${fact.id}`}>
                Edit {fact.label}
              </label>
              <textarea
                id={`edit-${fact.id}`}
                rows={2}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDraft(null);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveDraft();
                  }
                }}
                className="field"
              />
              <div className="mt-1 flex gap-1">
                <button type="button" className="btn btn-primary btn-sm" disabled={draft.trim() === ""} onClick={saveDraft}>
                  Save edit
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 leading-snug">{value}</p>
          )}

          <div className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-cap text-ink-2">
            {segment && <span>Source: {segment.t}</span>}
            {segment && (
              <button type="button" className="flex items-center gap-1 font-medium text-action hover:underline" title={segment.text} onClick={() => showTarget(`ws-line-${segment.index}`)}>
                <MessagesSquare size={13} aria-hidden />
                Show line
              </button>
            )}
            <span>Confidence {Math.round(fact.confidence * 100)}%</span>
            {draft === null && (
              <button type="button" className="ml-auto flex items-center gap-1 font-medium text-action hover:underline" aria-label={`Edit ${fact.label}: ${value}`} onClick={() => setDraft(value)}>
                <Pencil size={13} aria-hidden />
                Edit
              </button>
            )}
          </div>

          {band === "low" ? (
            <p className="mt-1 text-cap text-ink-2">Stays unconfirmed: too uncertain to reach the assessment or care plan.</p>
          ) : !confirmed && fact.highRisk ? (
            <p className="mt-1 text-cap text-ink-2">Tick only after verifying this with the person on the call.</p>
          ) : null}
          {confirmed && <WhereItWent fact={fact} fieldLabel={fieldLabel} />}
        </div>
      </div>
    </li>
  );
}

function callFieldValue(facts: DemoFact[], call: CallState, memberId: string, at: string): SourcedValue {
  return {
    value: facts.map((f) => finalValue(f, call)).join("; "),
    source: "This call, clinician confirmed",
    date: at,
    evidence: facts.map((f) => ({ sheet: `data/demo/${memberId}.json`, row: f.evidenceLine + 1, column: "transcript line" })),
    flags: [{ tag: "ai-derived", note: `${ILLUSTRATIVE_LABEL}, confirmed by the clinician` }],
  };
}

function VolatileField({ field, facts, call, memberId, now }: { field: AssessmentField; facts: DemoFact[]; call: CallState; memberId: string; now: string }) {
  const confirmed = facts.filter((f) => f.fieldId === field.id && isConfirmed(f, call) && reachesAssessment(f));
  const previous = field.previous;
  return (
    <div className="contents">
      <dt className="pt-1.5 text-ink-3">{field.label}</dt>
      <dd id={`ws-field-${field.id}`} className="min-w-0 scroll-mt-24">
        {confirmed.length > 0 ? (
          <div key={confirmed.map((f) => finalValue(f, call)).join("|")} className="flash-in -mx-1 p-1">
            <Sourced v={callFieldValue(confirmed, call, memberId, now)} />
          </div>
        ) : (
          <input type="text" className="field" aria-label={field.label} placeholder="Ask on this call" value={call.fieldDrafts[field.id] ?? ""} onChange={(e) => demo.setFieldDraft(memberId, field.id, e.target.value)} />
        )}
        <span className="muted tnum mt-1 block">
          Previously:{" "}
          {previous && previous.value !== null ? (
            <>
              {String(previous.value)} ({previous.date ? fmt(previous.date) : "date not in source data"})
            </>
          ) : (
            "Not in source data"
          )}
        </span>
      </dd>
    </div>
  );
}

function AssessmentTable({ fields, facts, call, memberId, now }: { fields: AssessmentField[]; facts: DemoFact[]; call: CallState; memberId: string; now: string }) {
  const [showAll, setShowAll] = useState(false);
  const known = new Set(fields.map((f) => f.id));
  // A fact with no matching field gets its own row, but only once it could actually reach one.
  const extra: AssessmentField[] = facts
    .filter((f) => !known.has(f.fieldId) && bandOf(f) !== "low" && reachesAssessment(f))
    .filter((f, i, list) => list.findIndex((x) => x.fieldId === f.fieldId) === i)
    .map((f) => ({ id: f.fieldId, label: f.label, kind: "volatile", value: null, previous: null }));
  const allVolatile = fields.filter((f) => f.kind === "volatile");
  const relevant = (f: AssessmentField) => Boolean(f.previous?.value) || facts.some((x) => x.fieldId === f.id);
  const primary = [...allVolatile.filter(relevant), ...extra];
  const others = allVolatile.filter((f) => !relevant(f));
  const stable = fields.filter((f) => f.kind === "stable");
  return (
    <div className="space-y-4 text-foot">
      <div>
        <h4 className="mb-1.5 text-cap font-medium text-ink-3">Stable: carried forward, with source and date</h4>
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          {stable.map((field) => (
            <div key={field.id} className="contents">
              <dt className="text-ink-3">{field.label}</dt>
              <dd>
                {field.value ? (
                  <>
                    <span className="chip chip-ok mb-0.5"><Lock size={12} aria-hidden />Carried forward</span>
                    <Sourced v={field.value} />
                  </>
                ) : (
                  <NotInSource />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h4 className="mb-1.5 text-cap font-medium text-ink-3">Volatile: blank until asked on this call</h4>
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          {primary.map((field) => (
            <VolatileField key={field.id} field={field} facts={facts} call={call} memberId={memberId} now={now} />
          ))}
          {showAll && others.map((field) => <VolatileField key={field.id} field={field} facts={facts} call={call} memberId={memberId} now={now} />)}
        </dl>
        {others.length > 0 && (
          <button type="button" className="mt-2 text-cap text-action hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hide" : "Show"} {others.length} more fields with no prior value
          </button>
        )}
      </div>
    </div>
  );
}

function Block({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Left column: everything to know before and during the call. */
function PatientContext({ member, contact }: { member: MemberRecord; contact: ContactOption | null }) {
  const reach = member.reachability;
  const memberHref = `/member/${encodeURIComponent(member.id)}`;
  const conflicts = member.medications.rows.filter((r) => r.conflict);
  const meds = conflicts.length > 0 ? conflicts : member.medications.rows.filter((r) => r.active).slice(0, 3);
  const barriers = member.carePlan.tasks.filter((t) => t.open && /barrier/i.test(t.itemType));
  const tasks = member.carePlan.tasks.filter((t) => t.open && !/goal|barrier/i.test(t.itemType));
  const barrierCount = barriers.length + member.sdoh.length;
  return (
    <div className="flex flex-col gap-3 text-foot">
      <section className="panel p-3.5">
        <h2 className="sect mb-2.5 flex items-center gap-1.5">
          <ClipboardList size={17} aria-hidden className="text-action" />
          Pre-call: Member Snapshot
        </h2>
        <div className="flex items-start gap-2.5">
          <span aria-hidden className={`avatar size-12! text-head ${avatarTone(member.id)}`}>{initialsOf(member.name.value, member.id)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-navy-800">
              <Sourced v={member.name} mode="tight" focusable={false} />
            </p>
            <p className="tnum text-cap text-ink-2">
              {member.id} · Age {member.age.value ?? "not in source data"} · {member.sex.value ?? "Sex not in source data"}
            </p>
          </div>
          <Link href={memberHref} aria-label="Open Member Insight Hub" title="Open Member Insight Hub" className="text-action">
            <ArrowUpRight size={18} aria-hidden />
          </Link>
        </div>
        <dl className="mt-3 space-y-2">
          <div className="flex items-start gap-2">
            <dt><Phone size={15} aria-hidden className="mt-0.5 text-ink-3" /><span className="sr-only">Calling</span></dt>
            <dd className="min-w-0">
              {contact ? (
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="tnum font-semibold">{contact.value}</span>
                    <span className={`chip ${contact.statusClass === "working" ? "chip-ok" : "chip-amber"}`}><Sourced v={contact.status} mode="tight" focusable={false} /></span>
                  </span>
                  <Sourced v={contact.owner} mode="tight" className="text-cap text-ink-2" />
                  <Sourced v={contact.consent.text} mode="tight" className="text-cap text-ink-2" />
                </span>
              ) : (
                <NotInSource />
              )}
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <dt><Clock3 size={15} aria-hidden className="mt-0.5 text-ink-3" /><span className="sr-only">Best time</span></dt>
            <dd className="min-w-0"><Sourced v={reach.bestTime} mode="tight" /></dd>
          </div>
          <div className="flex items-start gap-2">
            <dt><Languages size={15} aria-hidden className="mt-0.5 text-ink-3" /><span className="sr-only">Language</span></dt>
            <dd className="min-w-0">
              <Sourced v={reach.language} mode="tight" />
              <span className="block text-cap text-ink-2">{reach.interpreterRequired ? "Interpreter needed" : "Interpreter not flagged"}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel flex flex-col gap-3 p-3.5">
        <Block icon={<BedDouble size={16} aria-hidden className="text-action" />} title="Triggering event">
          <p className="leading-snug"><Sourced v={member.trigger} mode="tight" /></p>
          <div className="mt-1.5 flex min-w-0 flex-col items-start gap-1.5">
            {member.clocks.slice(0, 2).map((clock) => (
              <ClockBadge key={clock.id} clock={clock} />
            ))}
            {member.clocks.length === 0 && <span className="text-ink-2">No running clock</span>}
          </div>
        </Block>

        <Block icon={<Pill size={16} aria-hidden className="text-action" />} title="Key medications">
          {meds.length === 0 ? (
            <NotInSource />
          ) : (
            <ul className="space-y-1.5">
              {meds.map((row) => (
                <li key={row.key} className="leading-snug">
                  <span className="font-medium">{row.label}</span>
                  {row.conflict ? (
                    <>
                      <span className="ml-1.5 inline-flex flex-wrap items-center gap-1">
                        <ExceptionChip flag={{ tag: "conflicting", severe: row.conflict.severity === "severe" }} />
                      </span>
                      <span className="tnum mt-0.5 line-clamp-3 text-cap text-ink-2" title={row.conflict.summary}>{row.conflict.summary}</span>
                    </>
                  ) : row.dispensed[0]?.date ? (
                    <span className="tnum block text-cap text-ink-2">Last fill {fmt(row.dispensed[0].date)}</span>
                  ) : (
                    <span className="block text-cap text-ink-2">No fill in source data</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block icon={<AlertTriangle size={16} aria-hidden className="text-action" />} title={`Open barriers (${barrierCount})`}>
          {barrierCount === 0 ? (
            <NotInSource />
          ) : (
            <ul className="space-y-1.5">
              {barriers.map((task) => (
                <li key={task.id}><Sourced v={task.text} mode="tight" /></li>
              ))}
              {member.sdoh.map((item, index) => (
                <li key={index} className="leading-snug">
                  <span className="font-medium">{item.domain}: </span>
                  <Sourced v={item.text} mode="tight" />
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block icon={<ClipboardCheck size={16} aria-hidden className="text-action" />} title={`Open tasks (${tasks.length})`}>
          {tasks.length === 0 ? (
            <p className="text-ink-2">No open task.</p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-1.5 leading-snug">
                  <Square size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                  <span className="tnum min-w-0">
                    {String(task.text.value ?? "Not in source data")}
                    {task.dueAt && <span className="text-ink-2"> (Due {fmt(task.dueAt)})</span>}
                    {task.overdue && <span className="font-semibold text-crimson"> Overdue</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Link href={memberHref} className="btn btn-secondary w-full text-action no-underline">
          View full Member Insights
          <ArrowUpRight size={15} aria-hidden />
        </Link>
      </section>
    </div>
  );
}

/** The owner and due date a barrier's task carries: the nurse's edits, or the pipeline's defaults. */
function proposalValues(fact: DemoFact, member: MemberRecord, call: CallState, asOf: string) {
  const barrier = fact.barrier!;
  const edits = call.proposals[fact.id];
  const defaultOwner = barrier.owner === "Assigned CM" ? shortPerson(member.assignedCm.value) || barrier.owner : barrier.owner;
  return { owner: edits?.owner ?? defaultOwner, dueAt: edits?.dueAt ?? dateOnly(addBusinessDays(asOf, barrier.dueBusinessDays)) };
}

function ProposalCard({ fact, member, call, asOf, now }: { fact: DemoFact; member: MemberRecord; call: CallState; asOf: string; now: string }) {
  const barrier = fact.barrier!;
  const accepted = call.tasks.find((t) => t.factId === fact.id);
  const { owner, dueAt } = proposalValues(fact, member, call, asOf);
  return (
    <li id={`ws-plan-${fact.id}`} className="flash-in scroll-mt-24 rounded-xl border border-line bg-white p-2.5 text-foot">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-semibold">{barrier.task}</p>
        {accepted ? (
          <span className="chip chip-ok">
            <Check size={13} aria-hidden />
            In care plan
          </span>
        ) : (
          <span className="chip chip-quiet">Draft</span>
        )}
      </div>
      <p className="muted mt-0.5">Barrier: {finalValue(fact, call)}</p>
      {accepted ? (
        <p className="tnum mt-1 text-ink-2">
          Owner: {accepted.owner}. Due: {fmt(accepted.dueAt)}. Shown on the Member Insight Hub under the care plan, labelled as proposed from the workspace.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <label className="min-w-[8rem] flex-1 text-cap text-ink-3">
            Owner
            <input type="text" className="field mt-0.5 text-navy-900" value={owner} onChange={(e) => demo.setProposal(member.id, fact.id, { owner: e.target.value })} />
          </label>
          <label className="text-cap text-ink-3">
            Due date
            <input type="date" className="field tnum mt-0.5 text-navy-900" value={dueAt} onChange={(e) => demo.setProposal(member.id, fact.id, { dueAt: e.target.value })} />
          </label>
          <button type="button" className="btn btn-primary" disabled={owner.trim() === "" || dueAt === ""} onClick={() => demo.acceptTask(member.id, { factId: fact.id, task: barrier.task, owner: owner.trim(), dueAt, barrier: finalValue(fact, call) }, fact.value, now)}>
            Accept task
          </button>
        </div>
      )}
    </li>
  );
}

export function EngagementHub({ memberId, initialTarget }: { memberId: string; initialTarget: string | null }) {
  const { resource, reload } = useMember(memberId);
  if (resource.status === "loading") return <LoadingBlocks label="Loading the Care Engagement Hub" rows={3} />;
  if (resource.status === "error" || !resource.data) {
    return <MemberLoadFailure notFound={resource.error?.status === 404} title="The Care Engagement Hub did not load" message={resource.error?.message ?? "The response could not be read."} onRetry={() => void reload()} />;
  }
  const { member, demo: fixture, asOf } = resource.data;
  const target = member.reachability.options.find((o) => o.key === initialTarget) ?? null;
  return <Workspace member={member} fixture={fixture} target={target} asOf={asOf} />;
}

function Workspace({ member, fixture, target, asOf }: { member: MemberRecord; fixture: DemoFixture | null; target: ContactOption | null; asOf: string }) {
  const state = useDemo();
  const elapsed = useElapsedMinutes();
  const now = nowFrom(asOf, elapsed);
  const call = state.calls[member.id] ?? EMPTY_CALL;
  const transcript = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [reviewTab, setReviewTab] = useState<"facts" | "ledger">("facts");
  const [factFilter, setFactFilter] = useState<"all" | "risk" | "barrier" | "low">("all");
  const lines = fixture?.transcript ?? [];
  const running = call.started && call.consent && call.linePos < lines.length;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => demo.advanceLine(member.id), 1200);
    return () => window.clearInterval(timer);
  }, [running, member.id]);

  useEffect(() => {
    const box = transcript.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [call.linePos, tab]);

  const reach = member.reachability;
  const contact = target ?? reach.best;
  const chips = member.actions.filter((a) => !call.dismissedChips.includes(a.id));
  const facts = (fixture?.facts ?? []).filter((f) => call.consent && f.evidenceLine < call.linePos);
  const planFacts = facts.filter((f) => isConfirmed(f, call) && reachesCarePlan(f));
  const fieldLabel = (fact: DemoFact) => member.assessmentFields.find((f) => f.id === fact.fieldId)?.label ?? fact.label;
  const factById = new Map((fixture?.facts ?? []).map((f) => [f.id, f]));
  const unreviewed = facts.filter((f) => !call.ledger.some((entry) => entry.factId === f.id));
  const finished = call.linePos >= lines.length && lines.length > 0;
  const lastLine = call.linePos > 0 ? lines[Math.min(call.linePos, lines.length) - 1] : null;
  const memberHref = `/member/${encodeURIComponent(member.id)}`;
  const openCase = member.carePlan.cases.find((c) => !c.closeAt) ?? null;
  const headClock = member.clocks.find((c) => c.cls === "toc_contact") ?? member.clocks[0] ?? null;
  const firstOpenGuide = member.callGuide.find((item) => !call.checkedGuide.includes(item.id));
  const counts = { all: facts.length, risk: facts.filter((f) => f.highRisk).length, barrier: facts.filter((f) => f.barrier).length, low: facts.filter((f) => bandOf(f) === "low").length };
  const shownFacts = facts.filter((f) => factFilter === "all" || (factFilter === "risk" && f.highRisk) || (factFilter === "barrier" && f.barrier) || (factFilter === "low" && bandOf(f) === "low"));
  const pendingTasks = planFacts.filter((f) => f.barrier && !call.tasks.some((t) => t.factId === f.id));
  const confirmedCount = facts.filter((f) => isConfirmed(f, call)).length;
  const addAll = () => pendingTasks.forEach((fact) => {
    const { owner, dueAt } = proposalValues(fact, member, call, asOf);
    demo.acceptTask(member.id, { factId: fact.id, task: fact.barrier!.task, owner: owner.trim(), dueAt, barrier: finalValue(fact, call) }, fact.value, now);
  });

  return (
    <div className="w-full px-5 pt-3.5 pb-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-foot font-medium text-navy-800">
        <Link href="/" className="no-underline hover:underline">Cases</Link>
        <ChevronRight size={14} aria-hidden />
        <Link href={memberHref} className="tnum no-underline hover:underline">{openCase?.id ?? member.id}</Link>
        <ChevronRight size={14} aria-hidden />
        Care Engagement Hub
      </nav>
      <div className="mt-1 flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-large font-bold text-navy-800">Care Engagement Hub</h1>
          <p className="mt-0.5 text-foot text-ink-2">Outreach, assessment and documentation in one place</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headClock && <ClockBadge clock={headClock} showLabel={false} />}
          <span className="chip chip-outline tnum">Case: {openCase?.id ?? "Not in source data"}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_25rem]">
        <aside aria-label="Pre-call member snapshot" className="min-w-0">
          <PatientContext member={member} contact={contact} />
        </aside>

        {/* The call */}
        <section aria-label="Call and assessment" className="flex min-w-0 flex-col gap-3">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 p-3.5">
              <Phone size={22} aria-hidden strokeWidth={1.8} className="shrink-0 text-action" />
              <div className="min-w-0 flex-1">
                <h2 className="text-head font-bold text-navy-800">
                  Call replay with <Sourced v={member.name} mode="tight" focusable={false} />
                </h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`chip tnum ${running ? "chip-ok" : finished ? "chip-tint" : "chip-quiet"}`}>
                    {finished ? <Check size={13} aria-hidden /> : running ? <Mic size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
                    {finished ? "Replay finished" : running ? "Replaying" : "Not transcribing"}
                    {lastLine ? ` · ${lastLine.t}` : ""}
                  </span>
                  <span className="tnum text-cap text-ink-2">
                    {fixture ? `${contact ? `${contact.value} · ` : ""}${fixture.callWith}. Interpreter: ${fixture.interpreter}.` : "This member has no demo call content."}
                  </span>
                </p>
              </div>
              {!finished && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!call.consent || lines.length === 0} onClick={() => demo.setStarted(member.id, !call.started)}>
                    {running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                    {running ? "Pause" : call.linePos === 0 ? "Start transcription" : "Resume"}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!call.consent || lines.length === 0} onClick={() => demo.setLinePos(member.id, call.linePos + 1)}>
                    <SkipForward size={14} aria-hidden />
                    Next line
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!call.consent || lines.length === 0}
                    onClick={() => {
                      demo.setStarted(member.id, false);
                      demo.setLinePos(member.id, lines.length);
                    }}
                  >
                    Show all
                  </button>
                </div>
              )}
            </div>

            <div className="p-3.5">
              <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-3 ${call.consent ? "border-[#c9ecd3] bg-ok-tint" : "border-line bg-surface-2"}`}>
                <span className="flex items-center gap-2 font-bold text-navy-800">
                  {call.consent ? <ShieldCheck size={18} aria-hidden /> : <Lock size={17} aria-hidden />}
                  Consent for transcription
                </span>
                <Switch checked={call.consent} onChange={(next) => demo.setConsent(member.id, next)} label={call.consent ? "Consent recorded for this replay" : "Not consented"} />
                <p className="min-w-[14rem] flex-1 text-cap leading-snug text-ink-2">
                  {call.consent ? "Transcription runs only while consent is on. The member can opt out anytime." : "Turn on consent to enable transcription. This replays a stored transcript: no call is placed and there is no live speech recognition."}
                </p>
              </div>

              <div role="tablist" aria-label="Capture" className="tabs mt-3">
                <button type="button" role="tab" aria-selected={tab === "transcript"} className="tab" onClick={() => setTab("transcript")}>
                  <AudioLines size={16} aria-hidden />
                  Transcript Replay
                </button>
                <button type="button" role="tab" aria-selected={tab === "notes"} className="tab" onClick={() => setTab("notes")}>
                  <NotebookPen size={16} aria-hidden />
                  Typed Notes
                </button>
                <span className="tnum ml-auto hidden items-center gap-1.5 self-center pr-1 text-cap whitespace-nowrap text-ink-2 sm:flex">
                  {Math.min(call.linePos, lines.length)} of {lines.length} lines
                </span>
              </div>

              <div className="mt-2.5">
                {tab === "notes" ? (
                  <label className="block text-cap font-medium text-ink-3">
                    Quick notes
                    <textarea rows={6} className="field mt-1 font-normal text-navy-900" value={call.notes} onChange={(e) => demo.setNotes(member.id, e.target.value)} placeholder="Stays in this session only" />
                  </label>
                ) : call.consent && call.linePos > 0 ? (
                  <div ref={transcript} className="max-h-72 space-y-0.5 overflow-y-auto pr-1" aria-live="polite">
                    {lines.slice(0, call.linePos).map((line, index) => {
                      const mine = isClinician(line.speaker);
                      return (
                        <motion.div key={`${line.t}-${index}`} id={`ws-line-${index}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className={`grid scroll-mt-4 grid-cols-[2.8rem_minmax(0,1fr)] gap-x-2 rounded-lg px-2 py-1.5 text-foot leading-snug sm:grid-cols-[2.8rem_6.5rem_minmax(0,1fr)] ${mine ? "" : "bg-[#eef1ff]"}`}>
                          <span className="tnum pt-0.5 text-cap text-ink-2">{line.t}</span>
                          <span><span className={`chip line-clamp-1 ${mine ? "chip-tint" : "bg-[#e4f1ff]"}`}>{line.speaker}</span></span>
                          <p className="col-span-2 mt-1 sm:col-span-1 sm:mt-0">{line.text}</p>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-2 text-foot text-ink-2">{call.consent ? "Start transcription to replay this call." : "The transcript stays empty until consent is on."}</p>
                )}
              </div>
              {fixture && <p className="mt-2">{AI_LABEL}</p>}

              <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-line pt-3">
                <span className="flex items-center gap-1.5 pt-1 text-foot font-semibold whitespace-nowrap text-navy-800">
                  <Sparkles size={16} aria-hidden className="text-action" />
                  Suggested from this trigger
                </span>
                <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  <AnimatePresence initial={false}>
                    {chips.map((action) => (
                      <motion.li layout="position" key={action.id} exit={{ opacity: 0, scale: 0.92 }} transition={SPRING_FAST} title={`${action.title}. ${action.reason}`} className="flex max-w-full items-center gap-1 rounded-[10px] border border-[#ddd8ff] bg-action-tint py-1 pr-1 pl-2.5 text-foot leading-snug font-medium text-action-strong">
                        <span className="tnum line-clamp-2 min-w-0">{action.title}</span>
                        <button type="button" aria-label={`Dismiss: ${action.title}`} className="shrink-0 rounded p-0.5 text-ink-3 transition-colors duration-100 hover:bg-line hover:text-navy-900" onClick={() => demo.dismissChip(member.id, action.id)}>
                          <X size={14} aria-hidden />
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  {chips.length === 0 && <li className="pt-1 text-foot text-ink-2">All suggestions dismissed.</li>}
                  {call.dismissedChips.length > 0 && (
                    <li>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => demo.restoreChips(member.id)}>
                        Restore {call.dismissedChips.length}
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          <section className="panel p-3.5">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2.5">
              <ClipboardList size={19} aria-hidden strokeWidth={1.8} className="text-action" />
              <h2 className="sect flex-1">Call Guide &amp; Assessment</h2>
              <span className="chip chip-quiet tnum">
                {call.checkedGuide.length} of {member.callGuide.length} prompts completed
              </span>
            </div>
            <div className="grid gap-x-4 gap-y-4 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="min-w-0">
                {member.callGuide.length === 0 ? (
                  <NotInSource />
                ) : (
                  <ul className="space-y-1">
                    {member.callGuide.map((item) => {
                      const current = item.id === firstOpenGuide?.id;
                      return (
                        <li key={item.id}>
                          <label className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-foot leading-snug ${current ? "bg-[#e9e6ff]" : ""}`} title={item.why}>
                            <input type="checkbox" className="mt-0.5" checked={call.checkedGuide.includes(item.id)} onChange={() => demo.toggleGuide(member.id, item.id)} />
                            <span>
                              {item.text}
                              <span className="muted block">{item.why}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="sub-card min-w-0">
                <h3 className="mb-2 font-bold text-navy-800">Assessment <span className="font-normal text-ink-2">(carried forward where stable)</span></h3>
                <AssessmentTable fields={member.assessmentFields} facts={facts} call={call} memberId={member.id} now={now} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setTab("notes");
                  window.scrollTo({ top: 0 });
                }}
              >
                <NotebookPen size={15} aria-hidden />
                Quick note (typed)
              </button>
            </div>
          </section>
        </section>

        {/* Review and confirm */}
        <aside aria-label="Review and confirm" className="panel flex min-w-0 flex-col p-3.5 lg:col-span-2 xl:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <ClipboardCheck size={20} aria-hidden strokeWidth={1.8} className="text-action" />
            <h2 className="flex-1 text-title font-bold text-navy-800">Review &amp; Confirm</h2>
            <span className="chip chip-tint"><Bot size={13} aria-hidden />AI Draft</span>
          </div>
          <p className="mt-1 text-foot leading-snug text-ink-2">Review AI-extracted facts, confirm high-risk items, edit if needed, and add to the Member Insight Hub.</p>

          <div role="tablist" aria-label="Review" className="tabs mt-2.5">
            <button type="button" role="tab" aria-selected={reviewTab === "facts"} className="tab" onClick={() => setReviewTab("facts")}>
              <AudioLines size={16} aria-hidden />
              Extracted Facts ({facts.length})
            </button>
            <button type="button" role="tab" aria-selected={reviewTab === "ledger"} className="tab" onClick={() => setReviewTab("ledger")}>
              <History size={16} aria-hidden />
              Audit Ledger
            </button>
          </div>

          {reviewTab === "facts" ? (
            <div className="mt-2.5">
              <div role="group" aria-label="Filter facts" className="flex flex-wrap gap-1.5">
                {([["all", `All (${counts.all})`], ["risk", `High risk (${counts.risk})`], ["barrier", `Barrier (${counts.barrier})`], ["low", `Low confidence (${counts.low})`]] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={factFilter === id} className={`btn btn-sm tnum ${factFilter === id ? "btn-soft" : "btn-secondary"}`} onClick={() => setFactFilter(id)}>
                    {id === "risk" && <TriangleAlert size={13} aria-hidden />}
                    {label}
                  </button>
                ))}
              </div>
              {facts.length === 0 ? (
                <p className="mt-3 text-foot text-ink-2">{call.consent ? "Extracted facts appear here as the transcript plays." : "Turn on consent, then start transcription to extract facts."}</p>
              ) : shownFacts.length === 0 ? (
                <p className="mt-3 text-foot text-ink-2">No fact matches this filter.</p>
              ) : (
                <ul className="mt-2.5 space-y-2">
                  {shownFacts.map((fact) => (
                    <FactCard key={fact.id} fact={fact} memberId={member.id} call={call} now={now} segment={lines[fact.evidenceLine] ? { index: fact.evidenceLine, t: lines[fact.evidenceLine].t, text: lines[fact.evidenceLine].text } : null} fieldLabel={fieldLabel(fact)} />
                  ))}
                </ul>
              )}
              {planFacts.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <h3 className="mb-2 flex items-center gap-1.5 font-bold text-navy-800">
                    <Stethoscope size={15} aria-hidden className="text-action" />
                    Care plan entries and follow-up tasks
                  </h3>
                  <ul className="space-y-2">
                    {planFacts.map((fact) =>
                      fact.barrier ? (
                        <ProposalCard key={fact.id} fact={fact} member={member} call={call} asOf={asOf} now={now} />
                      ) : (
                        <li key={fact.id} id={`ws-plan-${fact.id}`} className="flash-in scroll-mt-24 rounded-xl border border-line p-2.5 text-foot">
                          <span className="font-semibold">{fact.label}: </span>
                          {finalValue(fact, call)}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>
          ) : facts.length === 0 ? (
            <p className="mt-3 text-foot text-ink-2">Each review action is recorded here: the AI&apos;s original, the clinician&apos;s edit, the final value, the action and the time.</p>
          ) : (
            <ul className="mt-2.5 space-y-2 text-foot">
              {call.ledger.map((entry) => (
                <li key={entry.id} className="sub-card p-2.5!">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{factById.get(entry.factId)?.label ?? entry.factId}</span>
                    <span className="tnum text-cap text-ink-2" title={fmtShort(entry.at)}>{fmtTime(entry.at)}</span>
                  </p>
                  <p className="font-medium">{entry.action}</p>
                  <p className="text-cap text-ink-2">AI original: {entry.original}</p>
                  <p className="text-cap text-ink-2">Clinician edit: {entry.edit ?? "None"}</p>
                  <p className="text-cap">Final: {entry.final}</p>
                </li>
              ))}
              {unreviewed.map((fact) => (
                <li key={fact.id} className="sub-card p-2.5!">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{fact.label}</span>
                    <span className="chip chip-amber">Unconfirmed</span>
                  </p>
                  <p className="text-cap text-ink-2">
                    AI original: {fact.value} <span className="tnum whitespace-nowrap">({Math.round(fact.confidence * 100)}%)</span>
                  </p>
                  <p className="text-cap text-ink-2">Awaiting review</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-line pt-3">
            {call.tasks.length > 0 && pendingTasks.length === 0 ? (
              <Link href={`${memberHref}?tab=care`} className="flex items-center justify-center gap-2 rounded-xl bg-action px-4 py-3 text-center font-semibold text-white no-underline hover:bg-action-strong">
                <Check size={18} aria-hidden />
                <span>
                  {pluralise(call.tasks.length, "task")} added. View in Member Insight Hub
                </span>
              </Link>
            ) : (
              <button type="button" disabled={pendingTasks.length === 0} className="flex w-full items-center gap-3 rounded-xl bg-action px-4 py-2.5 text-left text-white hover:bg-action-strong disabled:opacity-50" onClick={addAll}>
                <UploadCloud size={22} aria-hidden className="shrink-0" />
                <span>
                  <span className="block font-bold">Add to Member Insight Hub</span>
                  <span className="tnum block text-cap">
                    {pendingTasks.length > 0 ? `${pluralise(pendingTasks.length, "confirmed barrier task")}, this session only` : `${confirmedCount} of ${facts.length} facts confirmed. Confirm a barrier to add its task.`}
                  </span>
                </span>
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
