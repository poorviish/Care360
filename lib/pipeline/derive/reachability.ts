import { CONTACTABLE, TIME_WINDOWS } from "../../config/scoring";
import { daysBetween, hmToMinutes, inWindow, minutesOfDay, toMin } from "../dates";
import { cell, computed, ev, iso, missing, normalisePhone, s, type Store } from "../standardise";
import type { AttemptStats, ConsentState, ContactOption, Reachability, Sourced, StdRow, TimeWindow } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (hour: number) => `${pad(hour)}:00`;

/** Reads a best-time cell into a window and any times to avoid. Vague words use fixed config windows. */
export function parseBestTime(text: string): { window: TimeWindow | null; avoid: TimeWindow[] } {
  const avoid: TimeWindow[] = [];
  for (const match of text.matchAll(/(?:works|asleep)\s*~?(\d{2}:\d{2})-(\d{2}:\d{2})/gi)) {
    avoid.push({ start: match[1], end: match[2] });
  }
  const after = /after\s+(\d{2}:\d{2})/i.exec(text);
  if (after) return { window: { start: after[1], end: hm(TIME_WINDOWS.latestCallHour) }, avoid };
  if (/evening/i.test(text)) return { window: { start: hm(TIME_WINDOWS.evenings.start), end: hm(TIME_WINDOWS.evenings.end) }, avoid };
  if (/afternoon/i.test(text)) return { window: { start: hm(TIME_WINDOWS.afternoons.start), end: hm(TIME_WINDOWS.afternoons.end) }, avoid };
  return { window: null, avoid };
}

const FAIL_OUTCOME = /no answer|voicemail|hung up|not in service|refused/i;
export const isSuccessfulContact = (row: StdRow) => /^connected$/i.test(s(row, "Outcome")) || /^replied/i.test(s(row, "Outcome"));

/** Rows that count as a successful contact: connected to the member with no qualifier, or a two-way reply. */
export function successfulContacts(store: Store, memberId: string): StdRow[] {
  return store
    .rows("12", memberId)
    .filter(isSuccessfulContact)
    .sort((a, b) => toMin(b.eventAt ?? "1900-01-01") - toMin(a.eventAt ?? "1900-01-01"));
}

function attemptCount(row: StdRow): number {
  const multi = /x(\d+)/i.exec(s(row, "Channel"));
  return multi ? Number(multi[1]) : 1;
}

function attemptStats(store: Store, memberId: string, digits: string): AttemptStats {
  const rows = store
    .rows("12", memberId)
    .filter((r) => normalisePhone(s(r, "Number_Or_Address_Used"))?.digits === digits)
    .sort((a, b) => toMin(b.eventAt ?? "1900-01-01") - toMin(a.eventAt ?? "1900-01-01"));
  const recent = rows.filter((r) => r.eventAt && daysBetween(r.eventAt, store.asOf) <= 30);
  return {
    total: rows.reduce((sum, r) => sum + attemptCount(r), 0),
    connected: rows.filter((r) => /^connected|^replied/i.test(s(r, "Outcome"))).length,
    recentFails: recent.filter((r) => FAIL_OUTCOME.test(s(r, "Outcome"))).length,
    lastAt: rows[0]?.eventAt ?? null,
    lastOutcome: rows[0] ? s(rows[0], "Outcome") : null,
  };
}

function consentState(row: StdRow, ownerIsMember: boolean, asOf: string): ConsentState {
  const type = s(row, "Consent_Type");
  const status = s(row, "Consent_Status");
  if (/TCPA/i.test(type) || (!type && !status)) return ownerIsMember ? "not_required" : "none";
  if (/expired/i.test(status)) return "expired";
  const expiry = iso(row, "Consent_Expiry");
  if (expiry && toMin(expiry) < toMin(asOf)) return "expired";
  if (/not on file/i.test(status)) return "outside_plan";
  if (/none|not obtained/i.test(status)) return "none";
  if (/on file|implied|opted in/i.test(status)) return "ok";
  return "none";
}

function classifyStatus(status: string): ContactOption["statusClass"] {
  if (/not in service|bouncing/i.test(status)) return "dead";
  if (/do not call/i.test(status)) return "do_not_call";
  if (/active/i.test(status)) return "working";
  return "unknown";
}

