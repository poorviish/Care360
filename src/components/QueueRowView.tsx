"use client";

import { motion } from "motion/react";
import { AlarmClock, ArrowUpRight, Award, CalendarClock, ChevronDown, Clock3, Languages, List, MessageSquare, MoreHorizontal, NotebookPen, Phone, PhoneOff, ShieldAlert, Sparkles, TriangleAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ContactOption, MemberRecord, QueueRow, Reachability, SimulatedAlert } from "@lib/pipeline/types";
import { nextBusinessMorning } from "@/lib/clock";
import { demo, useDemo } from "@/lib/demoStore";
import { fmt, fmtShort, shortPerson } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { triggerTiming } from "@/lib/trigger";
import { ClockBadge, ClockChip, NotInSource, SeverityBadge } from "./chips";
import { Hover } from "./Hover";
import { Popover, Skeleton } from "./overlays";
import { evidenceTip, Sourced } from "./Sourced";

const REACH: Record<Reachability["band"], { label: string; icon: typeof Phone; tone: string }> = {
  direct: { label: "Reachable", icon: Phone, tone: "text-ok" },
  via_caregiver: { label: "Via caregiver", icon: Phone, tone: "text-ok" },
  channel_restricted: { label: "SMS first", icon: MessageSquare, tone: "text-action" },
  number_bad_alternate: { label: "Number issue", icon: TriangleAlert, tone: "text-navy-900" },
  no_working_contact: { label: "No working contact", icon: PhoneOff, tone: "text-navy-900" },
};

const AVATAR_TONES = ["bg-[#d7f7e8]", "bg-[#e8e2ff]", "bg-[#d9f1ff]", "bg-[#e7e5ff]", "bg-[#d8f6e8]", "bg-[#dfe7ff]"];

export const initialsOf = (name: string | number | null, fallback: string) =>
  String(name ?? fallback)
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export const avatarTone = (id: string) => AVATAR_TONES[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];

export const workspaceHref = (id: string, option: ContactOption | null) => `/member/${encodeURIComponent(id)}/engage${option ? `?to=${encodeURIComponent(option.key)}` : ""}`;
const contactName = (option: ContactOption) => (option.ownerIsMember ? "member" : shortPerson(option.owner.value).split(" ")[0].toLowerCase());
const usableAlternatives = (row: QueueRow) => row.alternatives.filter((o) => o.score > 0);
/** The contact a Call button should reach: never a demoted number while a working alternative exists. */
const callTarget = (row: QueueRow) => (row.callDemoted ? (usableAlternatives(row)[0] ?? row.primaryNumber) : row.bestContact);

function logAttempt(row: QueueRow, kind: "call" | "sms", option: ContactOption | null, now: string) {
  demo.logAttempt({ memberId: row.id, kind, target: option?.value ?? "", owner: option ? String(option.owner.value ?? "") : "", at: now });
}

function scheduleOptions(row: QueueRow, now: string) {
  const options: { label: string; at: string }[] = [];
  if (row.snoozeWindow) {
    const at = `${now.slice(0, 10)}T${row.snoozeWindow}`;
    if (at > now) options.push({ label: `${fmtShort(at)} (best-time window)`, at });
  }
  const morning = nextBusinessMorning(now);
  options.push({ label: fmtShort(morning), at: morning });
  return options;
}

