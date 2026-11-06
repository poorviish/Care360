"use client";

import { AlarmClock, AlertOctagon, AlertTriangle, ArrowRightLeft, Bot, Check, CircleHelp, CircleSlash, Clock3, Forward, GitCompareArrows, Hourglass, Info, Layers, MessageSquareQuote, Siren, Tag, TrendingUp, type LucideIcon } from "lucide-react";
import type { Clock, ExceptionFlag, ExceptionTag, Severity } from "@lib/pipeline/types";
import { liveClock, useElapsedMinutes } from "@/lib/clock";
import { fmt } from "@/lib/format";
import { triggerType, type TriggerType } from "@/lib/trigger";
import { useAsOf } from "@/lib/useApi";
import { Hover } from "./Hover";

/** Every exception has its own icon and label. Colour never carries the meaning alone. */
const EXCEPTION: Record<ExceptionTag, { label: string; icon: LucideIcon; meaning: string }> = {
  stale: { label: "Stale", icon: Hourglass, meaning: "Older than the limit for this kind of data" },
  conflicting: { label: "Conflict", icon: GitCompareArrows, meaning: "Sources disagree, and nothing has been merged" },
  "self-reported": { label: "Self-reported", icon: MessageSquareQuote, meaning: "Said by the member or a proxy, not documented" },
  "ai-derived": { label: "AI-derived", icon: Bot, meaning: "Extracted by a model, and needs a person to confirm it" },
  unverified: { label: "Unverified", icon: CircleHelp, meaning: "Stated in a source, but nothing corroborates it" },
};

/** Amber fill with navy text, or crimson for a severe conflict. Always an icon and a label. */
export function ExceptionChip({ flag }: { flag: ExceptionFlag }) {
  const { label, icon: Icon } = EXCEPTION[flag.tag];
  return (
    <span className={`chip ${flag.severe ? "chip-crimson-solid" : "chip-amber"}`}>
      <Icon size={13} aria-hidden strokeWidth={2.2} />
      {label}
    </span>
  );
}