function scoreContact(option: Omit<ContactOption, "score" | "rank" | "scoreReasons">, store: Store, recentTwoWay: boolean): { score: number; reasons: string[] } {
  if (option.statusClass === "dead" || option.statusClass === "do_not_call") {
    return { score: 0, reasons: [`Status: ${String(option.status.value)}`] };
  }
  const reasons: string[] = [];
  let score = 0;
  const rings = /rings/i.test(String(option.status.value));
  score += rings ? 25 : 40;
  reasons.push(rings ? "Rings, not answered: +25" : "Active: +40");
  if (option.ownerIsMember) {
    score += 20;
    reasons.push("Member's own: +20");
  } else {
    const points = { ok: 25, outside_plan: 15, none: 5, expired: 5, not_required: 20 }[option.consent.state];
    score += points;
    reasons.push(`Other person, consent ${option.consent.state.replace("_", " ")}: +${points}`);
  }
  const verifiedAt = typeof option.lastVerified.date === "string" ? option.lastVerified.date : null;
  if (verifiedAt) {
    const age = daysBetween(verifiedAt, store.asOf);
    const points = age <= 30 ? 20 : age <= 180 ? 10 : 0;
    score += points;
    reasons.push(`Verified ${age} d ago: +${points}`);
  } else {
    reasons.push("Never verified: +0");
  }
  if (option.attempts.recentFails > 0) {
    const penalty = Math.min(30, option.attempts.recentFails * 10);
    score -= penalty;
    reasons.push(`${option.attempts.recentFails} failed attempts in 30 d: -${penalty}`);
  }
  if (recentTwoWay) {
    score += 10;
    reasons.push("Two-way contact in 90 d: +10");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

const shortOwner = (owner: string) => owner.replace(/\s*\(.*\)\s*$/, "").trim();
const windowText = (w: TimeWindow) => `${w.start} to ${w.end}`;

export function ownerRole(option: ContactOption): string {
  const owner = String(option.owner.value ?? "");
  return option.ownerIsMember ? "member" : owner.split(/\s+/)[0].toLowerCase();
}

function buildOption(store: Store, memberId: string, row: StdRow, digits: string, kind: ContactOption["kind"], display: string, successful: StdRow[]): ContactOption {
  const owner = s(row, "Owner_Of_Contact");
  const ownerIsMember = /^member\b/i.test(owner);
  const label = s(row, "Label_In_System");
  const statusText = s(row, "Status");
  const statusClass = classifyStatus(statusText);
  const state = consentState(row, ownerIsMember, store.asOf);
  const consentType = s(row, "Consent_Type");
  const consentStatus = s(row, "Consent_Status");
  const verifiedRaw = s(row, "Last_Verified");
  const verifiedIso = iso(row, "Last_Verified");
  const staleVerified = verifiedIso ? daysBetween(verifiedIso, store.asOf) > 365 : true;
  const notInPlan = /not in plan record|stored only|not recorded/i.test(label);
  const smsAllowed = /TCPA/i.test(consentType) && /opted in/i.test(consentStatus) && statusClass === "working";
  const bestText = s(row, "Best_Time");
  const { window: parsedWindow, avoid } = parseBestTime(bestText);

  const base = {
    key: kind === "phone" ? digits : display.toLowerCase(),
    kind,
    value: display,
    owner: cell(store, row, "Owner_Of_Contact", {
      date: verifiedIso,
      flags: !ownerIsMember && /member|primary/i.test(label) ? [{ tag: "conflicting", note: `Labelled "${label}" in the system` }] : undefined,
    }),
    ownerIsMember,
    label,
    origin: row.f["Source"] ?? null,
    status: {
      ...cell(store, row, "Status", {
        date: verifiedIso,
        flags: [
          ...(notInPlan ? [{ tag: "unverified" as const, note: "Not in the plan's contact record" }] : []),
          ...(staleVerified && statusClass === "working" ? [{ tag: "stale" as const, note: `Last verified ${verifiedRaw || "never"}` }] : []),
        ],
      }),
    },
    statusClass,
    mislabelled: !ownerIsMember && /member|primary/i.test(label),
    inPlanRecord: !notInPlan,
    consent: {
      state,
      text:
        consentType || consentStatus
          ? { ...cell(store, row, "Consent_Status", { date: iso(row, "Consent_Expiry") ?? verifiedIso }), value: [consentType, consentStatus].filter(Boolean).join(": ") }
          : ownerIsMember
            ? { value: "Not required: the member's own contact", source: "Rule", date: null, evidence: [ev(row, "Owner_Of_Contact")] }
            : { value: null, source: store.sheetLabels.get("02") ?? "Contact & consent", date: null, evidence: [ev(row, "Consent_Status")] },
    },
    smsAllowed,
    smsReason: smsAllowed ? `SMS opted in: ${consentStatus}` : "No SMS consent on file",
    bestTimeText: cell(store, row, "Best_Time", { date: verifiedIso }),
    bestWindow: parsedWindow,
    avoidWindows: avoid,
    language: s(row, "Language_Interpreter") || null,
    lastVerified: { ...cell(store, row, "Last_Verified", { date: verifiedIso }), ...(verifiedRaw ? {} : { value: null }) },
    attempts: kind === "phone" ? attemptStats(store, memberId, digits) : { total: 0, connected: 0, recentFails: 0, lastAt: null, lastOutcome: null },
    evidence: [ev(row)],
  } satisfies Omit<ContactOption, "score" | "rank" | "scoreReasons">;

  const recentTwoWay = successful.some(
    (r) => normalisePhone(s(r, "Number_Or_Address_Used"))?.digits === digits && r.eventAt && daysBetween(r.eventAt, store.asOf) <= 90,
  );
  const { score, reasons } = scoreContact(base, store, recentTwoWay);
  return { ...base, score, rank: 0, scoreReasons: reasons };
}

export function buildLanguage(store: Store, memberId: string): Pick<Reachability, "language" | "languageValues" | "languageConflict" | "interpreterRequired"> {
  const values: Sourced[] = [];
  const contactRows = store.rows("02", memberId).filter((r) => s(r, "Language_Interpreter"));
  const contactLanguages: { language: string; sourced: Sourced }[] = [];
  for (const row of contactRows) {
    const text = s(row, "Language_Interpreter");
    const language = text.split(/[\s/(]/)[0];
    const owner = s(row, "Owner_Of_Contact");
    // A carer's own English says nothing about what the member speaks.
    if (!/^member\b/i.test(owner) && /^english/i.test(language)) continue;
    const sourced = cell(store, row, "Language_Interpreter", { date: iso(row, "Last_Verified"), source: `Contact record (${owner.replace(/\s*\(.*\)/, "")})` });
    contactLanguages.push({ language, sourced });
    values.push(sourced);
  }
  for (const row of store.rows("02", memberId).filter((r) => /written language/i.test(s(r, "Record_Type")))) {
    const sourced = cell(store, row, "Value", { source: "Written language record", date: null });
    contactLanguages.push({ language: s(row, "Value").split(/\s/)[0], sourced });
    values.push(sourced);
  }
  const fileLanguages: { language: string; sourced: Sourced }[] = [];
  for (const row of store.rows("01", memberId)) {
    const text = s(row, "Language_On_File");
    if (!text) continue;
    const sourced = cell(store, row, "Language_On_File", { source: s(row, "Source_File") || "Eligibility file", date: iso(row, "Received_Date") });
    fileLanguages.push({ language: text.split(/\s/)[0], sourced });
    values.push(sourced);
  }
  const distinct = new Set([...contactLanguages, ...fileLanguages].map((x) => x.language.toLowerCase()));
  const conflict = distinct.size > 1;
  // Precedence: contact and encounter evidence beats an enrolment default.
  const nonEnglish = (list: typeof contactLanguages) => list.find((x) => !/^english/i.test(x.language));
  const chosen = nonEnglish(contactLanguages) ?? contactLanguages[0] ?? nonEnglish(fileLanguages) ?? fileLanguages[0];
  const language: Sourced = chosen
    ? {
        ...chosen.sourced,
        value: chosen.language,
        flags: conflict ? [{ tag: "conflicting", note: `Sources disagree: ${[...distinct].join(", ")}` }] : undefined,
      }
    : missing("Contact record");
  const interpreterRequired =
    contactRows.some((r) => /interpreter (needed|required)/i.test(s(r, "Language_Interpreter"))) ||
    Boolean(chosen && !/^english/i.test(chosen.language));
  return { language, languageValues: values, languageConflict: conflict, interpreterRequired };
}

export function buildReachability(store: Store, memberId: string): Reachability {
  const successful = successfulContacts(store, memberId);
  const contactRows = store.rows("02", memberId);
  const options: ContactOption[] = [];
  for (const row of contactRows) {
    const type = s(row, "Record_Type");
    if (/^phone/i.test(type)) {
      const phone = normalisePhone(s(row, "Value"));
      if (phone) options.push(buildOption(store, memberId, row, phone.digits, "phone", phone.display, successful));
    } else if (/^email/i.test(type)) {
      options.push(buildOption(store, memberId, row, "", "email", s(row, "Value"), successful));
    }
  }
  options.sort((a, b) => b.score - a.score || (a.kind === "phone" ? -1 : 1));
  options.forEach((o, i) => (o.rank = i + 1));

  const phones = options.filter((o) => o.kind === "phone");
  const primary = phones.find((o) => /primary/i.test(o.label)) ?? phones[0] ?? null;
  const best = phones.find((o) => o.score > 0) ?? null;

  const asOfMinute = minutesOfDay(store.asOf);
  const smsAvailable = Boolean(best?.smsAllowed);
  const preferredRow = contactRows.find((r) => best && normalisePhone(s(r, "Value"))?.digits === best.key);
  const prefersSms = /sms/i.test(preferredRow ? s(preferredRow, "Preferred_Channel") : "");
  const preferredAction: Reachability["preferredAction"] = smsAvailable && prefersSms ? "sms" : "call";

  const primaryBad = primary ? primary.statusClass === "dead" || primary.statusClass === "do_not_call" : true;
  let callDemoted = false;
  let demotionReason: string | null = null;
  if (primaryBad && primary) {
    callDemoted = true;
    demotionReason = `On-file number ${primary.value} is not usable: ${String(primary.status.value)}.`;
  } else if (primary && best && primary.key !== best.key) {
    callDemoted = true;
    demotionReason = primary.ownerIsMember
      ? `On-file number ${primary.value} ranks below ${shortOwner(String(best.owner.value))}'s: ${primary.attempts.recentFails} failed attempts in 30 days.`
      : `On-file number ${primary.value} belongs to ${shortOwner(String(primary.owner.value))}, not the member.`;
  } else if (preferredAction === "sms" && best) {
    callDemoted = true;
    demotionReason = `Member opted in to SMS. Voice calls have failed ${best.attempts.recentFails} times in 30 days.`;
  }

  let inWindowNow = false;
  if (best) {
    if (preferredAction === "sms") {
      inWindowNow = !best.avoidWindows.some((w) => inWindow(asOfMinute, w.start, w.end));
    } else if (best.bestWindow) {
      inWindowNow = inWindow(asOfMinute, best.bestWindow.start, best.bestWindow.end);
    }
  }
  const working = Boolean(best && best.statusClass === "working");
  const consentOk = Boolean(best && (best.consent.state === "ok" || best.consent.state === "not_required"));
  const fraction = (working ? CONTACTABLE.workingNumber : 0) + (consentOk ? CONTACTABLE.consentOnFile : 0) + (inWindowNow ? CONTACTABLE.inBestWindow : 0);

  /* Best time: the stated value, or a window derived from when the member is at work or asleep. */
  let bestTime: Sourced = missing(store.sheetLabels.get("02") ?? "Contact & consent");
  if (best) {
    if (best.bestWindow) {
      bestTime = { ...best.bestTimeText };
      const startMinute = hmToMinutes(best.bestWindow.start);
      for (const row of store.rows("12", memberId)) {
        const note = /after\s+(\d{1,2})\s*pm/i.exec(s(row, "Disposition_Note"));
        if (note && (Number(note[1]) + 12) * 60 !== startMinute) {
          bestTime = {
            ...bestTime,
            flags: [{ tag: "conflicting", note: `Outreach note on ${row.eventAt} says "${note[0]}"` }],
            evidence: [...bestTime.evidence, ev(row, "Disposition_Note")],
          };
        }
      }
    } else if (best.avoidWindows.length >= 2) {
      const sorted = [...best.avoidWindows].sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start));
      const open = { start: sorted[0].end, end: sorted[1].start };
      best.bestWindow = open;
      bestTime = computed(
        `${windowText(open)} (derived)`,
        `Gap between the stated work and sleep times: ${String(best.bestTimeText.value)}`,
        best.bestTimeText.evidence,
        typeof best.bestTimeText.date === "string" ? best.bestTimeText.date : null,
        [{ tag: "unverified", note: "Best time is not recorded; this is inferred" }],
      );
    } else if (best.bestTimeText.value && !/unknown/i.test(String(best.bestTimeText.value))) {
      bestTime = { ...best.bestTimeText };
    }
  }

  const lastContact = successful[0];
  const lastConfirmed: Sourced = lastContact
    ? {
        value: `${s(lastContact, "Channel")}: ${s(lastContact, "Outcome")}`,
        source: store.sheetLabels.get("12") ?? "Outreach history",
        date: lastContact.eventAt,
        evidence: [ev(lastContact, "Outcome")],
      }
    : { value: null, source: store.sheetLabels.get("12") ?? "Outreach history", date: null, evidence: [] };

  const eligibility = store.rows("01", memberId);
  const latestElig = eligibility[eligibility.length - 1];
  const addressRow = contactRows.find((r) => /^address/i.test(s(r, "Record_Type")));
  const addressOnFile = latestElig ? cell(store, latestElig, "Address_On_File", { date: iso(latestElig, "Received_Date"), flags: addressRow ? [{ tag: "conflicting", note: "A newer address exists in another source" }] : undefined }) : missing("Eligibility file");
  const addressActual = addressRow ? cell(store, addressRow, "Value", { date: iso(addressRow, "Last_Verified"), source: s(addressRow, "Source") || undefined, flags: [{ tag: "unverified", note: s(addressRow, "Label_In_System") }] }) : null;

  /* One-line summary used on the queue. */
  let band: Reachability["band"] = "direct";
  let label = "No working contact in source data";
  const timePart = best?.bestWindow ? ` · ${best.bestWindow.start} to ${best.bestWindow.end}` : "";
  if (!best) {
    band = "no_working_contact";
  } else if (primaryBad) {
    band = "number_bad_alternate";
    label = `On-file number dead, alternate found${timePart}`;
  } else if (preferredAction === "sms") {
    band = "channel_restricted";
    const avoid = best.avoidWindows.find((w) => hmToMinutes(w.start) >= 6 * 60 && hmToMinutes(w.start) <= 12 * 60);
    label = `SMS first${avoid ? `, avoid voice ${avoid.start} to ${avoid.end}` : ""}`;
  } else if (!best.ownerIsMember) {
    band = "via_caregiver";
    label = `Via ${ownerRole(best)}${timePart}`;
  } else {
    label = `Direct${timePart}`;
  }

  const language = buildLanguage(store, memberId);
  const explanation = !best
    ? "No working contact."
    : [
        working ? `Working number (${best.value})` : "No working number",
        consentOk ? "consent in order" : `consent ${best.consent.state.replace("_", " ")}`,
        preferredAction === "sms"
          ? inWindowNow
            ? "SMS can go now: as-of is outside the stated work and sleep times"
            : "as-of falls inside the stated work or sleep times"
          : inWindowNow
            ? "inside the best-time window at as-of"
            : best.bestWindow
              ? `outside the best-time window (${windowText(best.bestWindow)}) at as-of`
              : "no best time on record",
      ].join(", ");

  return {
    label,
    band,
    primary,
    best,
    options,
    callDemoted,
    demotionReason,
    preferredAction,
    smsAvailable,
    smsReason: best?.smsReason ?? "No SMS consent on file",
    ...language,
    bestTime,
    lastConfirmed,
    contactableNow: { fraction: Math.round(fraction * 100) / 100, working, consent: consentOk, inWindow: inWindowNow, explanation },
    addressOnFile,
    addressActual,
    addressUnreliable: Boolean(addressRow),
  };
}