/** The right-hand panel's Member Snapshot tab: what a nurse needs before dialling. */
function SnapshotTab({ row, member, now }: { row: QueueRow; member: MemberRecord | null; now: string }) {
  const primary = row.primaryNumber;
  const alternatives = usableAlternatives(row);
  return (
    <div className="space-y-3.5">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <dt className="text-ink-3">Plan</dt>
        <dd className="min-w-0">{member ? member.coverage[0] ? <Sourced v={member.coverage[0].product} mode="tight" /> : <NotInSource /> : <Skeleton className="h-4 w-40" />}</dd>
        <dt className="text-ink-3">PCP</dt>
        <dd className="min-w-0">{member ? member.attributedPcps[0] ? <Sourced v={member.attributedPcps[0]} mode="tight" /> : <NotInSource /> : <Skeleton className="h-4 w-32" />}</dd>
        <dt className="text-ink-3">Assigned CM</dt>
        <dd className="min-w-0"><Sourced v={row.assignedCm} mode="tight" /></dd>
      </dl>
      <section className="sub-card">
        <h3 className="mb-1.5 font-bold text-navy-800">Contact intelligence</h3>
        {primary ? <p className="tnum text-head font-semibold">{primary.value}</p> : <NotInSource />}
        <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-2">
          <dt className="text-ink-3">Status</dt>
          <dd className="min-w-0">{primary ? <Sourced v={primary.status} /> : <NotInSource />}</dd>
          <dt className="text-ink-3">Owner</dt>
          <dd className="min-w-0">{primary ? <Sourced v={primary.owner} /> : <NotInSource />}</dd>
          <dt className="text-ink-3">Best time</dt>
          <dd className="min-w-0"><Sourced v={row.bestTime} /></dd>
          <dt className="text-ink-3">Language</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Sourced v={row.language} />
            {row.interpreterRequired && (
              <span className="chip chip-tint">
                <Languages size={13} aria-hidden />
                Interpreter needed
              </span>
            )}
          </dd>
          <dt className="text-ink-3">Consent</dt>
          <dd className="min-w-0">{primary ? <Sourced v={primary.consent.text} /> : <NotInSource />}</dd>
          <dt className="text-ink-3">Last verified</dt>
          <dd className="min-w-0">{primary ? <Sourced v={primary.lastVerified} /> : <NotInSource />}</dd>
        </dl>
      </section>
      {alternatives.length > 0 && (
        <section>
          <h3 className="mb-1.5 font-bold text-navy-800">Ranked alternatives</h3>
          <ol className="divide-y divide-line rounded-xl border border-line">
            {alternatives.map((option) => {
              const noRelease = !option.ownerIsMember && (option.consent.state === "none" || option.consent.state === "expired");
              return (
                <li key={option.key} className="flex items-start justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="tnum font-semibold">
                      {option.rank}. {option.value}
                    </p>
                    <p className="text-ink-2">{shortPerson(option.owner.value)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-2">
                      <Sourced v={option.status} mode="tight" />
                      <Sourced v={option.consent.text} mode="tight" />
                    </p>
                    {noRelease && <p className="muted mt-0.5">No release: generic message only</p>}
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => logAttempt(row, "call", option, now)}>
                    <Phone size={14} aria-hidden />
                    Log call
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

/** The score's full arithmetic: the shown score is the sum of these points. */
function WhyTab({ row }: { row: QueueRow }) {
  const base = row.drivers.filter((d) => d.key !== "contactableNow").reduce((sum, d) => sum + d.points, 0);
  const max = row.drivers.reduce((sum, d) => sum + d.weight, 0);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {row.drivers.map((driver) => (
          <li key={driver.key} className="sub-card p-2.5!">
            <p className="tnum flex items-baseline justify-between gap-2">
              <span className="font-semibold">{driver.label}</span>
              <span>
                <strong className="text-head font-bold text-action">+{driver.points}</strong> <span className="text-cap text-ink-3">of {driver.weight}</span>
              </span>
            </p>
            <p className="tnum mt-0.5 text-cap leading-snug text-ink-2">{driver.reason}</p>
          </li>
        ))}
      </ul>
      <p className="tnum rounded-xl bg-navy-100 px-3 py-2 leading-snug">
        <strong className="font-semibold">
          Score {row.score} of {max} is the sum of these points.
        </strong>{" "}
        Rank {row.rank} uses {base}, the score without Contactable now, so reachability cannot lower a rank.
      </p>
      {row.topTierReasons.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert size={15} aria-hidden />
            Guardrail: placed in the top tier
          </p>
          <ul className="mt-0.5 space-y-0.5 leading-snug">
            {row.topTierReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {row.commitments.length > 0 && (
        <div>
          <h4 className="font-semibold">Open commitments</h4>
          <ul className="mt-0.5 space-y-0.5 leading-snug">
            {row.commitments.map((commitment) => (
              <li key={commitment.label} className="flex items-start gap-1.5">
                {commitment.overdue ? <AlarmClock size={14} aria-hidden className="mt-0.5 shrink-0 text-crimson" /> : <span aria-hidden className="mx-[0.2rem] mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-line-2" />}
                <span className={commitment.overdue ? "" : "text-ink-2"}>
                  {commitment.label}
                  {commitment.overdue && <span className="font-semibold text-crimson"> Overdue</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ row, member, now }: { row: QueueRow; member: MemberRecord | null; now: string }) {
  const state = useDemo();
  const attempts = state.attempts.filter((a) => a.memberId === row.id);
  const callback = state.callbacks[row.id];
  const changes = member?.changes.items.slice(0, 5) ?? [];
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 font-bold text-navy-800">Scheduled callback</h3>
        {callback ? (
          <p className="tnum flex flex-wrap items-center gap-2">
            <CalendarClock size={15} aria-hidden />
            {fmtShort(callback)}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => demo.cancelCallback(row.id)}>
              Cancel
            </button>
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {scheduleOptions(row, now).map((option) => (
              <button key={option.at} type="button" className="btn btn-secondary tnum" onClick={() => demo.scheduleCallback(row.id, option.at)}>
                <CalendarClock size={15} aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 font-bold text-navy-800">Contact attempts this session</h3>
        {attempts.length === 0 ? (
          <p className="text-ink-2">None logged yet.</p>
        ) : (
          <ul className="tnum space-y-1">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                {fmt(attempt.at)} · {attempt.kind === "call" ? "Call" : "SMS"} · {attempt.target || "no number"} {attempt.owner && <span className="text-ink-2">({shortPerson(attempt.owner)})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 font-bold text-navy-800">Latest changes</h3>
        {!member ? (
          <Skeleton className="h-16 w-full" />
        ) : changes.length === 0 ? (
          <p className="text-ink-2">Nothing new since {member.changes.baselineLabel}.</p>
        ) : (
          <ul className="space-y-2">
            {changes.map((item) => (
              <li key={item.id}>
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <SeverityBadge severity={item.severity} />
                  {item.title}
                </p>
                <p className="muted tnum mt-0.5">
                  {item.source} · arrived {fmt(item.arrivalAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OverviewTab({ row, member }: { row: QueueRow; member: MemberRecord | null }) {
  const max = row.drivers.reduce((sum, d) => sum + d.weight, 0);
  const timing = triggerTiming(row, member);
  const signals = member ? [...member.signals].sort((a, b) => ["severe", "high", "medium", "low"].indexOf(a.severity) - ["severe", "high", "medium", "low"].indexOf(b.severity)).slice(0, 3) : [];
  const actions = member?.actions.slice(0, 3) ?? [];
  const program = member?.carePlan.cases.find((c) => !c.closeAt)?.program ?? null;
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5">
        <section className="rounded-xl border border-[#ece8ff] bg-[#fbfaff] p-3">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
            <Zap size={16} aria-hidden className="text-action" />
            Why now?
          </h3>
          <p className="mt-1 leading-snug">
            <Sourced v={row.trigger} mode="tight" focusable={false} />
          </p>
          {member?.briefing[0] && <p className="tnum mt-1 line-clamp-4 leading-snug text-ink-2" title={member.briefing[0]}>{member.briefing[0]}</p>}
        </section>
        <section className="rounded-xl border border-[#ece8ff] bg-[#fbfaff] p-3">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
            <Award size={16} aria-hidden className="text-action" />
            Priority
          </h3>
          <p className="mt-1.5">
            <span className="score-pill tnum bg-[#e6e2ff] text-action-strong">
              {row.score}
            </span>
            <span className="tnum ml-1.5 text-ink-3">of {max}</span>
          </p>
          <p className="mt-1.5 leading-snug">
            Tier: {row.topTier ? "Top tier" : "Standard"}
            {program && <span className="block text-ink-2">{program}</span>}
          </p>
        </section>
      </div>

      <section>
        <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
          <List size={16} aria-hidden className="text-action" />
          Key Signals (cross-source)
        </h3>
        {!member ? (
          <Skeleton className="mt-1.5 h-14 w-full" />
        ) : signals.length === 0 ? (
          <p className="mt-1 text-ink-2">No open alerts.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {signals.map((signal) => (
              <li key={`${signal.code}-${signal.title}`} className="flex items-start gap-2 leading-snug">
                <span className="mt-0.5 shrink-0">
                  <SeverityBadge severity={signal.severity} />
                </span>
                <Hover focusable={false} className="min-w-0" content={<>{signal.detail}{evidenceTip("Cross-source signal", null, signal.evidence)}</>}>
                  <span className="tnum">{signal.title}</span>
                </Hover>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sub-card grid gap-3">
        <section>
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
            <Clock3 size={16} aria-hidden className="text-action" />
            Compliance &amp; Timelines
          </h3>
          <ul className="mt-2 space-y-2">
            {row.clocks.slice(0, 3).map((clock) => (
              <li key={clock.id}>
                <ClockBadge clock={clock} />
              </li>
            ))}
            {row.clocks.length === 0 && <li className="text-ink-2">No running clock</li>}
          </ul>
          <p className="tnum muted mt-2">
            Event {timing.eventAt ? fmtShort(timing.eventAt) : "not in source data"} · received {timing.receivedAt ? fmtShort(timing.receivedAt) : "not in source data"}
            {timing.lateHours !== null && <span className="chip chip-amber ml-1.5">{Math.round(timing.lateHours)} h late</span>}
          </p>
        </section>
        <section className="border-t border-line pt-3">
          <h3 className="flex items-center gap-1.5 font-bold text-navy-800">
            <Sparkles size={16} aria-hidden className="text-action" />
            Next Best Actions
          </h3>
          {!member ? (
            <Skeleton className="mt-1.5 h-14 w-full" />
          ) : actions.length === 0 ? (
            <div className="mt-1"><NotInSource /></div>
          ) : (
            <ol className="mt-2 space-y-2">
              {actions.map((action, index) => (
                <li key={action.id} className="flex items-start gap-2 leading-snug">
                  <span className="tnum flex size-[1.45rem] shrink-0 items-center justify-center rounded-full bg-[#e6e2ff] text-cap font-bold text-action-strong">{index + 1}</span>
                  <Hover focusable={false} className="min-w-0" content={<>{action.reason}{evidenceTip("Suggested action", null, action.evidence)}</>}>
                    <span className="tnum">{action.title}</span>
                    {index === 0 && <span className="chip chip-ok ml-1.5">Recommended</span>}
                  </Hover>
                </li>
              ))}
            </ol>
          )}
          {row.callDemoted && row.demotionReason && (
            <p className="tnum mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber bg-amber-tint p-2 leading-snug">
              <PhoneOff size={15} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                <strong className="font-semibold">Call demoted. </strong>
                {row.demotionReason}
              </span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SnoozeMenu({ row, now }: { row: QueueRow; now: string }) {
  const safety = row.topTierReasons.some((reason) => reason.startsWith("Safety"));
  if (safety) {
    return (
      <Hover focusable={false} className="inline-flex" content={<p>A safety signal cannot be snoozed: {row.topTierReasons.find((reason) => reason.startsWith("Safety"))?.replace("Safety: ", "")}.</p>}>
        <button type="button" className="btn btn-secondary" disabled>
          <AlarmClock size={15} aria-hidden />
          Snooze
        </button>
      </Hover>
    );
  }
  return (
    <Popover
      widthRem={21}
      align="right"
      triggerClassName="btn btn-secondary"
      label={
        <>
          <AlarmClock size={15} aria-hidden />
          Snooze
          <ChevronDown size={14} aria-hidden />
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <p className="mb-1 font-semibold">Return this row at</p>
          {scheduleOptions(row, now).map((option) => (
            <button
              type="button"
              key={option.at}
              className="tnum rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-navy-100"
              onClick={() => {
                demo.snooze(row.id, option.at);
                close();
              }}
            >
              {option.label}
            </button>
          ))}
          <p className="muted mt-1">The clocks keep running while it is snoozed.</p>
        </div>
      )}
    </Popover>
  );
}

type DetailTab = "overview" | "why" | "snapshot" | "history";
const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "why", label: "Why This Priority" },
  { id: "snapshot", label: "Snapshot" },
  { id: "history", label: "History" },
];

/** The focus panel beside the queue. Selecting a row fills it. */
export function CaseDetail({ row, member, now }: { row: QueueRow; member: MemberRecord | null; now: string }) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const state = useDemo();
  const target = callTarget(row);
  const attemptCount = state.attempts.filter((a) => a.memberId === row.id).length;
  const conditions = (member?.conditions.coded ?? []).filter((code) => code.label).slice(0, 2);
  const program = member?.carePlan.cases.find((c) => !c.closeAt)?.program ?? null;
  const demotedNoAlternative = row.callDemoted && usableAlternatives(row).length === 0;

  return (
    <div className="flex max-h-[inherit] flex-col text-foot">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`avatar size-12! text-head ${avatarTone(row.id)}`}>{initialsOf(row.name.value, row.id)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-title font-bold text-navy-800">
              <Sourced v={row.name} mode="tight" focusable={false} />
            </p>
            <p className="tnum text-ink-2">
              {row.id} · Age {row.age.value ?? "not in source data"} · {row.sex.value ?? "Sex not in source data"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {conditions.map((code) => (
                <span key={code.code} title={code.label ?? undefined} className="chip chip-tint block max-w-[14rem] truncate leading-[1.3rem]">{code.label}</span>
              ))}
              {program && <span className="chip chip-quiet">{program}</span>}
            </div>
          </div>
          <Link href={`/member/${encodeURIComponent(row.id)}`} aria-label="Open Member Insight Hub" title="Open Member Insight Hub" className="btn btn-ghost btn-sm text-action">
            <ArrowUpRight size={18} aria-hidden />
          </Link>
        </div>

        <div role="tablist" aria-label="Member focus" className="tabs mt-3 mb-3.5">
          {DETAIL_TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="tab px-1.5!" onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab row={row} member={member} />}
        {tab === "why" && <WhyTab row={row} />}
        {tab === "snapshot" && <SnapshotTab row={row} member={member} now={now} />}
        {tab === "history" && <HistoryTab row={row} member={member} now={now} />}
      </div>

      <div className="border-t border-line bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link className={`btn no-underline ${demotedNoAlternative ? "btn-warning" : "btn-primary"} min-w-[8.5rem] flex-1`} href={workspaceHref(row.id, target)} onClick={() => logAttempt(row, "call", target, now)}>
            {demotedNoAlternative ? <PhoneOff size={15} aria-hidden /> : <Phone size={15} aria-hidden />}
            {target ? `Call ${contactName(target)}` : "Call member"}
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => logAttempt(row, "call", target, now)}>
            <NotebookPen size={15} aria-hidden />
            Log Attempt
          </button>
          <SnoozeMenu row={row} now={now} />
          <Popover widthRem={20} align="right" triggerClassName="btn btn-secondary px-2!" label={<><span className="sr-only">More actions</span><MoreHorizontal size={17} aria-hidden /></>}>
            {(close) => (
              <div className="flex flex-col gap-0.5">
                <Hover focusable={false} className="block" content={<p>{row.smsReason}</p>}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-navy-100 disabled:opacity-50"
                    disabled={!row.smsAvailable}
                    onClick={() => {
                      logAttempt(row, "sms", row.bestContact, now);
                      close();
                    }}
                  >
                    <MessageSquare size={15} aria-hidden />
                    Log an SMS
                  </button>
                </Hover>
                {scheduleOptions(row, now).map((option) => (
                  <button
                    type="button"
                    key={option.at}
                    className="tnum flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-navy-100"
                    onClick={() => {
                      demo.scheduleCallback(row.id, option.at);
                      close();
                    }}
                  >
                    <CalendarClock size={15} aria-hidden className="shrink-0" />
                    Callback {option.label}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        </div>
        <p className="muted mt-1.5">
          No call or message is placed. {attemptCount > 0 ? `${attemptCount} attempt${attemptCount === 1 ? "" : "s"} logged this session, shown under History.` : "Each button logs an attempt for this session."}
        </p>
      </div>
    </div>
  );
}

/** One row of the priority table. A click selects it; the name opens the Member Insight Hub. */
export function QueueRowView({ row, member, alert, now, selected, onSelect }: { row: QueueRow; member: MemberRecord | null; alert: SimulatedAlert | null; now: string; selected: boolean; onSelect: () => void }) {
  const isNew = alert !== null;
  const reach = REACH[row.reachabilityBand];
  const ReachIcon = reach.icon;
  const topDriver = [...row.drivers].sort((a, b) => b.points - a.points)[0];
  const timing = triggerTiming(row, member);
  const condition = member?.conditions.coded.find((code) => code.label)?.label ?? null;
  const callback = useDemo().callbacks[row.id];
  const target = callTarget(row);
  const demotedNoAlternative = row.callDemoted && usableAlternatives(row).length === 0;
  const smsFirst = row.preferredAction === "sms";

  return (
    <motion.tr
      layout="position"
      layoutId={row.id}
      transition={{ layout: SPRING }}
      aria-selected={selected}
      onClick={(event) => {
        const element = event.target as HTMLElement;
        if (!event.currentTarget.contains(element) || element.closest("a,button,input,label,[data-no-row]")) return;
        onSelect();
      }}
      className={`queue-row ${isNew ? "bg-amber-tint" : ""}`}
    >
      <td>
        <span className={`tnum flex size-[1.65rem] items-center justify-center rounded-full font-bold ${row.topTier ? "bg-[#e6e2ff] text-action-strong" : "bg-navy-100 text-navy-800"}`}>{row.rank}</span>
        {isNew && <span className="chip chip-amber mt-1">NEW</span>}
      </td>
      <td>
        <div className="flex min-w-[9.5rem] items-center gap-2">
          <span aria-hidden className={`avatar ${avatarTone(row.id)}`}>{initialsOf(row.name.value, row.id)}</span>
          <div className="min-w-0">
            <Link href={`/member/${encodeURIComponent(row.id)}`} className="font-semibold text-navy-900 no-underline hover:underline">
              <Sourced v={row.name} mode="tight" focusable={false} />
              <span className="tnum font-normal text-ink-2"> ({row.age.value ?? "age not in source data"})</span>
            </Link>
            <div className="mt-0.5">{condition ? <span title={condition} className="chip chip-tint block max-w-[8rem] truncate leading-[1.3rem]">{condition}</span> : <span className="muted tnum">{row.id}</span>}</div>
          </div>
        </div>
      </td>
      <td className="min-w-[9rem]">
        <p className="leading-snug font-semibold">
          <Sourced v={row.trigger} mode="tight" focusable={false} />
        </p>
        <Hover focusable={false} className="block" content={<p>{topDriver?.reason}</p>}>
          <span className="muted tnum mt-0.5 line-clamp-2 leading-snug">{row.topTierReasons[0] ?? topDriver?.reason}</span>
        </Hover>
        {timing.lateHours !== null && <span className="chip chip-amber tnum mt-1">{Math.round(timing.lateHours)} h late</span>}
      </td>
      <td>
        <span className={`score-pill tnum ${row.topTier ? "bg-[#e6e2ff] text-action-strong" : "bg-navy-100 text-navy-800"}`}>{row.score}</span>
      </td>
      <td className="min-w-[8.5rem]">
        {row.clocks[0] ? <ClockBadge clock={row.clocks[0]} /> : <span className="text-ink-2">No running clock</span>}
      </td>
      <td>
        <Hover focusable={false} className="block" content={<p>{row.reachabilityLabel}. {row.demotionReason ?? ""}</p>}>
          <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
            <ReachIcon size={15} aria-hidden className={`shrink-0 ${reach.tone}`} />
            {reach.label}
          </span>
        </Hover>
      </td>
      <td className="min-w-[5rem] text-ink-2">
        <Sourced v={{ ...row.freshness, value: String(row.freshness.value ?? "").replace(/^Newest data\s*/i, "").replace(/\d{4}-\d{2}-\d{2}/, (date) => fmt(date)) || null }} mode="tight" focusable={false} />
      </td>
      <td>
        <div className="flex flex-col items-start gap-1">
          {smsFirst ? (
            <Hover focusable={false} className="inline-flex" content={<p>{row.action?.title ?? row.smsReason}</p>}>
              <button type="button" className="btn btn-soft btn-sm" disabled={!row.smsAvailable} onClick={() => logAttempt(row, "sms", row.bestContact, now)}>
                <MessageSquare size={14} aria-hidden />
                Log SMS
              </button>
            </Hover>
          ) : (
            <Hover focusable={false} className="inline-flex" content={<p>{row.action?.title ?? "Not in source data"}</p>}>
              <Link className={`btn btn-sm no-underline ${demotedNoAlternative ? "btn-warning" : "btn-soft"}`} href={workspaceHref(row.id, target)} onClick={() => logAttempt(row, "call", target, now)}>
                {demotedNoAlternative ? <PhoneOff size={14} aria-hidden /> : <Phone size={14} aria-hidden />}
                {target ? `Call ${contactName(target)}` : "Call member"}
              </Link>
            </Hover>
          )}
          {callback && <span className="muted tnum whitespace-nowrap">Callback {fmtShort(callback)}</span>}
        </div>
      </td>
    </motion.tr>
  );
}

export { ClockChip };
