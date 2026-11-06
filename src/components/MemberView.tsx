"use client";

import { Activity, AlarmClock, AlertTriangle, ArrowRight, BedDouble, CalendarCheck, CalendarDays, CalendarX, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Clock3, Copy, FileText, Gauge, HeartPulse, History, Info, Languages, Layers, MessageSquare, Phone, Pill, Shield, ShieldAlert, Sparkles, Stethoscope, Target, TriangleAlert, UserRound, UserX, Users, Check, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ChangeItem, ContactOption, DemoFixture, MemberRecord, QualityFlag, Sourced as SourcedValue } from "@lib/pipeline/types";
import { nowFrom, useElapsedMinutes } from "@/lib/clock";
import { demo, EMPTY_CALL, useDemo } from "@/lib/demoStore";
import { fmt, fmtShort, pluralise, shortPerson } from "@/lib/format";
import { triggerTiming } from "@/lib/trigger";
import { useMember, useQueue } from "@/lib/useApi";
import { ClockBadge, ClockChip, ExceptionChip, NotInSource, SeverityBadge } from "./chips";
import { Hover } from "./Hover";
import { Journey } from "./Journey";
import { MedConflictList, MedicationTable } from "./Medications";
import { ErrorState, LoadingBlocks } from "./overlays";
import { avatarTone, initialsOf } from "./QueueRowView";
import { evidenceTip, Sourced } from "./Sourced";
import { Expand } from "./ui";

type HubTab = "journey" | "meds" | "clinical" | "care" | "activity";
const HUB_TABS: { id: HubTab; label: string; icon: LucideIcon }[] = [
  { id: "journey", label: "Journey Timeline", icon: CalendarDays },
  { id: "meds", label: "Medications", icon: Pill },
  { id: "clinical", label: "Conditions, Risk & SDOH", icon: HeartPulse },
  { id: "care", label: "Care Plan & Services", icon: ClipboardCheck },
  { id: "activity", label: "Clocks, Alerts & Data Quality", icon: FileText },
];

function ActivityRow({ icon: Icon, title, detail, at, atLabel }: { icon: LucideIcon; title: string; detail: string; at: string; atLabel?: string }) {
  return (
    <li className="flex gap-2.5 border-b border-[#edf0fa] py-2.5 text-foot last:border-0">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-action">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tnum leading-snug font-semibold">{title}</p>
        <p className="tnum text-cap leading-snug text-ink-2">{detail}</p>
        <p className="tnum muted mt-0.5">{atLabel ? `${atLabel} ` : ""}{fmtShort(at)}</p>
      </div>
    </li>
  );
}

function ChangeRow({ item }: { item: ChangeItem }) {
  return (
    <li className="flex gap-2.5 border-b border-[#edf0fa] py-2.5 text-foot last:border-0">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-action">
        <Activity size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tnum leading-snug font-semibold">{item.title}</span>
          <SeverityBadge severity={item.severity} />
          {item.flags?.map((flag) => <ExceptionChip key={`${flag.tag}-${flag.note ?? ""}`} flag={flag} />)}
        </div>
        <p className="tnum mt-0.5 line-clamp-2 text-cap leading-snug text-ink-2" title={item.detail}>
          {item.detail}
        </p>
        <Hover focusable={false} className="muted tnum mt-0.5 block" content={evidenceTip(item.source, item.arrivalAt, item.evidence, item.flags)}>
          Source: {item.source} · arrived {fmtShort(item.arrivalAt)}
          {item.eventAt && item.eventAt !== item.arrivalAt ? ` · event ${fmtShort(item.eventAt)}` : ""}
        </Hover>
      </div>
    </li>
  );
}

/** A contact's status, in words and with an icon. A number that does not work is never just coloured. */
function ContactStatus({ option }: { option: ContactOption }) {
  const working = option.statusClass === "working";
  const known = option.statusClass !== "unknown";
  return (
    <span className={`chip ${working ? "chip-ok" : known ? "chip-amber" : "chip-quiet"}`}>
      {working ? <Check size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
      <Sourced v={option.status} mode="tight" focusable={false} />
    </span>
  );
}


/**
 * Profile completeness is not in the API. It is derived here from the core profile fields: a field
 * counts when it has a value and carries no conflict, stale or unverified flag.
 */
function profileCompleteness(member: MemberRecord) {
  const reach = member.reachability;
  const fields: { label: string; values: SourcedValue[] }[] = [
    { label: "Name", values: member.recordedNames },
    { label: "Date of birth", values: member.dobs },
    { label: "Sex", values: [member.sex] },
    { label: "Language", values: [reach.language] },
    { label: "Address", values: [reach.addressOnFile] },
    { label: "PCP", values: member.attributedPcps },
    { label: "Allergies", values: member.allergies },
    { label: "Best time", values: [reach.bestTime] },
    { label: "Last confirmed contact", values: [reach.lastConfirmed] },
  ];
  const rows = fields.map(({ label, values }) => ({
    label,
    ok: values.length > 0 && values.every((v) => v.value !== null && v.value !== "" && !v.flags?.length),
    missing: values.length === 0 || values.every((v) => v.value === null || v.value === ""),
  }));
  return { rows, ok: rows.filter((r) => r.ok).length, total: rows.length };
}

const APPOINTMENT_STATE: { pattern: RegExp; label: string; icon: typeof CalendarCheck; className: string }[] = [
  { pattern: /no.?show/i, label: "No-show", icon: UserX, className: "chip-amber" },
  { pattern: /cancel/i, label: "Cancelled", icon: CalendarX, className: "chip-outline" },
  { pattern: /complete/i, label: "Completed", icon: ClipboardCheck, className: "chip-ok" },
  { pattern: /not scheduled|never|none/i, label: "Not scheduled", icon: CalendarX, className: "chip-amber" },
  { pattern: /schedul/i, label: "Scheduled", icon: CalendarCheck, className: "chip-tint" },
];

function AppointmentStatus({ status }: { status: string | null }) {
  if (!status) return <NotInSource />;
  const match = APPOINTMENT_STATE.find((s) => s.pattern.test(status));
  if (!match) return <span>{status}</span>;
  const Icon = match.icon;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`chip ${match.className}`}>
        <Icon size={13} aria-hidden />
        {match.label}
      </span>
      {status.toLowerCase() !== match.label.toLowerCase() && <span className="muted">{status}</span>}
    </span>
  );
}


/** The not-found and failed-load states, shared with the Care Engagement Hub. */
export function MemberLoadFailure({ notFound, title, message, onRetry }: { notFound: boolean; title: string; message: string; onRetry: () => void }) {
  if (notFound) {
    return (
      <div>
        <ErrorState title="Member not found" message="This member is not in the current workbook. Go back to the queue to choose someone who is." />
        <p className="text-center">
          <Link href="/" className="btn btn-primary no-underline">
            Back to queue
          </Link>
        </p>
      </div>
    );
  }
  return <ErrorState title={title} message={message} onRetry={onRetry} />;
}

