import { SDOH_STALE_DAYS } from "../../config/scoring";
import { daysBetween } from "../dates";
import { AREA_ASSESSMENT, SDOH_ASSESSMENT, SDOH_DOMAINS } from "../dictionaries";
import { ev, iso, num, s, type Store } from "../standardise";
import type { ExceptionFlag, SdohItem, StdRow } from "../types";

function makeItem(store: Store, row: StdRow, domain: string, text: string, column: string, assessment: string): SdohItem {
  const date = iso(row, "Date") ?? row.eventAt;
  const ageDays = date ? daysBetween(date, store.asOf) : null;
  const threshold = SDOH_STALE_DAYS[domain] ?? null;
  const stale = ageDays !== null && threshold !== null && ageDays > threshold;
  const respondent = row.f["Respondent"] ?? null;
  const selfReported = Boolean(respondent && !/^n\/?a$/i.test(respondent) && respondent !== "-");
  const proxy = respondent ? /\bson\b|\bdaughter\b|on member's behalf/i.test(respondent) : false;
  const computedOnWrongAddress = /computed on/i.test(text);
  const flags: ExceptionFlag[] = [
    ...(stale ? [{ tag: "stale" as const, note: `${ageDays} days old; limit for ${domain} is ${threshold}` }] : []),
    ...(selfReported ? [{ tag: "self-reported" as const, note: respondent ?? undefined }] : []),
    ...(proxy ? [{ tag: "unverified" as const, note: `Answered by proxy: ${respondent}` }] : []),
    ...(computedOnWrongAddress ? [{ tag: "unverified" as const, note: "Computed on an address the member does not live at" }] : []),
  ];
  return {
    domain,
    text: {
      value: text,
      source: assessment,
      date,
      evidence: [ev(row, column)],
      ...(flags.length ? { flags } : {}),
    },
    captureDate: date,
    ageDays,
    thresholdDays: threshold,
    stale,
    selfReported,
    respondent,
    assessment,
  };
}

/** One item per statement and domain, each with its own capture date and staleness. */
export function buildSdoh(store: Store, memberId: string): SdohItem[] {
  const items: SdohItem[] = [];
  for (const row of store.rows("11", memberId)) {
    const name = s(row, "Assessment");
    const completion = num(row, "Completion_Pct");
    const text = s(row, "Key_Responses");
    if (!text || !iso(row, "Date") || completion === 0) continue;
    if (AREA_ASSESSMENT.test(name)) {
      items.push(makeItem(store, row, "Area-level", text, "Key_Responses", name));
      continue;
    }
    if (!SDOH_ASSESSMENT.test(name)) continue;
    for (const segment of text.split(";").map((x) => x.trim()).filter(Boolean)) {
      const domain = SDOH_DOMAINS.find((d) => d.pattern.test(segment))?.domain;
      if (domain) items.push(makeItem(store, row, domain, segment, "Key_Responses", name));
    }
  }
  /* SDOH Z-codes on claims are coded evidence, kept separate from what people said. */
  for (const row of store.rows("04", memberId)) {
    for (const match of s(row, "Secondary_Dx").matchAll(/\bZ(?:59|77)\.\S*\s+[^;]+/g)) {
      const statement = match[0].trim();
      const domain = SDOH_DOMAINS.find((d) => d.pattern.test(statement))?.domain ?? "Home environment";
      const date = iso(row, "Service_Date");
      const ageDays = date ? daysBetween(date, store.asOf) : null;
      const threshold = SDOH_STALE_DAYS[domain] ?? null;
      const stale = ageDays !== null && threshold !== null && ageDays > threshold;
      items.push({
        domain,
        text: {
          value: statement,
          source: `Claim ${s(row, "Claim_ID")}`,
          date,
          evidence: [ev(row, "Secondary_Dx")],
          ...(stale ? { flags: [{ tag: "stale" as const, note: `${ageDays} days old; limit for ${domain} is ${threshold}` }] } : {}),
        },
        captureDate: date,
        ageDays,
        thresholdDays: threshold,
        stale,
        selfReported: false,
        respondent: null,
        assessment: "Claim Z-code",
      });
    }
  }
  return items.sort((a, b) => a.domain.localeCompare(b.domain) || (b.captureDate ?? "").localeCompare(a.captureDate ?? ""));
}
