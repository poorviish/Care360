"use client";

import { useSyncExternalStore } from "react";
import type { Dataset, RunReport } from "@lib/pipeline/types";
import { resetClock } from "./clock";

/**
 * Client state for the demo. It lives in memory only and nothing persists: a page reload or
 * "Reset demo" returns everything here to the start.
 */

export interface FactState {
  confirmed: boolean;
  edit: string | null;
}

export interface AcceptedTask {
  factId: string;
  task: string;
  owner: string;
  dueAt: string;
  barrier: string;
}

export type LedgerAction = "Confirmed" | "Confirmation removed" | "Edited" | "Task accepted";

export interface LedgerEntry {
  id: number;
  factId: string;
  action: LedgerAction;
  original: string;
  edit: string | null;
  final: string;
  at: string;
}

export interface CallState {
  consent: boolean;
  dismissedChips: string[];
  checkedGuide: string[];
  linePos: number;
  started: boolean;
  notes: string;
  fieldDrafts: Record<string, string>;
  facts: Record<string, FactState>;
  tasks: AcceptedTask[];
  ledger: LedgerEntry[];
  proposals: Record<string, { owner?: string; dueAt?: string }>;
}

export interface Upload {
  dataset: Dataset;
  report: RunReport;
  fileName: string;
}

export interface Attempt {
  id: number;
  memberId: string;
  kind: "call" | "sms";
  target: string;
  owner: string;
  at: string;
}

export interface DemoState {
  upload: Upload | null;
  /** Member ID to return time. */
  snoozed: Record<string, string>;
  /** Member ID to callback time. */
  callbacks: Record<string, string>;
  attempts: Attempt[];
  sim: "idle" | "pending" | "applied";
  /** Moment of the last manual refresh. Null means the API's asOf. */
  lastRefreshedAt: string | null;
  calls: Record<string, CallState>;
}

const INITIAL: DemoState = { upload: null, snoozed: {}, callbacks: {}, attempts: [], sim: "idle", lastRefreshedAt: null, calls: {} };
export const EMPTY_CALL: CallState = { consent: false, dismissedChips: [], checkedGuide: [], linePos: 0, started: false, notes: "", fieldDrafts: {}, facts: {}, tasks: [], ledger: [], proposals: {} };

let state: DemoState = INITIAL;
let sequence = 0;
const listeners = new Set<() => void>();

function update(next: DemoState) {
  state = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useDemo(): DemoState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

function patchCall(memberId: string, patch: (call: CallState) => CallState) {
  update({ ...state, calls: { ...state.calls, [memberId]: patch(state.calls[memberId] ?? EMPTY_CALL) } });
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const without = <T,>(record: Record<string, T>, key: string) => {
  const rest = { ...record };
  delete rest[key];
  return rest;
};

export const demo = {
  reset() {
    resetClock();
    update(INITIAL);
  },
  setUpload(upload: Upload) {
    update({ ...INITIAL, upload });
  },
  snooze(memberId: string, at: string) {
    update({ ...state, snoozed: { ...state.snoozed, [memberId]: at } });
  },
  unsnooze(memberId: string) {
    update({ ...state, snoozed: without(state.snoozed, memberId) });
  },
  scheduleCallback(memberId: string, at: string) {
    update({ ...state, callbacks: { ...state.callbacks, [memberId]: at } });
  },
  cancelCallback(memberId: string) {
    update({ ...state, callbacks: without(state.callbacks, memberId) });
  },
  logAttempt(attempt: Omit<Attempt, "id">) {
    update({ ...state, attempts: [{ ...attempt, id: ++sequence }, ...state.attempts] });
  },
  setSim(sim: DemoState["sim"]) {
    update({ ...state, sim });
  },
  /** Only a nurse's refresh moves the queue: a pending alert is applied here and nowhere else. */
  refreshed(at: string) {
    update({ ...state, lastRefreshedAt: at, sim: state.sim === "pending" ? "applied" : state.sim });
  },
  setConsent(memberId: string, consent: boolean) {
    patchCall(memberId, (c) => ({ ...c, consent, started: consent ? c.started : false }));
  },
  setStarted(memberId: string, started: boolean) {
    patchCall(memberId, (c) => ({ ...c, started }));
  },
  dismissChip(memberId: string, id: string) {
    patchCall(memberId, (c) => ({ ...c, dismissedChips: [...c.dismissedChips, id] }));
  },
  restoreChips(memberId: string) {
    patchCall(memberId, (c) => ({ ...c, dismissedChips: [] }));
  },
  toggleGuide(memberId: string, id: string) {
    patchCall(memberId, (c) => ({ ...c, checkedGuide: toggle(c.checkedGuide, id) }));
  },
  setLinePos(memberId: string, linePos: number) {
    patchCall(memberId, (c) => ({ ...c, linePos }));
  },
  advanceLine(memberId: string) {
    patchCall(memberId, (c) => ({ ...c, linePos: c.linePos + 1 }));
  },
  setNotes(memberId: string, notes: string) {
    patchCall(memberId, (c) => ({ ...c, notes }));
  },
  setFieldDraft(memberId: string, fieldId: string, value: string) {
    patchCall(memberId, (c) => ({ ...c, fieldDrafts: { ...c.fieldDrafts, [fieldId]: value } }));
  },
  /** Sets a fact's review state and writes one ledger row for what changed. */
  reviewFact(memberId: string, factId: string, original: string, patch: Partial<FactState>, action: LedgerAction, at: string) {
    patchCall(memberId, (c) => {
      const merged: FactState = { ...(c.facts[factId] ?? { confirmed: false, edit: null }), ...patch };
      const entry: LedgerEntry = { id: ++sequence, factId, action, original, edit: merged.edit, final: merged.edit ?? original, at };
      return { ...c, facts: { ...c.facts, [factId]: merged }, ledger: [entry, ...c.ledger] };
    });
  },
  setProposal(memberId: string, factId: string, patch: { owner?: string; dueAt?: string }) {
    patchCall(memberId, (c) => ({ ...c, proposals: { ...c.proposals, [factId]: { ...c.proposals[factId], ...patch } } }));
  },
  acceptTask(memberId: string, task: AcceptedTask, original: string, at: string) {
    patchCall(memberId, (c) => {
      if (c.tasks.some((t) => t.factId === task.factId)) return c;
      const edit = c.facts[task.factId]?.edit ?? null;
      const entry: LedgerEntry = { id: ++sequence, factId: task.factId, action: "Task accepted", original, edit, final: edit ?? original, at };
      return { ...c, tasks: [...c.tasks, task], ledger: [entry, ...c.ledger] };
    });
  },
};
