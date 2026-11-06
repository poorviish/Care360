"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { AlarmClockOff, BellRing, CalendarDays, Check, ChevronRight, Clock3, Info, List, ListChecks, Loader2, PauseCircle, PhoneCall, RefreshCw, Search, Sparkles, TriangleAlert, UserRound, X, type LucideIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toMin } from "@lib/pipeline/dates";
import type { MemberRecord, QueueRow, SimulatedAlert } from "@lib/pipeline/types";
import { liveClock, nowFrom, useElapsedMinutes } from "@/lib/clock";
import { MY_DAY_CAPACITY, ROUTINE_REFRESH_MINUTES } from "@/lib/constants";
import { demo, useDemo } from "@/lib/demoStore";
import { fmtShort, fmtTime, pluralise } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { triggerType, type TriggerType } from "@/lib/trigger";
import { useMembers, useQueue } from "@/lib/useApi";
import { ClockChip, FlagLegend, TRIGGER_LABEL } from "./chips";
import { Hover } from "./Hover";
import { Drawer, EmptyState, ErrorState, LoadingBlocks } from "./overlays";
import { CaseDetail, QueueRowView } from "./QueueRowView";
import { Sourced } from "./Sourced";

const WIDE_QUERY = "(min-width: 1280px)";
const subscribeWide = (listener: () => void) => {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);

type QueueTab = "queue" | "day" | "snoozed" | "external";

/** An authorisation still waiting on someone outside the care team. */
const isPendingAuth = (status: string | number | null) => /pend|in review|await|queue/i.test(String(status ?? ""));
const pendingAuths = (member: MemberRecord | undefined) => member?.carePlan.auths.filter((auth) => isPendingAuth(auth.status.value)).length ?? 0;
const REACHABLE: QueueRow["reachabilityBand"][] = ["direct", "via_caregiver"];

function Kpi({ icon: Icon, value, label, tip }: { icon: LucideIcon; value: number; label: string; tip: string }) {
  return (
    <Hover focusable={false} className="flex min-w-[8.5rem] flex-1 flex-col gap-0.5 px-4 py-1" content={<p>{tip}</p>}>
      <span className="flex items-center gap-2">
        <Icon size={20} aria-hidden strokeWidth={1.8} className="text-action" />
        <strong className="tnum text-title font-bold text-navy-800">{value}</strong>
      </span>
      <span className="text-foot text-ink-2">{label}</span>
    </Hover>
  );
}

function CapacityMeter({ base, callbacks, snoozed }: { base: number; callbacks: number; snoozed: number }) {
  const used = base + callbacks + snoozed;
  const over = used > MY_DAY_CAPACITY;
  return (
    <Hover
      focusable={false}
      className="flex min-w-[13rem] flex-1 items-start gap-2.5 px-4 py-1"
      content={
        <>
          <p className="font-semibold">How capacity adds up</p>
          <p className="tnum mt-1">Open commitments across the queue: {base}</p>
          <p className="tnum">Scheduled callbacks (this session): {callbacks}</p>
          <p className="tnum">Snoozed members (this session): {snoozed}</p>
          <p className="mt-1">Capacity of {MY_DAY_CAPACITY} is an assumption from the brief, not workbook data.</p>
        </>
      }
    >
      <UserRound size={22} aria-hidden strokeWidth={1.8} className="mt-0.5 shrink-0 text-action" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-bold text-navy-800">
          {over && <TriangleAlert size={15} aria-hidden />}
          Capacity
        </span>
        <span className="tnum block text-foot text-ink-2">
          {used} / {MY_DAY_CAPACITY} items ({Math.round((used / MY_DAY_CAPACITY) * 100)}%){over ? `, ${used - MY_DAY_CAPACITY} over` : ""}
        </span>
        <span role="meter" aria-label="Workload against capacity" aria-valuemin={0} aria-valuemax={MY_DAY_CAPACITY} aria-valuenow={Math.min(used, MY_DAY_CAPACITY)} className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-line">
          <motion.span initial={false} animate={{ width: `${Math.min(100, (used / MY_DAY_CAPACITY) * 100)}%` }} transition={SPRING} className={`block h-full rounded-full ${over ? "bg-amber" : "bg-[#168a45]"}`} />
        </span>
        <span className="muted mt-0.5 block">Capacity is an assumption</span>
      </span>
    </Hover>
  );
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} className="tab" onClick={onClick}>
      <Icon size={17} aria-hidden strokeWidth={1.9} />
      {label}
    </button>
  );
}