export function MemberView({ memberId }: { memberId: string }) {
  const { resource, reload } = useMember(memberId);

  if (resource.status === "loading") return <LoadingBlocks label="Loading the Member Insight Hub" rows={3} />;
  if (resource.status === "error" || !resource.data) {
    return <MemberLoadFailure notFound={resource.error?.status === 404} title="The Member Insight Hub did not load" message={resource.error?.message ?? "The response could not be read."} onRetry={() => void reload()} />;
  }

  const { member, flags, demo: fixture, asOf } = resource.data;
  return <MemberRecordView member={member} flags={flags} fixture={fixture} asOf={asOf} />;
}

function SectionHead({ icon, title, aside }: { icon?: React.ReactNode; title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line pb-2">
      <h2 className="sect flex items-center gap-1.5">
        {icon}
        {title}
      </h2>
      {aside}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label mb-0.5">{label}</dt>
      <dd className="min-w-0 text-foot">{children}</dd>
    </div>
  );
}

function MemberRecordView({ member, flags, fixture, asOf }: { member: MemberRecord; flags: QualityFlag[]; fixture: DemoFixture | null; asOf: string }) {
  const state = useDemo();
  const elapsed = useElapsedMinutes();
  const params = useSearchParams();
  const { resource: queueResource } = useQueue();
  const [allSignals, setAllSignals] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showSourceFlags, setShowSourceFlags] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [activityFilter, setActivityFilter] = useState<"all" | "important" | "session">("all");
  const asked = params.get("tab") === "care" ? "care" : "journey";
  // A link's ?tab= wins until the reader picks a tab here.
  const [picked, setPicked] = useState<{ tab: HubTab; asked: string } | null>(null);
  const tab: HubTab = picked && picked.asked === asked ? picked.tab : asked;
  const pick = (next: HubTab) => setPicked({ tab: next, asked });

  const reach = member.reachability;
  const priority = member.priority;
  const engageHref = `/member/${encodeURIComponent(member.id)}/engage`;
  const logOutreach = () => {
    const contact = reach.best;
    demo.logAttempt({ memberId: member.id, kind: reach.preferredAction, target: contact?.value ?? "", owner: contact ? String(contact.owner.value ?? "") : "", at: nowFrom(asOf, elapsed) });
  };

  const call = state.calls[member.id] ?? EMPTY_CALL;
  const attempts = state.attempts.filter((a) => a.memberId === member.id);
  const confirmedBarriers = (fixture?.facts ?? []).filter((f) => f.barrier && call.facts[f.id]?.confirmed);
  const severityOrder = ["severe", "high", "medium", "low"];
  const ruleFlags = flags.filter((f) => f.type !== "source_flag");
  const sourceFlags = flags.filter((f) => f.type === "source_flag");
  const sortedFlags = [...ruleFlags].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  const topSignals = [...member.signals].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)).slice(0, 3);
  const signalsShown = allSignals ? member.signals : member.signals.filter((sig) => sig.severity !== "low");
  const actions = member.actions.slice(0, 3);
  const conflictRows = member.medications.rows.filter((r) => r.conflict);
  const severeConflict = conflictRows.some((r) => r.conflict!.severity === "severe");
  const conflictCount = conflictRows.length + (reach.languageConflict ? 1 : 0);
  const profile = profileCompleteness(member);
  const profilePercent = Math.round((profile.ok / profile.total) * 100);
  const topRisk = member.risk.find((r) => r.tier.value !== null) ?? null;
  const goalsAndBarriers = member.carePlan.tasks.filter((t) => /goal|barrier/i.test(t.itemType));
  const tasksOnly = member.carePlan.tasks.filter((t) => !/goal|barrier/i.test(t.itemType));
  const openGoal = member.carePlan.tasks.find((t) => t.open && /goal/i.test(t.itemType) && t.text.value);
  const barriers = member.carePlan.tasks.filter((t) => t.open && /barrier/i.test(t.itemType) && t.text.value);
  const nextTask = tasksOnly.filter((t) => t.open).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))[0] ?? null;
  const openCase = member.carePlan.cases.find((c) => !c.closeAt) ?? null;
  const clinicalDriver = priority.drivers.find((d) => d.key === "clinicalRisk");
  const conditions = member.conditions.coded.filter((code) => code.label);
  const tocClock = member.clocks.find((c) => c.cls === "toc_contact") ?? member.clocks.find((c) => c.cls === "safety") ?? member.clocks[0] ?? null;
  const timing = triggerTiming(member, member);
  const caregiver = reach.options.find((o) => !o.ownerIsMember && o.kind === "phone") ?? null;
  const queue = queueResource.data?.queue ?? [];
  const position = queue.findIndex((row) => row.id === member.id);
  const previous = position > 0 ? queue[position - 1] : null;
  const next = position >= 0 && position < queue.length - 1 ? queue[position + 1] : null;
  const memberLink = (id: string) => `/member/${encodeURIComponent(id)}`;
  const initials = initialsOf(member.name.value, member.id);

  const activity = member.changes.items.filter((item) => activityFilter === "all" || (activityFilter === "important" && (item.severity === "severe" || item.severity === "high")));

  return (
    <div className="@container w-full space-y-3 px-5 pt-3.5 pb-8">
      {/* Title row, alerts and case navigation */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-foot font-medium text-navy-800">
            <Link href="/" className="no-underline hover:underline">Cases</Link>
            <ChevronRight size={14} aria-hidden />
            <span className="tnum">{openCase?.id ?? member.id}</span>
          </nav>
          <h1 className="mt-1 flex items-center gap-2 text-large font-bold text-navy-800">
            Member Insight Hub
            <Hover focusable={false} content={<p>Every value here has a source. Sources that disagree stay side by side, and nothing is merged.</p>}>
              <Info size={17} aria-hidden className="text-ink-3" />
            </Hover>
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {member.duplicateBanner && (
            <div className="flex items-center gap-3 rounded-xl border border-amber bg-amber-tint px-3.5 py-2 text-foot">
              <AlertTriangle size={17} aria-hidden className="shrink-0" />
              <span className="tnum">Possible duplicate: {pluralise(member.recordedNames.length, "recorded name")}</span>
              <button type="button" aria-expanded={showDuplicate} className="font-medium text-action underline" onClick={() => setShowDuplicate((v) => !v)}>Review</button>
            </div>
          )}
          {conflictCount > 0 && (
            <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-2 text-foot ${severeConflict ? "border-[#f6c3c9] bg-crimson-tint" : "border-amber bg-amber-tint"}`}>
              <AlertTriangle size={17} aria-hidden className={`shrink-0 ${severeConflict ? "text-crimson" : ""}`} />
              <span className="tnum font-medium">
                {pluralise(conflictCount, "data conflict")}
                {severeConflict ? ", severe" : ""}
              </span>
              <button type="button" className="font-medium text-action underline" onClick={() => pick(conflictRows.length > 0 ? "meds" : "activity")}>Review</button>
            </div>
          )}
          {position >= 0 && (
            <div className="flex items-center gap-1.5">
              <Link aria-label="Previous case" href={previous ? memberLink(previous.id) : "#"} aria-disabled={!previous} className={`btn btn-secondary btn-sm px-2! no-underline ${previous ? "" : "pointer-events-none opacity-45"}`}>
                <ChevronLeft size={16} aria-hidden />
              </Link>
              <span className="tnum px-1.5 text-foot font-semibold whitespace-nowrap">{position + 1} of {pluralise(queue.length, "case")}</span>
              <Link aria-label="Next case" href={next ? memberLink(next.id) : "#"} aria-disabled={!next} className={`btn btn-secondary btn-sm px-2! no-underline ${next ? "" : "pointer-events-none opacity-45"}`}>
                <ChevronRight size={16} aria-hidden />
              </Link>
            </div>
          )}
        </div>
      </div>

      <Expand open={showDuplicate && member.duplicateBanner !== null}>
        {member.duplicateBanner && (
          <div role="note" className="rounded-xl border border-amber bg-amber-tint p-3.5 text-foot">
            <p className="flex items-center gap-2 font-semibold">
              <Copy size={15} aria-hidden />
              Possible duplicate: unlinked records exist. Nothing has been merged.
            </p>
            <div className="tnum mt-1.5 flex flex-wrap gap-x-8 gap-y-1">
              {member.recordedNames.map((name, index) => (
                <p key={index}>
                  <span className="font-semibold">{String(name.value ?? "Not in source data")}</span> · DOB {String(member.dobs[index]?.value ?? "Not in source data")} · {name.source}
                </p>
              ))}
            </div>
            <Hover focusable={false} className="tnum mt-1 block leading-snug text-ink-2" content={evidenceTip(member.duplicateBanner.title, null, member.duplicateBanner.evidence)}>
              {member.duplicateBanner.detail}
            </Hover>
          </div>
        )}
      </Expand>

      {/* Case briefing strip */}
      <section aria-label="Case briefing" className="grid gap-x-5 gap-y-4 rounded-[14px] border border-[#dcd8fb] bg-[#eeedfd] p-4 text-foot @3xl:grid-cols-2 @7xl:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1.7fr)]">
        <div className="flex gap-2.5">
          <ClipboardList size={30} aria-hidden strokeWidth={1.6} className="shrink-0 text-action" />
          <div>
            <h2 className="sect">Case Briefing</h2>
            <p className="leading-snug text-ink-2">Why this member surfaced today</p>
            {priority.topTier && <span className="chip chip-outline mt-1.5"><ShieldAlert size={13} aria-hidden />Top tier</span>}
          </div>
        </div>
        <div className="min-w-0 @7xl:border-l @7xl:border-[#cfcaf5] @7xl:pl-4">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800"><BedDouble size={16} aria-hidden className="text-action" />Trigger</h3>
          <p className="mt-1 font-medium"><Sourced v={member.trigger} mode="tight" focusable={false} /></p>
          <p className="tnum muted mt-0.5">{timing.eventAt ? fmt(timing.eventAt) : "Date not in source data"}</p>
        </div>
        <div className="min-w-0 @7xl:border-l @7xl:border-[#cfcaf5] @7xl:pl-4">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800"><Clock3 size={16} aria-hidden className="text-action" />{tocClock?.cls === "toc_contact" ? "TOC Clock" : "Clock"}</h3>
          <div className="mt-1">{tocClock ? <ClockBadge clock={tocClock} /> : <span className="text-ink-2">No running clock</span>}</div>
        </div>
        <div className="min-w-0 @7xl:border-l @7xl:border-[#cfcaf5] @7xl:pl-4">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800"><Activity size={16} aria-hidden className="text-action" />Top Signals</h3>
          {topSignals.length === 0 ? (
            <p className="mt-1 text-ink-2">No open alerts.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {topSignals.map((signal) => (
                <li key={`${signal.code}-${signal.title}`} className="flex items-start gap-2 leading-snug">
                  <AlertTriangle size={13} aria-hidden className={`mt-0.5 shrink-0 ${signal.severity === "severe" ? "text-crimson" : "text-ink-3"}`} />
                  <Hover focusable={false} className="min-w-0" content={<>{signal.detail}{evidenceTip("Cross-source signal", null, signal.evidence)}</>}>
                    <span className="tnum">{signal.title}</span>
                    {signal.severity === "severe" && <span className="sr-only"> (severe)</span>}
                  </Hover>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 @7xl:border-l @7xl:border-[#cfcaf5] @7xl:pl-4">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800"><Sparkles size={16} aria-hidden className="text-action" />Suggested Next Actions</h3>
          {actions.length === 0 ? (
            <p className="mt-1 text-ink-2">No suggested action.</p>
          ) : (
            <ol className="mt-1.5 space-y-1.5">
              {actions.map((action) => (
                <li key={action.id}>
                  <Hover focusable={false} className="block" content={<>{action.reason}{evidenceTip("Suggested action", null, action.evidence)}</>}>
                    {action.kind === "call" || action.kind === "sms" ? (
                      <Link href={engageHref} onClick={logOutreach} className="flex items-center gap-1.5 rounded-lg border border-[#c9c2fb] bg-white px-2.5 py-1 font-semibold text-action-strong no-underline hover:bg-action-tint">
                        <span className="tnum line-clamp-2 min-w-0 flex-1 leading-snug">{action.title}</span>
                        <ChevronRight size={15} aria-hidden className="shrink-0" />
                      </Link>
                    ) : (
                      <button type="button" onClick={() => pick("care")} className="flex w-full items-center gap-1.5 rounded-lg border border-[#c9c2fb] bg-white px-2.5 py-1 text-left font-semibold text-action-strong hover:bg-action-tint">
                        <span className="tnum line-clamp-2 min-w-0 flex-1 leading-snug">{action.title}</span>
                        <ChevronRight size={15} aria-hidden className="shrink-0" />
                      </button>
                    )}
                  </Hover>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Member and clinical overview */}
      <div className="grid gap-3 @5xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section aria-label="Member and reachability" className="panel min-w-0 p-4">
          <div className="mb-3 flex items-center gap-2.5 border-b border-line pb-2.5">
            <UserRound size={20} aria-hidden strokeWidth={1.8} className="text-action" />
            <h2 className="sect flex-1">Member &amp; Reachability</h2>
            <span className="chip chip-quiet tnum">{reach.label}</span>
          </div>
          <div className="grid gap-x-5 gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="flex min-w-0 gap-3 @3xl:border-r @3xl:border-line @3xl:pr-4">
              <span aria-hidden className={`avatar size-14! text-title ${avatarTone(member.id)}`}>{initials}</span>
              <div className="min-w-0">
                <p className="text-title font-bold text-navy-800"><Sourced v={member.name} mode="tight" focusable={false} /></p>
                <p className="tnum mt-0.5 text-ink-2">
                  {member.id} · Age {member.age.value ?? "not in source data"}
                  {member.dobs[0]?.value ? ` (${fmt(String(member.dobs[0].value))})` : ""}
                </p>
                <p className="mt-0.5 text-ink-2">
                  {member.sex.value ?? "Sex not in source data"} · <Sourced v={reach.language} mode="tight" />
                  {reach.interpreterRequired && <span className="chip chip-tint ml-1"><Languages size={13} aria-hidden />Interpreter</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {openCase && <span className="chip chip-ok">{openCase.status}</span>}
                  {member.coverage[0]?.lineOfBusiness.value && <span className="chip chip-tint">{String(member.coverage[0].lineOfBusiness.value)}</span>}
                </div>
              </div>
            </div>
            <dl className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-foot">
              <dt className="text-ink-2">Best contact</dt>
              <dd className="min-w-0">
                {reach.best ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="tnum font-medium">{reach.best.value}</span>
                    <ContactStatus option={reach.best} />
                  </span>
                ) : "None working"}
              </dd>
              <dt className="text-ink-2">On-file phone</dt>
              <dd className="min-w-0">
                {reach.primary ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="tnum font-medium">{reach.primary.value}</span>
                    <ContactStatus option={reach.primary} />
                  </span>
                ) : <NotInSource />}
              </dd>
              <dt className="text-ink-2">Best time</dt>
              <dd className="min-w-0"><Sourced v={reach.bestTime} mode="tight" /></dd>
              <dt className="text-ink-2">Preferred channel</dt>
              <dd className="flex items-center gap-1.5">
                {reach.preferredAction === "sms" ? <MessageSquare size={14} aria-hidden /> : <Phone size={14} aria-hidden />}
                {reach.preferredAction === "sms" ? "SMS" : "Phone"}
              </dd>
              <dt className="text-ink-2">Caregiver</dt>
              <dd className="min-w-0">
                {caregiver ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Sourced v={caregiver.owner} mode="tight" />
                    <Sourced v={caregiver.consent.text} mode="tight" className="text-cap text-ink-2" />
                  </span>
                ) : <NotInSource />}
              </dd>
            </dl>
          </div>
          {reach.demotionReason && (
            <p className="tnum mt-3 flex items-start gap-1.5 rounded-lg border border-amber bg-amber-tint p-2 text-foot leading-snug">
              <ShieldAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
              {reach.demotionReason}
            </p>
          )}
          <div className="mt-3 grid gap-x-4 gap-y-3 border-t border-line pt-3 @3xl:grid-cols-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold text-navy-800"><Shield size={15} aria-hidden className="text-action" />Coverage</p>
              {member.coverage[0] ? (
                <>
                  <Sourced v={member.coverage[0].product} mode="tight" className="mt-0.5" />
                  <p className="tnum muted mt-0.5 flex flex-wrap items-baseline gap-x-1">
                    <Sourced v={member.coverage[0].start} mode="tight" /> to <Sourced v={member.coverage[0].end} mode="tight" />
                  </p>
                </>
              ) : <NotInSource />}
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold text-navy-800"><Stethoscope size={15} aria-hidden className="text-action" />PCP</p>
              {member.attributedPcps.length > 0 ? <div className="mt-0.5 flex flex-col gap-0.5">{member.attributedPcps.map((pcp, i) => <Sourced key={i} v={pcp} mode="tight" />)}</div> : <NotInSource />}
              <button type="button" className="mt-0.5 text-action underline" onClick={() => pick("care")}>View care team</button>
            </div>
            <Hover
              focusable={false}
              className="block min-w-0"
              content={
                <>
                  <p className="font-semibold">Risk, from the models on record</p>
                  <p className="mt-1">{topRisk ? `${String(topRisk.model.value)}. Model date ${fmt(topRisk.tier.date) || "not in source data"}.` : "No risk model on record."}</p>
                  {clinicalDriver && <p className="tnum mt-1">Clinical risk driver: {clinicalDriver.points} of {clinicalDriver.weight} points. It says nothing about how complete the record is.</p>}
                </>
              }
            >
              <span className="flex items-center gap-1.5 font-bold text-navy-800"><Gauge size={15} aria-hidden className="text-action" />Risk score</span>
              {topRisk ? (
                <>
                  <span className="tnum mt-0.5 block font-semibold">{String(topRisk.tier.value)} ({String(topRisk.score.value ?? "score not in source data")})</span>
                  {topRisk.prior && <span className="muted tnum block">Prior {topRisk.prior}</span>}
                </>
              ) : <NotInSource />}
            </Hover>
            <Hover
              focusable={false}
              className="block min-w-0"
              content={
                <>
                  <p className="font-semibold">Not in the API. Derived in the UI.</p>
                  <p className="mt-1">A coverage indicator, not a quality guarantee. A field counts when it has a value with no conflict, stale or unverified flag.</p>
                  <ul className="mt-1">
                    {profile.rows.map((row) => (
                      <li key={row.label}>{row.ok ? "Confirmed" : row.missing ? "Missing" : "Flagged"}: {row.label}</li>
                    ))}
                  </ul>
                </>
              }
            >
              <span className="flex items-center gap-1.5 font-bold text-navy-800"><Layers size={15} aria-hidden className="text-action" />Data completeness</span>
              <span className="tnum mt-0.5 block text-head font-bold">{profilePercent}%</span>
              <span aria-hidden className="mt-0.5 block h-2 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-[#168a45]" style={{ width: `${profilePercent}%` }} />
              </span>
              <span className="muted tnum mt-0.5 block">{profile.ok} of {profile.total} fields (derived)</span>
            </Hover>
          </div>
          <button type="button" aria-expanded={showContacts} className="mt-2.5 flex items-center gap-1 text-foot font-medium text-action hover:underline" onClick={() => setShowContacts((v) => !v)}>
            <ChevronDown size={15} aria-hidden className={showContacts ? "rotate-180" : ""} />
            {showContacts ? "Hide" : "Show"} full member record and {pluralise(reach.options.length, "ranked contact")}
          </button>
          <Expand open={showContacts}>
            <dl className="mt-3 grid gap-x-5 gap-y-3 @3xl:grid-cols-2">
              <Field label="Date of birth">
                <span className="flex flex-col gap-1">{member.dobs.map((dob, i) => <Sourced key={i} v={dob} />)}</span>
              </Field>
              <Field label="Recorded names">
                <span className="flex flex-col gap-1">{member.recordedNames.map((name, i) => <Sourced key={i} v={name} />)}</span>
              </Field>
              <Field label="Coverage">
                <span className="flex flex-col gap-2">
                  {member.coverage.map((cover, index) => (
                    <span key={index} className="flex flex-col gap-0.5">
                      <Sourced v={cover.product} mode="tight" valueClassName="font-medium" />
                      <Sourced v={cover.lineOfBusiness} mode="tight" />
                      <Sourced v={cover.status} mode="tight" />
                      <span className="tnum inline-flex flex-wrap items-baseline gap-x-1 text-ink-2">
                        <Sourced v={cover.start} mode="tight" /> to <Sourced v={cover.end} mode="tight" />
                      </span>
                    </span>
                  ))}
                  {member.coverage.length === 0 && <NotInSource />}
                </span>
              </Field>
              <Field label="Language, each source">
                <span className="flex flex-col gap-1">{reach.languageValues.map((v, i) => <Sourced key={i} v={v} />)}</span>
              </Field>
              <Field label="Allergies">
                <span className="flex flex-col gap-1">{member.allergies.length ? member.allergies.map((a, i) => <Sourced key={i} v={a} />) : <NotInSource />}</span>
              </Field>
              <Field label="Household">
                <Sourced v={member.household} />
              </Field>
              <Field label="Address on file">
                <Sourced v={reach.addressOnFile} />
              </Field>
              {reach.addressActual && (
                <Field label="Address elsewhere">
                  <Sourced v={reach.addressActual} />
                </Field>
              )}
              <Field label="Last confirmed">{reach.lastConfirmed.value ? <Sourced v={reach.lastConfirmed} /> : "No successful contact on record"}</Field>
              <Field label="Contactable now">
                <span className="tnum">{reach.contactableNow.explanation}.</span>
              </Field>
            </dl>
            <div className="mt-3 overflow-x-auto">
              <table className="tbl min-w-[46rem]">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Contact</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Consent</th>
                    <th>Last confirmed</th>
                    <th>Best time</th>
                    <th>Attempts</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {reach.options.map((option) => (
                    <tr key={option.key}>
                      <td className="tnum font-semibold">{option.rank}</td>
                      <td className="tnum font-medium">
                        {option.value}
                        <span className="muted block font-normal">{option.label}</span>
                      </td>
                      <td><Sourced v={option.owner} mode="tight" /></td>
                      <td><Sourced v={option.status} mode="tight" /></td>
                      <td><Sourced v={option.consent.text} mode="tight" /></td>
                      <td><Sourced v={option.lastVerified} mode="tight" /></td>
                      <td><Sourced v={option.bestTimeText} mode="tight" /></td>
                      <td className="tnum">
                        {option.attempts.total}
                        {option.attempts.lastOutcome && <span className="muted block">Last: {option.attempts.lastOutcome}</span>}
                      </td>
                      <td className="tnum" title={option.scoreReasons.join("; ")}>{option.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Expand>
        </section>

        <section aria-label="Clinical overview" className="panel min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2.5 border-b border-line pb-2.5">
            <HeartPulse size={20} aria-hidden strokeWidth={1.8} className="text-action" />
            <h2 className="sect min-w-[10rem] flex-1 whitespace-nowrap">Clinical Overview</h2>
            {openCase && <span className="chip chip-ok">{openCase.status}</span>}
            {openCase?.openAt && <span className="tnum muted">Opened {fmt(openCase.openAt)} ({openCase.program})</span>}
          </div>
          <div className="grid gap-x-5 gap-y-4 text-foot @3xl:grid-cols-2">
            <div className="min-w-0 @3xl:border-r @3xl:border-line @3xl:pr-4">
              <h3 className="flex items-center gap-1.5 font-bold text-navy-800">Active conditions ({conditions.length})</h3>
              {conditions.length === 0 ? (
                <div className="mt-1"><NotInSource /></div>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {conditions.slice(0, 5).map((code) => (
                    <li key={code.code} className="flex items-start gap-1.5 leading-snug">
                      <ChevronRight size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                      <Hover focusable={false} className="min-w-0" content={evidenceTip("Sources", code.lastSeen, code.mentions.flatMap((m) => m.evidence))}>
                        {code.label} <span className="tnum text-ink-2">({code.code})</span>
                      </Hover>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="mt-2.5 flex items-center gap-1 font-medium text-action underline" onClick={() => pick("clinical")}>
                View full medical history
                <ArrowRight size={15} aria-hidden />
              </button>
            </div>
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 font-bold text-navy-800">Current care plan</h3>
              <dl className="mt-1.5 space-y-2 leading-snug">
                <div className="flex items-start gap-2">
                  <Target size={15} aria-hidden className="mt-0.5 shrink-0 text-action" />
                  <div className="min-w-0"><dt className="inline font-semibold">Goal: </dt><dd className="inline">{openGoal ? String(openGoal.text.value) : <NotInSource />}</dd></div>
                </div>
                <div className="flex items-start gap-2">
                  <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
                  <div className="min-w-0"><dt className="inline font-semibold">Barriers: </dt><dd className="inline">{barriers.length > 0 ? barriers.map((b) => String(b.text.value)).join("; ") : member.sdoh.length > 0 ? member.sdoh.slice(0, 3).map((s) => s.domain).join("; ") : <NotInSource />}</dd></div>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-action" />
                  <div className="min-w-0"><dt className="inline font-semibold">Next task: </dt><dd className="tnum inline">{nextTask ? `${String(nextTask.text.value)}${nextTask.dueAt ? ` by ${fmt(nextTask.dueAt)}` : ""}` : <NotInSource />}</dd></div>
                </div>
              </dl>
              <button type="button" className="mt-2.5 flex items-center gap-1 font-medium text-action underline" onClick={() => pick("care")}>
                View care plan &amp; services
                <ArrowRight size={15} aria-hidden />
              </button>
              <Link href={engageHref} className="btn btn-primary mt-3 no-underline" onClick={logOutreach}>
                {reach.preferredAction === "sms" ? <MessageSquare size={15} aria-hidden /> : <Phone size={15} aria-hidden />}
                {reach.preferredAction === "sms" ? "Start outreach" : "Start call"}
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* Member data tabs */}
      <div role="tablist" aria-label="Member data" className="tabs">
        {HUB_TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="tab" onClick={() => pick(item.id)}>
              <Icon size={17} aria-hidden strokeWidth={1.9} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-3 @6xl:grid-cols-[minmax(0,1.9fr)_minmax(19rem,1fr)]">
        <div className="min-w-0 space-y-3">
          {tab === "journey" && <Journey events={member.journey} asOf={asOf} clocks={member.clocks} />}

          {tab === "meds" && (
            <section aria-label="Medications" className="panel p-4">
              <SectionHead
                icon={<Pill size={15} aria-hidden className="text-action" />}
                title="Multi-source medication reconciliation"
                aside={
                  conflictRows.length > 0 ? (
                    <span className={`chip tnum ${severeConflict ? "chip-crimson-solid" : "chip-amber"}`}>
                      <AlertTriangle size={13} aria-hidden />
                      {pluralise(conflictRows.length, "conflict")} requiring review
                    </span>
                  ) : null
                }
              />
              <MedConflictList rows={member.medications.rows} />
              <div className="mt-3">
                <MedicationTable view={member.medications} />
              </div>
            </section>
          )}

          {tab === "clinical" && (
      <div className="grid gap-3 @5xl:grid-cols-2 @7xl:grid-cols-3">
        <section aria-label="Conditions and labs" className="panel min-w-0 p-3.5">
          <SectionHead icon={<Stethoscope size={15} aria-hidden className="text-action" />} title="Conditions and clinical labs" aside={<span className="tnum ml-auto text-cap text-ink-3">{pluralise(member.conditions.coded.length, "code")}</span>} />
          <ul className="divide-y divide-line text-foot">
            {member.conditions.coded.map((code) => (
              <li key={code.code} className="py-1.5 first:pt-0">
                <Hover focusable={false} className="block" content={evidenceTip("Sources", code.lastSeen, code.mentions.flatMap((m) => m.evidence))}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">{code.label ?? <NotInSource />}</span>
                    <span className="src-tag tnum">{code.code}</span>
                  </span>
                  <span className="muted tnum block">
                    First seen {fmt(code.firstSeen)} · last seen {fmt(code.lastSeen)}
                  </span>
                </Hover>
              </li>
            ))}
            {member.conditions.coded.length === 0 && <li><NotInSource /></li>}
          </ul>
          {member.conditions.documented.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-foot font-semibold">Documented problems, by document</h3>
              <ul className="space-y-1.5 text-foot">
                {member.conditions.documented.map((doc, index) => (
                  <li key={index}>
                    <Sourced v={doc.source} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {member.conditions.egfr && (
            <div className="mt-3 text-foot">
              <h3 className="mb-0.5 font-semibold">eGFR trend</h3>
              <p className="tnum">
                {member.conditions.egfr.points.map((p) => `${p.value}${p.derived ? " (derived)" : ""}`).join(" → ")}
                {member.conditions.egfr.slopePerYear !== null ? `. Fitted slope ${member.conditions.egfr.slopePerYear} per year.` : ""}
              </p>
              {member.conditions.egfr.computedFromCreatinine && (
                <p className="tnum muted mt-0.5">
                  Derived value uses CKD-EPI 2021 on an outside creatinine: {member.conditions.egfr.computedFromCreatinine.value}.
                  {member.conditions.egfr.computedFromCreatinine.statedInWorkbook ? ` The workbook's note says about ${member.conditions.egfr.computedFromCreatinine.statedInWorkbook}.` : ""}
                </p>
              )}
            </div>
          )}
          <h3 className="mt-3 mb-1 text-foot font-semibold">Labs</h3>
          <ul className="divide-y divide-line text-foot">
            {member.conditions.labs.map((lab, index) => (
              <li key={index} className="py-1.5 first:pt-0">
                <Sourced v={lab.test} />
                <p className="tnum mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                  <Sourced v={lab.value} mode="tight" valueClassName="font-semibold" />
                  <span className="text-ink-2">{lab.unit}</span>
                  <span className="text-ink-2">· Flag: {lab.flag ?? "Not in source data"}</span>
                  <span className="text-ink-2">· Prior: {lab.prior ?? "Not in source data"}</span>
                </p>
                {lab.refRange && <span className="muted tnum block">Range {lab.refRange}</span>}
              </li>
            ))}
            {member.conditions.labs.length === 0 && <li><NotInSource /></li>}
          </ul>
        </section>

        <section aria-label="Risk" className="panel min-w-0 p-3.5">
          <SectionHead icon={<ShieldAlert size={15} aria-hidden className="text-action" />} title="Risk models" aside={<span className="tnum ml-auto text-cap text-ink-3">{pluralise(member.risk.length, "model")}</span>} />
          <ul className="divide-y divide-line text-foot">
            {member.risk.map((model, index) => (
              <li key={index} className="py-2.5 first:pt-0 last:pb-0">
                <Sourced v={model.model} valueClassName="font-semibold" />
                <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="text-ink-3">Score</span>
                    <Sourced v={model.score} mode="tight" valueClassName="font-semibold" />
                  </span>
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="text-ink-3">Tier</span>
                    <Sourced v={model.tier} mode="tight" />
                  </span>
                  {model.prior && <span className="tnum text-ink-2">Prior {model.prior}</span>}
                </p>
                <p className="muted tnum mt-0.5">
                  Model date {fmt(model.tier.date) || "not in source data"}. Data as of {fmt(model.dataAsOf) || "not in source data"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {model.reasons.map((reason) => {
                    const refutable = model.refutableReasons.includes(reason);
                    return (
                      <span key={reason} className={`chip ${refutable ? "chip-amber" : "chip-quiet"}`}>
                        {refutable && <ShieldAlert size={12} aria-hidden />}
                        {reason}
                        {refutable ? ": unverified" : ""}
                      </span>
                    );
                  })}
                </div>
                {model.note && <p className="mt-1 text-ink-2">{model.note}</p>}
              </li>
            ))}
            {member.risk.length === 0 && <li className="text-ink-2">No risk model on record</li>}
          </ul>
        </section>

        <section aria-label="SDOH and assessments" className="panel min-w-0 p-3.5 @5xl:col-span-2 @7xl:col-span-1">
          <SectionHead icon={<Users size={15} aria-hidden className="text-action" />} title="SDOH and assessments" aside={<span className="tnum ml-auto text-cap text-ink-3">{pluralise(member.sdoh.length, "statement")}</span>} />
          <ul className="divide-y divide-line text-foot">
            {member.sdoh.map((item, index) => (
              <li key={index} className="py-2 first:pt-0">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">{item.domain}</span>
                  <span className="muted tnum">
                    {item.captureDate ? fmt(item.captureDate) : "Not in source data"}
                    {item.ageDays !== null ? ` · ${item.ageDays} d` : ""}
                    {item.thresholdDays !== null ? ` (limit ${item.thresholdDays})` : ""}
                  </span>
                </p>
                <div className="mt-0.5">
                  <Sourced v={item.text} />
                </div>
                {item.selfReported && !item.text.flags?.some((f) => f.tag === "self-reported") && (
                  <span className="mt-1 block">
                    <ExceptionChip flag={{ tag: "self-reported" }} />
                  </span>
                )}
              </li>
            ))}
            {member.sdoh.length === 0 && <li><NotInSource /></li>}
          </ul>
          <h3 className="mt-3 mb-1 text-foot font-semibold">Assessments on record</h3>
          <ul className="divide-y divide-line text-foot">
            {member.assessments.map((assessment, index) => (
              <li key={index} className="py-2 first:pt-0">
                <Sourced v={assessment.name} />
                {assessment.keyResponses && <p className="mt-0.5 text-ink-2">{assessment.keyResponses}</p>}
                <p className="tnum mt-0.5 text-ink-2">
                  Respondent: {assessment.respondent ?? "Not in source data"} · Complete: {assessment.completionPct !== null ? `${assessment.completionPct}%` : "Not in source data"} · Score: {assessment.score ?? "Not in source data"}
                </p>
              </li>
            ))}
            {member.assessments.length === 0 && <li><NotInSource /></li>}
          </ul>
        </section>
      </div>
          )}

          {tab === "care" && (
            <section id="care-plan" aria-label="Care plan and services" className="panel min-w-0 overflow-x-auto p-4">
              <SectionHead icon={<ClipboardList size={15} aria-hidden className="text-action" />} title="Active care plan and service coordination" />
        <div className="space-y-6">
          <Expand open={call.tasks.length > 0 || confirmedBarriers.length > 0}>
            <div className="rounded bg-action-tint p-4">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-foot font-semibold">
                <ClipboardList size={15} aria-hidden />
                Proposed from the workspace
                <ExceptionChip flag={{ tag: "ai-derived" }} />
              </h3>
              <ul className="space-y-1.5 text-foot">
                {confirmedBarriers.map((fact) => (
                  <li key={fact.id}>
                    <span className="font-medium">Barrier confirmed: </span>
                    {call.facts[fact.id]?.edit ?? fact.value}
                  </li>
                ))}
                {call.tasks.map((task) => (
                  <li key={task.factId} className="tnum">
                    <span className="chip chip-navy mr-1.5">Proposed from workspace</span>
                    <span className="font-semibold">{task.task}</span>
                    <span className="text-ink-2">. Owner: {task.owner}. Due: {fmt(task.dueAt)}.</span>
                  </li>
                ))}
              </ul>
            </div>
          </Expand>
          <div>
            <h3 className="mb-1.5 text-foot font-semibold">Cases</h3>
            <ul className="space-y-2 text-foot">
              {member.carePlan.cases.map((c) => (
                <li key={c.id} className="tnum">
                  <span className="font-semibold">{c.program}</span>
                  <span className="text-ink-2">
                    {" "}
                    · {c.id} · {c.status} · {c.assignedCm ?? "Not in source data"} · opened {fmt(c.openAt) || "not in source data"}
                    {c.closeAt ? `, closed ${fmt(c.closeAt)}` : ""}
                  </span>
                  {c.closeReason && (
                    <span className="ml-1.5 inline-flex flex-wrap items-center gap-1">
                      <span>Close reason: {c.closeReason}</span>
                      {c.closeReasonFlag && <span className="chip chip-amber">{c.closeReasonFlag}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-foot font-semibold">Goals and barriers</h3>
            {goalsAndBarriers.length === 0 ? (
              <NotInSource />
            ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {goalsAndBarriers.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Sourced v={task.text} />
                      {task.note && <p className="mt-0.5 text-ink-2">{task.note}</p>}
                    </td>
                    <td className="whitespace-nowrap">{task.itemType}</td>
                    <td>{task.overdue ? <span className="chip chip-crimson tnum"><AlarmClock size={13} aria-hidden />Overdue{task.status ? ` · ${task.status}` : ""}</span> : task.status ?? <NotInSource />}</td>
                    <td className="tnum whitespace-nowrap">{task.dueAt ? fmt(task.dueAt) : <NotInSource />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-foot font-semibold">Tasks and referrals</h3>
            {tasksOnly.length === 0 ? (
              <NotInSource />
            ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasksOnly.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Sourced v={task.text} />
                      {task.note && <p className="mt-0.5 text-ink-2">{task.note}</p>}
                    </td>
                    <td className="whitespace-nowrap">{task.itemType}</td>
                    <td>{task.overdue ? <span className="chip chip-crimson tnum"><AlarmClock size={13} aria-hidden />Overdue{task.status ? ` · ${task.status}` : ""}</span> : task.status ?? <NotInSource />}</td>
                    <td className="tnum whitespace-nowrap">{task.dueAt ? fmt(task.dueAt) : <NotInSource />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-foot font-semibold">Authorisations</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Valid</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {member.carePlan.auths.map((auth, index) => (
                  <tr key={index}>
                    <td className="tnum whitespace-nowrap"><Sourced v={auth.id} mode="tight" /></td>
                    <td>
                      {auth.service}
                      {auth.note && <p className="mt-0.5 text-ink-2">{auth.note}</p>}
                    </td>
                    <td>
                      <Sourced v={auth.status} />
                      {auth.reason && <p className="mt-0.5 text-ink-2">{auth.reason}</p>}
                      {(auth.daysInQueue ?? 0) > 0 && <p className="tnum mt-0.5 font-medium">{auth.daysInQueue} d in queue</p>}
                    </td>
                    <td className="tnum whitespace-nowrap">{auth.validFrom ? `${fmt(auth.validFrom)} to ${auth.validTo ? fmt(auth.validTo) : "not in source data"}` : <NotInSource />}</td>
                    <td>{auth.owner ?? <NotInSource />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-1 text-foot font-semibold">Appointments</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Where</th>
                  <th>Status</th>
                  <th className="text-right!">Miles</th>
                </tr>
              </thead>
              <tbody>
                {member.carePlan.appointments.map((appt) => (
                  <tr key={appt.id}>
                    <td className="tnum whitespace-nowrap">{appt.at ? fmt(appt.at) : <NotInSource />}</td>
                    <td>{appt.type}</td>
                    <td>
                      <Sourced v={appt.label} mode="tight" />
                      {appt.note && <p className="mt-0.5 text-ink-2">{appt.note}</p>}
                    </td>
                    <td><AppointmentStatus status={appt.status} /></td>
                    <td className="tnum text-right">{appt.distanceMiles ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-x-10 gap-y-6 @5xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-1 text-foot font-semibold">Quality measures</h3>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {member.carePlan.gaps.map((gap, index) => (
                    <tr key={index}>
                      <td>
                        <Sourced v={gap.code} mode="tight" valueClassName="font-medium" />
                        <p className="text-ink-2">{gap.name}</p>
                        {gap.flag && <p className="muted mt-0.5">{gap.flag}</p>}
                      </td>
                      <td>{gap.status ?? <NotInSource />}</td>
                      <td className="tnum whitespace-nowrap">{gap.dueAt ? fmt(gap.dueAt) : <NotInSource />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              <h3 className="mb-1 text-foot font-semibold">Benefits and vendors</h3>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {member.carePlan.vendors.map((vendor, index) => (
                    <tr key={index}>
                      <td>
                        <Sourced v={vendor.service} mode="tight" valueClassName="font-medium" />
                        <p className="text-ink-2">{vendor.vendor}</p>
                      </td>
                      <td>
                        {vendor.status ?? <NotInSource />}
                        {vendor.detail && <p className="mt-0.5 text-ink-2">{vendor.detail}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="mb-1 flex items-center gap-1.5 text-foot font-semibold">
              <Users size={15} aria-hidden />
              Care team
            </h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Name</th>
                  <th>Network</th>
                  <th>Last contact</th>
                </tr>
              </thead>
              <tbody>
                {member.carePlan.careTeam.map((person, index) => (
                  <tr key={index}>
                    <td>{person.role}</td>
                    <td>
                      <Sourced v={person.name} mode="tight" valueClassName="font-medium" />
                      {person.organisation && <p className="text-ink-2">{person.organisation}</p>}
                      {person.flag && <p className="muted mt-0.5">{person.flag}</p>}
                    </td>
                    <td>{person.network ?? <NotInSource />}</td>
                    <td className="tnum">{person.lastContact ? fmt(person.lastContact) : <NotInSource />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
            </section>
          )}

          {tab === "activity" && (
            <>
              <section aria-label="Clocks" className="panel min-w-0 p-4">
                <SectionHead icon={<AlarmClock size={15} aria-hidden className="text-action" />} title="All clocks" />
                <ul className="grid gap-2 @3xl:grid-cols-2">
                  {member.clocks.map((clock) => (
                    <li key={clock.id} className="min-w-0"><ClockChip clock={clock} /></li>
                  ))}
                  {member.clocks.length === 0 && <li className="text-foot text-ink-2">No running clock</li>}
                </ul>
              </section>
              <section aria-label="Open alerts" className="panel min-w-0 p-4">
                <SectionHead
                  icon={<AlertTriangle size={15} aria-hidden className="text-action" />}
                  title="Open alerts and cross-source signals"
                  aside={
                    member.signals.length > signalsShown.length || allSignals ? (
                      <button type="button" className="ml-auto text-cap whitespace-nowrap text-action hover:underline" onClick={() => setAllSignals((v) => !v)}>
                        {allSignals ? "Show fewer" : `Show all ${member.signals.length}`}
                      </button>
                    ) : null
                  }
                />
                {signalsShown.length === 0 ? (
                  <p className="text-foot text-ink-2">No open alerts.</p>
                ) : (
                  <ul className="grid gap-2 @3xl:grid-cols-2">
                    {signalsShown.map((signal) => (
                      <li key={`${signal.code}-${signal.title}`} className="sub-card min-w-0 p-2.5! text-foot">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SeverityBadge severity={signal.severity} />
                          <span className="tnum leading-snug font-semibold">{signal.title}</span>
                        </div>
                        <Hover focusable={false} className="mt-1 block" content={evidenceTip("Cross-source signal", null, signal.evidence)}>
                          <span className="tnum text-cap leading-snug text-ink-2">{signal.detail}</span>
                        </Hover>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label="Data quality flags" className="panel min-w-0 overflow-x-auto p-4">
                <SectionHead icon={<ShieldAlert size={15} aria-hidden className="text-action" />} title={`Data quality flags (${flags.length})`} />
        <table className="tbl">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Finding</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {sortedFlags.map((flag) => (
              <tr key={flag.id}>
                <td>
                  <SeverityBadge severity={flag.severity} />
                </td>
                <td>
                  <p className="tnum font-medium">{flag.title}</p>
                  <p className="tnum text-ink-2">{flag.detail}</p>
                </td>
                <td className="tnum whitespace-nowrap text-ink-3">
                  {flag.evidence.slice(0, 3).map((e) => (
                    <p key={`${e.sheet}-${e.row}-${e.column ?? ""}`}>
                      {e.sheet}, row {e.row}
                    </p>
                  ))}
                  {flag.evidence.length > 3 && <p>and {flag.evidence.length - 3} more rows</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="mt-3 text-foot text-action hover:opacity-70" onClick={() => setShowSourceFlags((v) => !v)}>
          {showSourceFlags ? "Hide" : "Show"} {pluralise(sourceFlags.length, "flag")} the workbook declares itself
        </button>
        <Expand open={showSourceFlags}>
          <ul className="mt-2 space-y-1.5 text-foot">
            {sourceFlags.map((flag) => (
              <li key={flag.id} className="tnum">
                {flag.detail}{" "}
                <span className="muted">
                  {flag.evidence[0]?.sheet}, row {flag.evidence[0]?.row}
                </span>
              </li>
            ))}
          </ul>
        </Expand>
              </section>
            </>
          )}
        </div>

        {/* Recent activity */}
        <aside aria-label="Recent activity and data updates" className="panel min-w-0 p-4 @6xl:sticky @6xl:top-3">
          <div className="flex flex-wrap items-start gap-2">
            <History size={20} aria-hidden strokeWidth={1.8} className="mt-0.5 text-action" />
            <div className="min-w-0 flex-1">
              <h2 className="sect">Recent Activity &amp; Data Updates</h2>
              <Hover focusable={false} className="muted tnum block" content={evidenceTip("Baseline", member.changes.baselineAt, member.changes.baselineEvidence)}>
                Since {member.changes.baselineLabel}
              </Hover>
            </div>
            <label className="sr-only" htmlFor="activity-filter">Activity filter</label>
            <select id="activity-filter" className="select h-[2.1rem]!" value={activityFilter} onChange={(e) => setActivityFilter(e.target.value as typeof activityFilter)}>
              <option value="all">All activity</option>
              <option value="important">High or severe</option>
              <option value="session">This session</option>
            </select>
          </div>
          <ol className="mt-3 max-h-[34rem] overflow-y-auto">
            {activityFilter !== "important" && attempts.map((attempt) => (
              <ActivityRow key={`attempt-${attempt.id}`} icon={attempt.kind === "call" ? Phone : MessageSquare} title={`${attempt.kind === "call" ? "Call" : "SMS"} attempt logged`} detail={`${attempt.target || "No number"}${attempt.owner ? ` (${shortPerson(attempt.owner)})` : ""}. Session only: nothing was placed.`} at={attempt.at} />
            ))}
            {activityFilter !== "important" && call.tasks.map((task) => (
              <ActivityRow key={`task-${task.factId}`} icon={ClipboardList} title={`Task proposed: ${task.task}`} detail={`Owner: ${task.owner}. From the Care Engagement Hub, session only.`} at={task.dueAt} atLabel="Due" />
            ))}
            {activityFilter !== "session" && activity.map((item) => (
              <ChangeRow key={item.id} item={item} />
            ))}
            {((activityFilter === "session" && attempts.length + call.tasks.length === 0) || (activityFilter !== "session" && activity.length === 0 && (activityFilter === "important" || attempts.length + call.tasks.length === 0))) && (
              <li className="py-3 text-foot text-ink-2">Nothing to show for this filter.</li>
            )}
          </ol>
        </aside>
      </div>
    </div>
  );
}
