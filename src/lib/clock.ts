"use client";

import { useSyncExternalStore } from "react";
import { addBusinessDays, fromMin, toMin } from "@lib/pipeline/dates";
import type { Clock } from "@lib/pipeline/types";

/**
 * Minutes of browser time since the app opened. Added to the API's asOf, this is "now". It uses the
 * monotonic timer, so an elapsed time is measured but the real date is never read.
 */
let startedAt: number | null = null;
let elapsed = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function tick() {
  if (startedAt === null) return;
  const next = Math.floor((performance.now() - startedAt) / 60000);
  if (next !== elapsed) {
    elapsed = next;
    listeners.forEach((listener) => listener());
  }
}

function subscribe(listener: () => void) {
  if (startedAt === null) startedAt = performance.now();
  listeners.add(listener);
  if (timer === null) timer = window.setInterval(tick, 5000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export const useElapsedMinutes = () => useSyncExternalStore(subscribe, () => elapsed, () => 0);
export const getElapsedMinutes = () => elapsed;

export function resetClock() {
  startedAt = performance.now();
  elapsed = 0;
  listeners.forEach((listener) => listener());
}

/** asOf advanced by elapsed browser time, as "YYYY-MM-DDTHH:mm". */
export const nowFrom = (asOf: string, elapsedMinutes: number) => fromMin(toMin(asOf) + elapsedMinutes);

/**
 * Clocks that run in real time. A same-hour safety triage does not pause for a weekend, and the
 * source defines the others in calendar days. Everything else counts Monday to Friday only.
 */
const CALENDAR_CLASSES: Clock["cls"][] = ["safety", "toc_visit", "toc_window", "appointment", "admin"];

const isWeekend = (minute: number) => {
  const day = new Date(minute * 60000).getUTCDay();
  return day === 0 || day === 6;
};

/** Minutes between two moments, leaving out Saturdays and Sundays. */
export function businessMinutes(from: number, to: number): number {
  let total = 0;
  let cursor = from;
  while (cursor < to) {
    const nextDay = (Math.floor(cursor / 1440) + 1) * 1440;
    const end = Math.min(nextDay, to);
    if (!isWeekend(cursor)) total += end - cursor;
    cursor = end;
  }
  return total;
}

/** "1d 04h" from one day up, "19h 40m" below it, so a countdown visibly moves in its final day. */
export function formatSpan(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return days > 0 ? `${days}d ${pad(hours)}h` : `${pad(hours)}h ${pad(mins)}m`;
}

export interface LiveClock {
  /** False for met or informational clocks, and when the source gives no hours left. */
  counting: boolean;
  breached: boolean;
  /** Breached or under 24 hours: the only clocks allowed to be crimson. */
  urgent: boolean;
  text: string;
  /** Plain-language clock basis, for example "from event, business days". */
  basis: string;
}

const BASIS: Record<Clock["countedFrom"], string> = { event: "from event", "due date": "workbook due date", "as-of": "from as-of time" };

export function liveClock(clock: Clock, asOf: string | null, elapsedMinutes: number): LiveClock {
  const basisStart = BASIS[clock.countedFrom];
  if (clock.hoursLeft === null || asOf === null || clock.status === "met" || clock.status === "info") {
    return { counting: false, breached: false, urgent: false, text: clock.display, basis: basisStart };
  }
  const remaining = clock.hoursLeft * 60 - elapsedMinutes;
  const breached = remaining <= 0;
  const urgent = remaining < 24 * 60;
  const calendar = CALENDAR_CLASSES.includes(clock.cls);
  const now = toMin(asOf) + elapsedMinutes;
  const due = now + remaining;
  const span = calendar ? Math.abs(remaining) : breached ? businessMinutes(due, now) : businessMinutes(now, due);
  const word = clock.countedFrom === "due date" ? "Overdue" : "Breached";
  const text = breached ? `${word} ${formatSpan(span)}` : `${formatSpan(span)} left`;
  return { counting: true, breached, urgent, text, basis: `${basisStart}, ${calendar ? "calendar days" : "business days"}` };
}

/** The next business day at 08:00, used for snoozes and callbacks. */
export const nextBusinessMorning = (now: string) => `${addBusinessDays(now.slice(0, 10), 1)}T08:00`;
