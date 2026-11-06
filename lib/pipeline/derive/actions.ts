import { inWindow, minutesOfDay, toMin } from "../dates";
import { ev, firstSentences, iso, normalisePhone, s, type Store } from "../standardise";
import type { Clock, ContactOption, Evidence, MedicationView, NextAction, Reachability, Signal } from "../types";
import { detectSourceSwitch, findReversibleDenials } from "./medications";
import { ownerRole } from "./reachability";

const shortOwner = (option: ContactOption) => String(option.owner.value ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
const RELATION = /^(Daughter|Son|Mother|Father|Grandmother|Grandfather|Wife|Husband|Sister|Brother)\b/;
const lowerRelation = (name: string) => (RELATION.test(name) ? name[0].toLowerCase() + name.slice(1) : name);
const who = (option: ContactOption) => (option.ownerIsMember ? `the member (${option.value})` : `${lowerRelation(shortOwner(option))} (${option.value})`);

interface Candidate extends NextAction {
  priority: number;
}

interface ActionInput {
  store: Store;
  memberId: string;
  signals: Signal[];
  reach: Reachability;
  meds: MedicationView;
  clocks: Clock[];
}

/** Stage 4f. Rules propose actions in priority order; the top three are suggested, each with a reason. */
export function buildActions({ store, memberId, signals, reach, meds, clocks }: ActionInput): NextAction[] {
  const out: Candidate[] = [];
  const has = (code: string) => signals.find((sig) => sig.code === code);
  const add = (priority: number, id: string, kind: NextAction["kind"], title: string, reason: string, evidence: Evidence[], target: ContactOption | null = null) => {
    out.push({ priority, id: `${memberId}:${id}`, kind, title, reason, targetKey: target?.key ?? null, evidence });
  };
  const best = reach.best;
  const language = String(reach.language.value ?? "");
  const interpreter = reach.interpreterRequired ? ` with a ${language} interpreter on standby` : "";
  const consentNote = best && best.consent.state === "outside_plan" ? " The release is held outside the plan: confirm it before discussing clinical detail." : "";
  const windowStart = best?.bestWindow?.start;

  /* Safety first: these override the best-time window. */
  const redFlag = has("red_flag_symptom");
  if (redFlag && best) {
    add(10, "redflag", "call", `Call ${who(best)} now${interpreter}: confirm current fever and whether the member reached the ED or on-call line`, `${redFlag.detail}${consentNote}`, redFlag.evidence, best);
  }
  const duplicate = has("duplicate_anticoagulation");
  if (duplicate && best) {
    add(20, "anticoag-call", "call", `Call ${who(best)} now: confirm which anticoagulant is being taken and ask about bleeding`, `${duplicate.detail} ${best.consent.state === "ok" ? "Authorisation is on file. " : ""}Safety overrides the best-time window.`.trim(), duplicate.evidence, best);
    const anticoagulantFill = store
      .rows("05", memberId)
      .filter((r) => /anticoag/i.test(meds.rows.find((m) => s(r, "Drug").toLowerCase().includes(m.key))?.drugClass ?? "") && iso(r, "Fill_Date"))
      .sort((a, b) => toMin(iso(b, "Fill_Date")!) - toMin(iso(a, "Fill_Date")!))[0];
    const pcp = store.rows("18", memberId).find((r) => /^pcp/i.test(s(r, "Role")));
    add(25, "medrec", "task", `Same-day medication reconciliation with ${anticoagulantFill ? s(anticoagulantFill, "Prescriber") : "the prescriber"}${pcp ? ` and ${s(pcp, "Name")}` : ""}`, "The reconciliation measure allows 30 days; the conflict needs it today. The clinician records the outcome: the system does not pick a winner.", duplicate.evidence);
  }

  /* Reach the member at all. */
  const overdose = has("opioid_overdose_no_moud");
  if (reach.primary && reach.primary.statusClass === "dead" && best) {
    const lastAttempt = store.rows("13", memberId).find((r) => !/closed/i.test(s(r, "Case_Status")) && /attempt (\d+) of \1\b/i.test(s(r, "Goal_Barrier_Or_Task")));
    add(
      30,
      "alt-number",
      "call",
      `Call ${best.value}${windowStart ? ` after ${windowStart}` : ""}. Do not dial ${reach.primary.value}`,
      `On-file number: ${String(reach.primary.status.value)}. Working number from ${best.origin ?? "another source"}, not yet in the plan's record.${overdose ? ` ${overdose.title}.` : ""}${lastAttempt ? " Today's attempt is the last before the case auto-closes." : ""}`,
      [...reach.primary.evidence, ...best.evidence, ...(lastAttempt ? [ev(lastAttempt)] : [])],
      best,
    );
  }
  const consent = has("consent_blocks_source");
  if (consent) {
    add(32, "consent", "task", "Renew the expired consent at first live contact", consent.detail, consent.evidence);
  }

  const erx = has("erx_not_dispensed");
  if (erx) {
    const working = store
      .rows("05", memberId)
      .filter((r) => iso(r, "Fill_Date") && /^PBM$/i.test(s(r, "Source")))
      .sort((a, b) => toMin(iso(b, "Fill_Date")!) - toMin(iso(a, "Fill_Date")!))[0];
    const closed = /closed/i.test(erx.title);
    if (closed) {
      add(34, "reroute", "task", `Re-route the prescriptions${working ? ` to ${s(working, "Pharmacy")}, where the member last filled` : " to a working pharmacy"}`, firstSentences(erx.detail, 3), erx.evidence);
    }
  }
  const ride = has("vendor_address_wrong");
  if (ride) {
    const next = store
      .rows("14", memberId)
      .filter((r) => /wrong address/i.test(s(r, "Quality_Flag")) && iso(r, "Appt_DateTime"))
      .sort((a, b) => toMin(iso(a, "Appt_DateTime")!) - toMin(iso(b, "Appt_DateTime")!))[0];
    add(36, "ride", "task", `Correct the pickup address before ${next ? iso(next, "Appt_DateTime")!.slice(0, 10) : "the next trip"}`, firstSentences(ride.detail, 2), ride.evidence);
  }

  const services = has("discharged_without_services");
  if (services) {
    const pended = store.rows("08", memberId).find((r) => /home health/i.test(s(r, "Service_Requested")) && /pended/i.test(s(r, "Status")));
    add(40, "escalate-auth", "task", `Escalate ${pended ? s(pended, "Auth_ID") : "the pended authorisation"} with ${pended ? s(pended, "Owner_Queue") : "UM"} today`, services.detail, services.evidence);
  }

  /* Paediatric asthma: one regimen, in the right language. */
  const controllers = has("two_controllers_none_home");
  if (controllers && best) {
    const pcp = store.rows("18", memberId).find((r) => /actual pcp/i.test(s(r, "Role")));
    const time = windowStart ? ` after ${windowStart}` : "";
    add(42, "controller", "call", `Call ${who(best)}${time}, in ${language}: teach-back on controller versus rescue, and agree one controller${pcp ? ` with ${s(pcp, "Name")}` : ""}`, firstSentences(controllers.detail, 3), controllers.evidence, best);
  }
  const notScheduled = store.rows("14", memberId).find((r) => /not scheduled/i.test(s(r, "Status")));
  if (notScheduled) {
    const visitClock = clocks.find((c) => c.cls === "toc_visit");
    const dueText = visitClock?.dueAt && (visitClock.hoursLeft ?? 0) > 0 ? ` by ${visitClock.dueAt.slice(0, 10)}` : "";
    add(44, "book-visit", "task", `Book ${s(notScheduled, "Provider_Facility")}: ${s(notScheduled, "Type")}${dueText}`, `${s(notScheduled, "Status")}. ${s(notScheduled, "Quality_Flag")}`, [ev(notScheduled)]);
  }
  const stuck = has("referral_stuck");
  if (stuck) {
    const touchpoint = store
      .rows("14", memberId)
      .filter((r) => /instruction/i.test(s(r, "Status")) && iso(r, "Appt_DateTime"))
      .sort((a, b) => toMin(iso(a, "Appt_DateTime")!) - toMin(iso(b, "Appt_DateTime")!))[0];
    const vendorRow = store.rows("16", memberId).find((r) => /pending/i.test(s(r, "Status")));
    add(46, "referral", "task", `Call ${vendorRow ? s(vendorRow, "Vendor_Or_Agency") : "the vendor"} to accept the referral${touchpoint ? `; co-locate at ${s(touchpoint, "Type").toLowerCase()} on ${iso(touchpoint, "Appt_DateTime")!.slice(0, 10)}` : ""}`, stuck.title, stuck.evidence);
  }
  const allergen = has("allergen_housing_joined");
  if (allergen) {
    const benefit = store.rows("16", memberId).find((r) => /environment/i.test(s(r, "Benefit_Or_Service")));
    add(48, "environment", "task", `Request ${benefit ? s(benefit, "Benefit_Or_Service") : "a home environmental assessment"}`, allergen.detail, [...allergen.evidence, ...(benefit ? [ev(benefit)] : [])]);
  }

  /* Rising risk: right channel, right time, and fix what the plan itself got wrong. */
  if (detectSourceSwitch(store, memberId) && best && reach.preferredAction === "sms") {
    const sw = has("source_switch")!;
    const open = best.bestWindow?.start;
    const voice = store.rows("12", memberId).filter((r) => /^phone/i.test(s(r, "Channel")) && r.eventAt && normalisePhone(s(r, "Number_Or_Address_Used"))?.digits === best.key);
    const inAvoid = voice.filter((r) => best.avoidWindows.some((w) => inWindow(minutesOfDay(r.eventAt!), w.start, w.end))).length;
    add(
      50,
      "sms",
      "sms",
      `Send an SMS now: offer a call${open ? ` after ${open}` : ""}, and ask where medicines are filled`,
      `${firstSentences(sw.detail, 2)} SMS opt-in is on file. ${inAvoid} of ${voice.length} voice calls so far fell inside the member's stated sleep or work hours.`,
      sw.evidence,
      best,
    );
  }
  const denials = findReversibleDenials(store, memberId);
  if (denials.length > 0) {
    const denial = denials[0].denial;
    const signal = has("denial_reversible");
    add(52, "resubmit", "task", `Re-submit ${s(denial, "Auth_ID")} with the kidney labs attached`, signal?.detail ?? s(denial, "Pend_Or_Denial_Reason"), signal?.evidence ?? [ev(denial)]);
  }
  const noShow = has("appointment_misfit");
  if (noShow) {
    const missed = store.rows("14", memberId).find((r) => /no-?show/i.test(s(r, "Status")));
    add(54, "rebook", "task", `Rebook ${missed ? s(missed, "Provider_Facility") : "the missed visit"} outside the sleep window`, noShow.detail, noShow.evidence);
  }

  /* A follow-up clock with no appointment, when no other rule has claimed it. */
  const followUp = has("no_followup_booked");
  if (followUp && !notScheduled) {
    add(60, "followup", "task", "Book a follow-up visit", followUp.title, followUp.evidence);
  }

  /* Fallback, so every member always has something to do. */
  if (out.length === 0 && best) {
    add(90, "contact", reach.preferredAction === "sms" ? "sms" : "call", `Contact ${who(best)}`, `Highest-ranked working contact. ${ownerRole(best)} number, score ${best.score}.`, best.evidence, best);
  }
  return out
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map(({ id, kind, title, reason, targetKey, evidence }) => ({ id, kind, title, reason, targetKey, evidence }));
}
