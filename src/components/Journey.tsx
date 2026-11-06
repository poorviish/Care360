"use client";

import { Activity, CalendarCheck, CalendarDays, ClipboardCheck, ExternalLink, FileText, FlaskConical, Home, Hourglass, LogIn, Phone, Pill, Plus, SearchX, Stethoscope, Check, CircleAlert, Timer, CalendarClock, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, dateOnly, formatDuration, toMin } from "@lib/pipeline/dates";
import type { Clock, JourneyEvent, JourneyLane } from "@lib/pipeline/types";
import { fmt, fmtShort } from "@/lib/format";
import { evidenceTip } from "./Sourced";
import { Hover } from "./Hover";

type EventKind = "ed" | "admission" | "discharge" | "acute" | "claim" | "pharmacy" | "appointment" | "auth" | "lab" | "contact";

/** Every kind has its own icon and label, so the colour never carries the meaning alone. */
const KIND: Record<EventKind, { label: string; icon: LucideIcon; color: string }> = {
  ed: { label: "ED visit", icon: Plus, color: "#be185d" },
  admission: { label: "Admission", icon: LogIn, color: "#8a4de8" },
  discharge: { label: "Discharge", icon: Home, color: "#3b5bdb" },
  acute: { label: "Other acute", icon: Stethoscope, color: "#6741d9" },
  claim: { label: "Claim", icon: FileText, color: "#69728d" },
  pharmacy: { label: "Pharmacy fill", icon: Pill, color: "#168a45" },
  appointment: { label: "Appointment", icon: CalendarCheck, color: "#0e8f9c" },
  auth: { label: "Authorisation", icon: ClipboardCheck, color: "#2b6cb0" },
  lab: { label: "Lab or document", icon: FlaskConical, color: "#7c5e10" },
  contact: { label: "Contact", icon: Phone, color: "#475569" },
};

const LANE_KIND: Record<Exclude<JourneyLane, "Acute">, EventKind> = {
  Claims: "claim",
  Pharmacy: "pharmacy",
  Appointments: "appointment",
  Authorisations: "auth",
  "Labs and documents": "lab",
  Contact: "contact",
};

function kindOf(event: JourneyEvent): EventKind {
  if (event.lane !== "Acute") return LANE_KIND[event.lane];
  if (/discharge/i.test(event.label)) return "discharge";
  if (/\bED\b|emergency/i.test(event.label)) return "ed";
  if (/admi|inpatient|stay|observation/i.test(event.label)) return "admission";
  return "acute";
}

const STATUS: Record<JourneyEvent["status"], { label: string; icon: LucideIcon; className: string }> = {
  ok: { label: "Recorded", icon: Check, className: "chip-ok" },
  inferred: { label: "Inferred", icon: Timer, className: "chip-quiet" },
  future: { label: "Upcoming", icon: CalendarClock, className: "chip-tint" },
  pending: { label: "Pending claim", icon: Hourglass, className: "chip-amber" },
  expected: { label: "Expected, not received", icon: SearchX, className: "chip-amber" },
  gap: { label: "No alert, or not routed", icon: CircleAlert, className: "chip-amber" },
};

const RANGES = [
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "Last 180 days", value: 180 },
  { label: "Last year", value: 365 },
  { label: "All time", value: 0 },
];
const FUTURE_DAYS = 30;

function eventTip(event: JourneyEvent) {
  return (
    <>
      <p className="font-semibold">{event.label}</p>
      <p className="mt-1">{event.detail}</p>
      <p className="tnum mt-1">
        Event: {fmt(event.eventAt)}
        {event.endAt ? ` to ${fmt(event.endAt)}` : ""}
      </p>
      <p className="tnum">Arrival: {event.arrivalAt ? fmt(event.arrivalAt) : "Not in source data"}</p>
      {event.latencyHours !== null && <p className="tnum">Delay: {formatDuration(event.latencyHours)}</p>}
      <div className="mt-1">{evidenceTip(event.source, null, event.evidence)}</div>
    </>
  );
}

function StatusChip({ status }: { status: JourneyEvent["status"] }) {
  const look = STATUS[status];
  const Icon = look.icon;
  return (
    <span className={`chip ${look.className}`}>
      <Icon size={13} aria-hidden />
      {look.label}
    </span>
  );
}