export function QueueView({ simulatedAlert }: { simulatedAlert: SimulatedAlert | null }) {
  const state = useDemo();
  const { resource, reload } = useQueue();
  const elapsed = useElapsedMinutes();
  const wide = useWide();
  const members = useMembers((resource.data?.queue ?? []).map((row) => row.id));
  const [refreshing, setRefreshing] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [view, setView] = useState<"all" | "reachable" | "issue">("all");
  const [program, setProgram] = useState("all");
  const [tier, setTier] = useState<"all" | "top" | "standard">("all");
  const [source, setSource] = useState<"all" | TriggerType>("all");
  const [tab, setTab] = useState<QueueTab>("queue");
  // undefined: the top row, as in the design.
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (resource.status === "loading") return <LoadingBlocks label="Loading the queue" />;
  if (resource.status === "error" || !resource.data) {
    return <ErrorState title="The queue did not load" message={resource.error?.message ?? "The response could not be read."} onRetry={() => void reload()} />;
  }

  const { asOf, queue: baseQueue } = resource.data;
  const alert = state.upload ? state.upload.dataset.simulatedAlert : simulatedAlert;
  const now = nowFrom(asOf, elapsed);
  const lastRefreshed = state.lastRefreshedAt ?? asOf;
  const sinceRefresh = toMin(now) - toMin(lastRefreshed);
  const nextRefresh = ROUTINE_REFRESH_MINUTES - (sinceRefresh % ROUTINE_REFRESH_MINUTES);

  const applied = state.sim === "applied" && alert ? alert : null;
  const queue: QueueRow[] = applied ? applied.reordered : baseQueue;

  // A snooze ends by itself at its return time. The row then comes back into the list.
  const isSnoozed = (row: QueueRow) => Boolean(state.snoozed[row.id]) && toMin(state.snoozed[row.id]) > toMin(now);
  const active = queue.filter((row) => !isSnoozed(row));
  const snoozed = queue.filter(isSnoozed);
  const commitments = queue.reduce((sum, row) => sum + row.commitments.length, 0);
  const callbackCount = Object.keys(state.callbacks).length;
  const waiting = active.filter((row) => pendingAuths(members.get(row.id)) > 0);
  const waitingAuths = queue.reduce((sum, row) => sum + pendingAuths(members.get(row.id)), 0);
  const isToday = (row: QueueRow) => Boolean(state.callbacks[row.id]) || row.clocks.some((clock) => liveClock(clock, asOf, elapsed).urgent);
  const today = active.filter(isToday);

  const needle = filterText.trim().toLowerCase();
  const sources = [...new Set(queue.map((row) => triggerType(row.trigger.value)))];
  const programOf = (row: QueueRow) => members.get(row.id)?.carePlan.cases.find((c) => !c.closeAt)?.program ?? null;
  const programs = [...new Set(queue.map(programOf).filter((value): value is string => value !== null))];
  const inTab = tab === "day" ? today : tab === "external" ? waiting : active;
  const filtered = inTab.filter((row) => {
    if (tier === "top" && !row.topTier) return false;
    if (tier === "standard" && row.topTier) return false;
    if (source !== "all" && triggerType(row.trigger.value) !== source) return false;
    if (program !== "all" && programOf(row) !== program) return false;
    if (view === "reachable" && !REACHABLE.includes(row.reachabilityBand)) return false;
    if (view === "issue" && REACHABLE.includes(row.reachabilityBand)) return false;
    return needle === "" || [row.name.value, row.id, row.trigger.value, row.assignedCm.value].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });

  const selectedRow = queue.find((row) => row.id === (selectedId ?? active[0]?.id)) ?? null;
  const focusRow = active[0] ?? null;

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
    demo.refreshed(now);
  };

  const select = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const detail = selectedRow && <CaseDetail key={selectedRow.id} row={selectedRow} member={members.get(selectedRow.id) ?? null} now={now} />;

  return (
    <div className="w-full px-5 pt-3.5 pb-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-foot font-medium text-navy-800">
        Cases <ChevronRight size={14} aria-hidden /> Care Priority Hub
      </nav>
      <div className="mt-1 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-large font-bold text-navy-800">
            Care Priority Hub
            <Hover focusable={false} content={<p>The score is the sum of the shown driver points. Open &quot;Why This Priority&quot; for the arithmetic. A recommendation, never an automatic clinical decision.</p>}>
              <Info size={17} aria-hidden className="text-ink-3" />
            </Hover>
          </h1>
          <p className="mt-0.5 text-foot text-ink-2">Prioritized work queue with explainable ranking and next best actions</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Hover focusable={false} content={<p>The routine interval of {ROUTINE_REFRESH_MINUTES} minutes is an assumption, not workbook data. Next routine refresh in {nextRefresh} min. Nothing re-orders until you refresh.</p>}>
            <span className="chip chip-ok tnum h-[2.2rem] rounded-[10px]! px-3!">
              <Check size={15} aria-hidden />
              Last refresh: {fmtTime(lastRefreshed)}
            </span>
          </Hover>
          <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
            Refresh now
          </button>
          <button type="button" className="btn btn-secondary" disabled={!alert || state.sim !== "idle"} onClick={() => demo.setSim("pending")}>
            <BellRing size={15} aria-hidden />
            Simulate urgent alert (demo only)
          </button>
        </div>
      </div>

      {/* Passive: it sits in the page's flow. The queue moves only when the nurse refreshes. */}
      <AnimatePresence initial={false}>
        {state.sim === "pending" && alert && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={SPRING} className="overflow-hidden">
            <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber bg-amber-tint p-2.5 pl-3.5 text-foot">
              <BellRing size={17} aria-hidden className="shrink-0" />
              <p className="min-w-0">
                <strong className="font-semibold">New urgent discharge: refresh queue.</strong>{" "}
                <span className="tnum text-ink-2">
                  Demo replay of {alert.alertId} for {alert.memberName}: {alert.eventType}, {alert.facility}. The order has not changed.
                </span>
              </p>
              <div className="ml-auto flex shrink-0 gap-1.5">
                <button type="button" className="btn btn-primary" disabled={refreshing} onClick={() => void refresh()}>
                  <RefreshCw size={15} aria-hidden />
                  Refresh queue
                </button>
                <button type="button" className="btn btn-ghost" aria-label="Dismiss alert" onClick={() => demo.setSim("idle")}>
                  <X size={15} aria-hidden />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI strip */}
      <section aria-label="My Day" className="panel mt-3 flex flex-wrap items-center gap-y-3 divide-line p-3 sm:divide-x">
        <div className="flex min-w-[9rem] items-center gap-2.5 pr-4">
          <CalendarDays size={26} aria-hidden strokeWidth={1.7} className="text-action" />
          <div>
            <p className="text-head font-bold text-navy-800">My Day</p>
            <p className="tnum text-foot text-ink-2">{fmtShort(asOf.slice(0, 10))}</p>
          </div>
        </div>
        <Kpi icon={PhoneCall} value={callbackCount} label="Scheduled callbacks" tip="Callbacks scheduled in this session. Client state only." />
        <Kpi icon={ListChecks} value={commitments} label="Open commitments" tip="Open commitments on the API's queue rows." />
        <Kpi icon={PauseCircle} value={snoozed.length} label="Snoozed" tip="Members snoozed in this session. Their clocks keep running." />
        <Kpi icon={Clock3} value={waitingAuths} label="Waiting on external" tip="Authorisations still pending, counted from each member's care plan. The API has no general waiting status." />
        <CapacityMeter base={commitments} callbacks={callbackCount} snoozed={snoozed.length} />
        {focusRow?.action && (
          <div className="flex min-w-[17rem] flex-[1.6] items-start gap-2.5 rounded-xl bg-action-tint p-2.5 sm:ml-3 sm:border-l-0!">
            <Sparkles size={19} aria-hidden className="mt-0.5 shrink-0 text-action" />
            <div className="min-w-0">
              <p className="font-bold text-navy-800">Suggested focus</p>
              <p className="tnum line-clamp-2 text-foot leading-snug text-ink-2" title={focusRow.action.title}>
                {focusRow.action.title}
              </p>
            </div>
          </div>
        )}
      </section>

      <div className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="panel overflow-hidden px-3 pt-1.5 pb-2">
            <div role="tablist" aria-label="Queue views" className="tabs">
              <TabButton active={tab === "queue"} icon={List} label={`Priority Queue (${active.length})`} onClick={() => setTab("queue")} />
              <TabButton active={tab === "day"} icon={CalendarDays} label={`My Day (${today.length})`} onClick={() => setTab("day")} />
              <TabButton active={tab === "snoozed"} icon={PauseCircle} label={`Snoozed (${snoozed.length})`} onClick={() => setTab("snoozed")} />
              <TabButton active={tab === "external"} icon={Clock3} label={`Waiting on External (${waiting.length})`} onClick={() => setTab("external")} />
            </div>

            {tab === "snoozed" ? (
              snoozed.length === 0 ? (
                <EmptyState title="Nothing is snoozed" message="A snoozed member appears here until its return time. Its clocks keep running." />
              ) : (
                <ul className="mt-1">
                  {snoozed.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-1 py-2.5 text-foot last:border-0">
                      <AlarmClockOff size={16} aria-hidden className="text-ink-3" />
                      <Sourced v={row.name} mode="tight" focusable={false} valueClassName="font-semibold" />
                      <span className="tnum text-ink-2">Returns {fmtShort(state.snoozed[row.id])}</span>
                      {row.clocks[0] && <ClockChip clock={row.clocks[0]} compact />}
                      <button type="button" className="btn btn-secondary ml-auto" onClick={() => demo.unsnooze(row.id)}>
                        Unsnooze
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 py-2.5">
                  <label className="sr-only" htmlFor="filter-view">View</label>
                  <select id="filter-view" className="select" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
                    <option value="all">View: All active cases</option>
                    <option value="reachable">View: Reachable</option>
                    <option value="issue">View: Contact issue</option>
                  </select>
                  <label className="sr-only" htmlFor="filter-program">Program</label>
                  <select id="filter-program" className="select" value={program} onChange={(e) => setProgram(e.target.value)}>
                    <option value="all">Program: All</option>
                    {programs.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="filter-source">Trigger</label>
                  <select id="filter-source" className="select" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                    <option value="all">Trigger: All</option>
                    {sources.map((value) => (
                      <option key={value} value={value}>{TRIGGER_LABEL[value]}</option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="filter-tier">Priority</label>
                  <select id="filter-tier" className="select" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
                    <option value="all">Priority: All</option>
                    <option value="top">Top tier</option>
                    <option value="standard">Standard</option>
                  </select>
                  <div className="relative ml-auto min-w-[11rem] flex-1 sm:max-w-[16rem]">
                    <Search size={15} aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
                    <input type="search" className="field h-[2.4rem] pl-8.5!" aria-label="Search cases" placeholder="Search cases" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                  </div>
                </div>

                {queue.length === 0 ? (
                  <EmptyState title="The queue is empty" message="The API returned no members for this as-of time." />
                ) : filtered.length === 0 ? (
                  tab === "queue" && active.length === 0 ? (
                    <EmptyState title="Every member is snoozed" message="Open the Snoozed tab to bring a member back." />
                  ) : (
                    <EmptyState title="No member matches" message={tab === "external" ? "No member here has a pending authorisation with these filters." : tab === "day" ? "No clock is under 24 hours and no callback is scheduled with these filters." : "Clear a filter to see the rest of the queue."} />
                  )
                ) : (
                  <div className="overflow-x-auto">
                    <table className="tbl queue-table min-w-[52rem]">
                      <thead>
                        <tr>
                          <th className="w-9">#</th>
                          <th>Member (Age)</th>
                          <th>Trigger &amp; Top Reason</th>
                          <th>
                            <Hover focusable={false} className="inline" content={<p>Sum of the five shown drivers. Open a row&apos;s &quot;Why This Priority&quot; tab for the arithmetic.</p>}>
                              Priority Score
                            </Hover>
                          </th>
                          <th>Compliance Clock</th>
                          <th>Reachability</th>
                          <th>Data Freshness</th>
                          <th>Next Best Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <LayoutGroup>
                          {filtered.map((row) => (
                            <QueueRowView key={row.id} row={row} member={members.get(row.id) ?? null} alert={applied?.memberId === row.id ? applied : null} now={now} selected={selectedRow?.id === row.id && (wide || drawerOpen)} onSelect={() => select(row.id)} />
                          ))}
                        </LayoutGroup>
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="tnum border-t border-line pt-2 text-cap text-ink-2">
                  {filtered.length} of {pluralise(queue.length, "case")}. Filters never change a rank.
                  {tab === "day" && " My Day: a clock under 24 hours or breached, or a callback scheduled this session."}
                  {tab === "external" && " Waiting on External: an authorisation is still pending."}
                </p>
              </>
            )}
          </div>

          <FlagLegend />
        </div>

        {/* Docked at full width. A drawer below it. */}
        {wide && (
          <aside aria-label="Member focus" className="panel sticky top-3 max-h-[calc(100dvh-5.5rem)] w-[28.5rem] shrink-0 overflow-hidden">
            {detail ?? <p className="p-4 text-foot text-ink-2">Choose a row to see the member here.</p>}
          </aside>
        )}
      </div>

      {!wide && (
        <Drawer open={drawerOpen && selectedRow !== null} onClose={() => setDrawerOpen(false)} title={<h2 className="text-head font-semibold">Member focus</h2>}>
          {detail}
        </Drawer>
      )}
    </div>
  );
}