/** Uniform wording for an absent value. This is the sixth flag type: missing. */
export function NotInSource({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-ink-3 ${className}`}>
      <CircleSlash size={13} aria-hidden strokeWidth={2.2} className="shrink-0" />
      Not in source data
    </span>
  );
}

/** A key to the flags, so each type's icon and label can be checked in one place. */
export function FlagLegend() {
  const tags = Object.keys(EXCEPTION) as ExceptionTag[];
  return (
    <ul aria-label="Flag key" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-cap text-ink-2">
      {tags.map((tag) => (
        <li key={tag} title={EXCEPTION[tag].meaning}>
          <ExceptionChip flag={{ tag }} />
        </li>
      ))}
      <li className="flex items-center gap-1.5" title="The workbook has no value for this field">
        <span className="font-medium text-navy-900">Missing:</span>
        <NotInSource />
      </li>
    </ul>
  );
}

const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; className: string }> = {
  severe: { label: "Severe", icon: AlertOctagon, className: "chip-crimson-solid" },
  high: { label: "High", icon: AlertTriangle, className: "chip-outline" },
  medium: { label: "Medium", icon: Info, className: "chip-tint" },
  low: { label: "Low", icon: Info, className: "chip-quiet" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, icon: Icon, className } = SEVERITY[severity];
  return (
    <span className={`chip ${className}`}>
      <Icon size={13} aria-hidden strokeWidth={2.2} />
      {label}
    </span>
  );
}

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  hospital_alert: "Hospital alert",
  risk_flag: "Risk flag",
  transition_of_care: "Transition of care",
  referral: "Referral",
  program: "Program",
  other: "Other trigger",
};

const TRIGGER: Record<TriggerType, { label: string; icon: LucideIcon }> = {
  hospital_alert: { label: "Hospital alert", icon: Siren },
  risk_flag: { label: "Risk flag", icon: TrendingUp },
  transition_of_care: { label: "Transition of care", icon: ArrowRightLeft },
  referral: { label: "Referral", icon: Forward },
  program: { label: "Program", icon: Layers },
  other: { label: "Trigger", icon: Tag },
};

export function TriggerChip({ text }: { text: string | number | null }) {
  const { label, icon: Icon } = TRIGGER[triggerType(text)];
  return (
    <span className="chip chip-navy">
      <Icon size={13} aria-hidden strokeWidth={2.2} />
      {label}
    </span>
  );
}

/** A live countdown. Crimson only when breached or under 24 hours, always with an icon and words. */
export function ClockChip({ clock, compact = false }: { clock: Clock; compact?: boolean }) {
  const asOf = useAsOf();
  const elapsed = useElapsedMinutes();
  const live = liveClock(clock, asOf, elapsed);
  const met = clock.status === "met";
  const Icon = live.urgent ? AlarmClock : met ? Check : Clock3;
  const state = live.breached ? "Breached" : live.urgent ? "Under 24 hours" : met ? "Met" : live.counting ? "Running" : "For information";
  return (
    <Hover
      focusable={!compact}
      className="flex max-w-full min-w-0 flex-col"
      content={
        <>
          <p className="font-semibold">{clock.label}</p>
          <p className="mt-1">{clock.detail}</p>
          <p className="tnum mt-1">Status: {state}</p>
          <p className="tnum">Clock basis: {live.basis}</p>
          {clock.startAt && <p className="tnum">Started: {fmt(clock.startAt)}</p>}
          {clock.dueAt && <p className="tnum">Due: {fmt(clock.dueAt)}</p>}
          {clock.arrivalDueAt && clock.arrivalDueAt !== clock.dueAt && <p className="tnum">A receipt-based clock would show: {fmt(clock.arrivalDueAt)}</p>}
          <p className="mt-1 text-ink-3">{clock.evidence.slice(0, 3).map((e) => `${e.sheet}, row ${e.row}`).join("; ")}</p>
        </>
      }
    >
      <span className={`tnum flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 text-foot ${live.urgent ? "font-medium" : ""}`}>
        <Icon size={15} aria-hidden strokeWidth={2.2} className={`shrink-0 ${live.urgent ? "text-crimson" : "text-ink-3"}`} />
        <span className={`shrink-0 text-head font-semibold ${live.urgent ? "text-crimson" : "text-navy-900"}`}>{live.text}</span>
        <span className="min-w-0">{clock.label}</span>
      </span>
      <span className="muted tnum pl-[1.3rem]">Basis: {live.basis}</span>
    </Hover>
  );
}

/** The queue's compact clock: a pill with the time left, and the clock's name beneath it. */
export function ClockBadge({ clock, showLabel = true }: { clock: Clock; showLabel?: boolean }) {
  const asOf = useAsOf();
  const elapsed = useElapsedMinutes();
  const live = liveClock(clock, asOf, elapsed);
  const met = clock.status === "met";
  const soon = live.counting && !live.urgent && clock.hoursLeft !== null && clock.hoursLeft * 60 - elapsed < 72 * 60;
  const Icon = live.urgent ? AlarmClock : met ? Check : Clock3;
  const tone = live.urgent ? "chip-crimson" : met ? "chip-ok" : soon ? "chip-amber" : "chip-tint";
  return (
    <Hover
      focusable={false}
      className="flex max-w-full min-w-0 flex-col items-start gap-0.5"
      content={
        <>
          <p className="font-semibold">{clock.label}</p>
          <p className="mt-1">{clock.detail}</p>
          <p className="tnum mt-1">Clock basis: {live.basis}</p>
          {clock.startAt && <p className="tnum">Started: {fmt(clock.startAt)}</p>}
          {clock.dueAt && <p className="tnum">Due: {fmt(clock.dueAt)}</p>}
          {clock.arrivalDueAt && clock.arrivalDueAt !== clock.dueAt && <p className="tnum">A receipt-based clock would show: {fmt(clock.arrivalDueAt)}</p>}
          <p className="mt-1 text-ink-3">{clock.evidence.slice(0, 3).map((e) => `${e.sheet}, row ${e.row}`).join("; ")}</p>
        </>
      }
    >
      <span className={`chip tnum whitespace-nowrap ${tone}`}>
        <Icon size={13} aria-hidden strokeWidth={2.2} />
        {live.text}
      </span>
      {showLabel && <span className="muted line-clamp-2 leading-snug">{clock.label}</span>}
    </Hover>
  );
}
