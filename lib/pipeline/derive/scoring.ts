import { CLINICAL, COMMITMENTS, DRIVER_LABELS, GUARDRAILS, NEW_SIGNAL, type Weights } from "../../config/scoring";
import { dateOnly, formatDuration, hasTime } from "../dates";
import type { ChangeItem, Clock, Commitment, DriverResult, Priority, Reachability, Signal, StdRow } from "../types";
import { clockPressure } from "./clocks";
import { ev, s } from "../standardise";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ScoreInput {
  id: string;
  clocks: Clock[];
  riskRows: StdRow[];
  signals: Signal[];
  changes: ChangeItem[];
  commitments: Commitment[];
  reach: Reachability;
}

function deadlineDriver(clocks: Clock[]): Omit<DriverResult, "key" | "label" | "weight" | "points"> {
  let top: Clock | null = null;
  let value = 0;
  for (const clock of clocks) {
    const pressure = clockPressure(clock);
    if (pressure > value) {
      value = pressure;
      top = clock;
    }
  }
  return {
    fraction: round2(value),
    reason: top ? `${top.label}: ${top.display}` : "No running clock",
    evidence: top?.evidence ?? [],
  };
}

function clinicalDriver(riskRows: StdRow[], signals: Signal[]): Omit<DriverResult, "key" | "label" | "weight" | "points"> {
  let base = 0;
  let topRow: StdRow | null = null;
  for (const row of riskRows) {
    const tier = s(row, "Tier");
    const value = CLINICAL.tierValues.find((t) => t.pattern.test(tier))?.value ?? CLINICAL.tierDefault;
    const horizon = CLINICAL.longHorizonPattern.test(s(row, "Model")) ? CLINICAL.longHorizonFactor : 1;
    const score = value * horizon;
    if (score > base) {
      base = score;
      topRow = row;
    }
  }
  const severe = signals.find((sig) => sig.clinical && sig.severity === "severe");
  const high = signals.find((sig) => sig.clinical && sig.severity === "high");
  const uplift = severe ? CLINICAL.upliftSevereSignal : high ? CLINICAL.upliftHighSignal : 0;
  const upliftSignal = severe ?? high;
  const parts = [
    topRow ? `${s(topRow, "Model")}: ${s(topRow, "Tier")}` : "No risk model on record",
    upliftSignal ? `plus ${upliftSignal.title}` : null,
  ].filter(Boolean);
  return {
    fraction: round2(Math.min(1, base + uplift)),
    reason: parts.join(", "),
    evidence: [...(topRow ? [ev(topRow, "Tier")] : []), ...(upliftSignal?.evidence.slice(0, 2) ?? [])],
  };
}

function newSignalDriver(items: ChangeItem[]): Omit<DriverResult, "key" | "label" | "weight" | "points"> {
  let value = 0;
  let top: ChangeItem | null = null;
  for (const item of items) {
    const freshness = NEW_SIGNAL.freshness.find((f) => item.arrivalHoursAgo <= f.maxHours)?.value ?? 0;
    const score = freshness * NEW_SIGNAL.severity[item.severity];
    if (score > value) {
      value = score;
      top = item;
    }
  }
  return {
    fraction: round2(value),
    reason: top
      ? hasTime(top.arrivalAt)
        ? `${top.title}, arrived ${top.arrivalHoursAgo < 1 ? "under 1 h" : formatDuration(top.arrivalHoursAgo)} ago`
        : `${top.title}, dated ${dateOnly(top.arrivalAt)}`
      : "Nothing new in the last 14 days",
    evidence: top?.evidence ?? [],
  };
}

function commitmentsDriver(commitments: Commitment[]): Omit<DriverResult, "key" | "label" | "weight" | "points"> {
  const overdue = commitments.filter((c) => c.overdue).length;
  const open = commitments.length - overdue;
  const points = overdue * COMMITMENTS.overduePoints + open * COMMITMENTS.openPoints;
  return {
    fraction: round2(Math.min(1, points / COMMITMENTS.cap)),
    reason: `${commitments.length} open, ${overdue} overdue`,
    evidence: commitments.flatMap((c) => c.evidence).slice(0, 8),
  };
}

/** Sum of rounded driver points, so a score always equals the points shown beside it. */
export function computeDrivers(input: ScoreInput, weights: Weights): DriverResult[] {
  const parts = {
    deadline: deadlineDriver(input.clocks),
    clinicalRisk: clinicalDriver(input.riskRows, input.signals),
    newSignal: newSignalDriver(input.changes),
    openCommitments: commitmentsDriver(input.commitments),
    contactableNow: {
      fraction: input.reach.contactableNow.fraction,
      reason: input.reach.contactableNow.explanation,
      evidence: input.reach.best?.evidence ?? [],
    },
  };
  return (Object.keys(parts) as (keyof Weights)[]).map((key) => ({
    key,
    label: DRIVER_LABELS[key],
    weight: weights[key],
    fraction: parts[key].fraction,
    points: Math.round(weights[key] * parts[key].fraction),
    reason: parts[key].reason,
    evidence: parts[key].evidence,
  }));
}

export function topTierReasons(clocks: Clock[], signals: Signal[]): string[] {
  const reasons: string[] = [];
  const contact = clocks.find((c) => c.cls === "toc_contact");
  if (contact?.status === "breached") reasons.push("TOC contact clock breached");
  if (contact?.status === "final24") reasons.push("TOC contact clock in its final 24 hours");
  for (const code of GUARDRAILS.safetyTopTierSignals) {
    const signal = signals.find((sig) => sig.code === code);
    if (signal) reasons.push(`Safety: ${signal.title}`);
  }
  return reasons;
}

export interface Scored {
  id: string;
  priority: Priority;
}

/**
 * Ranks by tier, then by score without the Contactable driver. Contactable only breaks exact ties,
 * so a member who is hard to reach can never drop below someone they would otherwise outrank.
 */
export function rankMembers(inputs: { id: string; drivers: DriverResult[]; reasons: string[]; commitments: Commitment[] }[]): Scored[] {
  const scored = inputs.map(({ id, drivers, reasons, commitments }) => {
    const score = drivers.reduce((sum, d) => sum + d.points, 0);
    const contactable = drivers.find((d) => d.key === "contactableNow")?.points ?? 0;
    return {
      id,
      contactable,
      priority: { score, baseScore: score - contactable, rank: 0, topTier: reasons.length > 0, topTierReasons: reasons, drivers, commitments } satisfies Priority,
    };
  });
  scored.sort(
    (a, b) =>
      Number(b.priority.topTier) - Number(a.priority.topTier) ||
      b.priority.baseScore - a.priority.baseScore ||
      b.contactable - a.contactable ||
      a.id.localeCompare(b.id),
  );
  scored.forEach((entry, index) => (entry.priority.rank = index + 1));
  return scored.map(({ id, priority }) => ({ id, priority }));
}
