import { THRESHOLDS } from "@lib/config/scoring";
import { fromMin, toArrivalMin, toMin } from "@lib/pipeline/dates";
import type { MemberRecord, QueueRow } from "@lib/pipeline/types";

export type TriggerType = "hospital_alert" | "risk_flag" | "transition_of_care" | "referral" | "program" | "other";

/**
 * The API gives the trigger as free text with no type, so the chip's type comes from general
 * healthcare vocabulary in that text. Logged in docs/contract-gaps.md. Order matters: a referral or
 * discharge can mention a hospital, so the more specific words are tested first.
 */
export function triggerType(text: string | number | null): TriggerType {
  const value = String(text ?? "");
  if (/referral/i.test(value)) return "referral";
  if (/discharge|transition|\btoc\b/i.test(value)) return "transition_of_care";
  if (/\bED\b|\bADT\b|admi(t|ssion)|hospital|overdose/i.test(value)) return "hospital_alert";
  if (/model|tier|risk|\bflag\b/i.test(value)) return "risk_flag";
  if (/program|enrol/i.test(value)) return "program";
  return "other";
}

export interface TriggerTiming {
  eventAt: string | null;
  receivedAt: string | null;
  source: string;
  /** Set only when the gap reaches the pipeline's feed-latency threshold. */
  lateHours: number | null;
}

const EMPTY: TriggerTiming = { eventAt: null, receivedAt: null, source: "", lateHours: null };

function timing(eventAt: string | null, receivedAt: string | null, source: string): TriggerTiming {
  // A received date with no time counts as the end of that day, matching the pipeline's arrival rule.
  const hours = eventAt && receivedAt && eventAt.includes("T") ? (toArrivalMin(receivedAt) - toMin(eventAt)) / 60 : null;
  return { eventAt, receivedAt, source, lateHours: hours !== null && hours >= THRESHOLDS.feedLatencyHours ? hours : null };
}

/**
 * Event and received times for a row's trigger. Neither is on QueueRow, so they come from the event
 * behind the member's first clock counted from an event, then the model that opened the case, then
 * the newest change. A simulated row's clock carries its own feed delay.
 */
export function triggerTiming(row: Pick<QueueRow, "clocks">, member: MemberRecord | null): TriggerTiming {
  const clock = row.clocks.find((c) => c.countedFrom === "event" && c.startAt);
  if (clock?.startAt) {
    const start = clock.startAt;
    const journey = member?.journey.find((e) => e.eventAt === start && e.arrivalAt);
    if (journey) return timing(start, journey.arrivalAt, journey.source);
    const change = member?.changes.items.find((c) => c.eventAt === start);
    if (change) return timing(start, change.arrivalAt, change.source);
    if (clock.feedDelayHours !== null && clock.feedDelayHours !== undefined) return timing(start, fromMin(toMin(start) + Math.round(clock.feedDelayHours * 60)), clock.label);
  }
  if (!member) return EMPTY;
  const model = member.risk.find((r) => r.triggeredCase);
  if (model) return timing(model.dataAsOf, model.tier.date, model.model.source);
  const newest = member.changes.items[0];
  return newest ? timing(newest.eventAt, newest.arrivalAt, newest.source) : EMPTY;
}