/** A horizontal timeline, oldest to newest, with one event opened beneath it. */
export function Journey({ events, asOf, clocks }: { events: JourneyEvent[]; asOf: string; clocks: Clock[] }) {
  const [kind, setKind] = useState<"all" | EventKind>("all");
  const [days, setDays] = useState(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const strip = useRef<HTMLOListElement>(null);

  const kinds = useMemo(() => (Object.keys(KIND) as EventKind[]).filter((k) => events.some((e) => kindOf(e) === k)), [events]);
  const shown = useMemo(() => {
    const start = days === 0 ? -Infinity : toMin(addDays(dateOnly(asOf), -days));
    const end = toMin(addDays(dateOnly(asOf), FUTURE_DAYS));
    return events
      .filter((e) => toMin(e.eventAt) >= start && toMin(e.eventAt) <= end && (kind === "all" || kindOf(e) === kind))
      .sort((a, b) => toMin(a.eventAt) - toMin(b.eventAt));
  }, [events, asOf, days, kind]);

  // By default, the newest event that has already happened.
  const fallback = useMemo(() => [...shown].reverse().find((e) => toMin(e.eventAt) <= toMin(asOf)) ?? shown[shown.length - 1] ?? null, [shown, asOf]);
  const selected = shown.find((e) => e.id === selectedId) ?? fallback;

  useEffect(() => {
    const box = strip.current;
    const target = fallback && box?.querySelector<HTMLElement>(`[data-event="${CSS.escape(fallback.id)}"]`);
    if (box && target) box.scrollLeft = target.offsetLeft - box.clientWidth / 2;
  }, [fallback]);

  const windowClock = clocks.find((c) => c.cls === "toc_window") ?? clocks.find((c) => c.cls === "toc_visit" || c.cls === "toc_contact");

  return (
    <section aria-label="Member Journey Timeline" className="panel min-w-0 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 items-center justify-center text-action">
          <CalendarDays size={22} aria-hidden strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="sect">Member Journey Timeline</h2>
          <p className="text-foot text-ink-2">Key medical and care events across sources</p>
        </div>
        <label className="sr-only" htmlFor="journey-kind">Event type</label>
        <select id="journey-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">All events</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{KIND[k].label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="journey-range">Time range</label>
        <select id="journey-range" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((range) => (
            <option key={range.value} value={range.value}>{range.label}</option>
          ))}
        </select>
      </div>

      <ul aria-label="Event key" className="mt-2.5 flex flex-wrap justify-end gap-x-4 gap-y-1 text-cap text-ink-2">
        {kinds.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: KIND[k].color }} />
            {KIND[k].label}
          </li>
        ))}
      </ul>

      {windowClock?.dueAt && (
        <p className="tnum mt-3 flex items-center justify-center gap-2 rounded-lg bg-action-tint px-3 py-1.5 text-center text-cap font-medium text-navy-800">
          <Activity size={14} aria-hidden className="shrink-0 text-action" />
          {windowClock.label} (until {fmt(windowClock.dueAt)})
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-foot text-ink-2">No events in this range. Choose a longer range or another event type.</p>
      ) : (
        <ol ref={strip} tabIndex={0} aria-label="Events, oldest to newest" className="relative mt-3 flex overflow-x-auto pt-1 pb-2">
          {shown.map((event, index) => {
            const look = KIND[kindOf(event)];
            const Icon = look.icon;
            const active = selected?.id === event.id;
            const future = toMin(event.eventAt) > toMin(asOf);
            return (
              <li key={event.id} data-event={event.id} className="relative w-[8.25rem] shrink-0">
                {index > 0 && <span aria-hidden className={`absolute top-[0.95rem] left-0 w-1/2 border-t-2 ${future ? "border-dashed border-line-2" : "border-line-2"}`} />}
                {index < shown.length - 1 && <span aria-hidden className={`absolute top-[0.95rem] right-0 w-1/2 border-t-2 ${toMin(shown[index + 1].eventAt) > toMin(asOf) ? "border-dashed border-line-2" : "border-line-2"}`} />}
                <Hover focusable={false} className="block" content={eventTip(event)}>
                  <button type="button" aria-pressed={active} className={`relative flex w-full flex-col items-center rounded-xl px-1.5 pb-1.5 text-center transition-colors duration-100 ${active ? "" : "hover:bg-surface-2"}`} onClick={() => setSelectedId(event.id)}>
                    <span className="relative z-10 flex size-8 items-center justify-center rounded-full text-white ring-3 ring-white" style={{ background: look.color }}>
                      <Icon size={16} aria-hidden strokeWidth={2.2} />
                    </span>
                    <span className={`mt-1.5 w-full rounded-lg border px-1 py-1 ${active ? "border-[#bdb4ff] bg-action-tint" : "border-transparent"}`}>
                      <span className="tnum block text-foot font-bold text-navy-800">{fmtShort(event.eventAt.slice(0, 10)).replace(/^\w+ /, "")}</span>
                      <span className="line-clamp-2 text-cap leading-snug font-semibold text-navy-900">{event.label}</span>
                      <span className="tnum muted mt-0.5 block leading-snug">{event.arrivalAt ? `Arrived: ${fmtShort(event.arrivalAt.slice(0, 10)).replace(/^\w+ /, "")}` : future ? "Scheduled" : STATUS[event.status].label}</span>
                    </span>
                  </button>
                </Hover>
              </li>
            );
          })}
        </ol>
      )}

      {selected && (
        <div className="sub-card mt-2 grid gap-x-5 gap-y-2.5 text-foot sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
          <div className="min-w-0">
            <p className="font-bold text-navy-800">{selected.label}</p>
            <p className="tnum text-ink-2">
              {fmt(selected.eventAt)}
              {selected.endAt ? ` to ${fmt(selected.endAt)}` : ""}
            </p>
            {selected.latencyHours !== null && <p className="tnum muted">Arrived {formatDuration(selected.latencyHours)} after the event</p>}
          </div>
          <div className="min-w-0 xl:border-l xl:border-line xl:pl-4">
            <p className="font-semibold text-navy-800">Source</p>
            <Hover focusable={false} className="flex items-center gap-1 text-ink-2" content={evidenceTip(selected.source, null, selected.evidence)}>
              {selected.source}
              <ExternalLink size={13} aria-hidden className="shrink-0" />
            </Hover>
          </div>
          <div className="min-w-0 xl:border-l xl:border-line xl:pl-4">
            <p className="mb-0.5 font-semibold text-navy-800">Validation</p>
            <StatusChip status={selected.status} />
          </div>
          <div className="min-w-0 xl:border-l xl:border-line xl:pl-4">
            <p className="font-semibold text-navy-800">Details</p>
            <p className="tnum leading-snug text-ink-2">{selected.detail}</p>
          </div>
        </div>
      )}
    </section>
  );
}
