/**
 * Clinical vocabulary used by the rules: drug names, classes and keyword lists. This is general
 * knowledge, not patient data, and it is the one file in lib/ that may name drugs. An unknown
 * drug still flows through under its workbook name, with no class.
 */

export interface DrugEntry {
  key: string;
  label: string;
  drugClass: string | null;
  aliases: RegExp;
  /** PRN or short-course: past run-out is expected, so it is not a gap. */
  gapExempt?: boolean;
  /** OTC or medical-benefit: absence from pharmacy data says little. */
  invisibleToPbm?: boolean;
}

const drug = (key: string, label: string, drugClass: string | null, aliases: RegExp, extra: Partial<DrugEntry> = {}): DrugEntry => ({
  key,
  label,
  drugClass,
  aliases,
  ...extra,
});

/** Longest and most specific first, so a combination product is consumed before its parts. */
export const DRUGS: DrugEntry[] = [
  drug("buprenorphine-naloxone", "Buprenorphine-naloxone", "Opioid use disorder medication", /buprenorphine(?:-naloxone)?|\bbup\b|'subs'|\bsubs\b/i),
  drug("senna-docusate", "Senna-docusate", "Bowel regimen", /senna(?:-docusate)?/i),
  drug("warfarin", "Warfarin", "Anticoagulant", /warfarin/i),
  drug("apixaban", "Apixaban", "Anticoagulant", /apixaban|eliquis/i),
  drug("oxycodone", "Oxycodone", "Opioid", /oxycodone/i, { gapExempt: true }),
  drug("metoprolol", "Metoprolol", "Beta blocker", /metoprolol/i),
  drug("acetaminophen", "Acetaminophen", "Analgesic", /acetaminophen/i, { gapExempt: true, invisibleToPbm: true }),
  drug("alendronate", "Alendronate", "Bisphosphonate", /alendronate/i),
  drug("lisinopril", "Lisinopril", "ACE inhibitor", /lisinopril/i),
  drug("amlodipine", "Amlodipine", "Calcium channel blocker", /amlodipine/i),
  drug("metformin", "Metformin", "Biguanide", /metformin/i),
  drug("atorvastatin", "Atorvastatin", "Statin", /atorvastatin/i),
  drug("ibuprofen", "Ibuprofen", "NSAID", /ibuprofen|otc pain pills/i, { gapExempt: true, invisibleToPbm: true }),
  drug("empagliflozin", "Empagliflozin", "SGLT2 inhibitor", /empagliflozin|jardiance/i),
  drug("lithium", "Lithium", "Mood stabiliser", /lithium/i),
  drug("quetiapine", "Quetiapine", "Antipsychotic", /quetiapine/i),
  drug("naloxone", "Naloxone", "Opioid reversal", /naloxone/i, { gapExempt: true }),
  drug("albuterol", "Albuterol", "Rescue inhaler", /albuterol/i, { gapExempt: true }),
  drug("fluticasone", "Fluticasone", "Inhaled corticosteroid controller", /fluticasone|flovent|orange inhaler/i),
  drug("budesonide", "Budesonide", "Inhaled corticosteroid controller", /budesonide|pulmicort|nebulizer medicine/i),
  drug("montelukast", "Montelukast", "Leukotriene controller", /montelukast/i),
  drug("prednisolone", "Prednisolone", "Oral corticosteroid", /prednisolone/i, { gapExempt: true }),
  drug("spacer", "Spacer", "Inhaler device", /spacer|valved holding chamber/i, { gapExempt: true }),
  drug("ondansetron", "Ondansetron", "Antiemetic", /ondansetron/i, { gapExempt: true }),
  drug("dexamethasone", "Dexamethasone", "Antiemetic support", /dexamethasone|\bdex\b/i, { gapExempt: true }),
  drug("prochlorperazine", "Prochlorperazine", "Antiemetic", /prochlorperazine/i, { gapExempt: true }),
  drug("pegfilgrastim", "Pegfilgrastim", "Growth factor", /pegfilgrastim/i, { gapExempt: true, invisibleToPbm: true }),
  drug("folfox", "FOLFOX", "Chemotherapy regimen", /folfox/i, { gapExempt: true, invisibleToPbm: true }),
];

export const CLASS_ANTICOAGULANT = "Anticoagulant";
export const CLASS_ICS = "Inhaled corticosteroid controller";
export const CONTROLLER_CLASSES = [CLASS_ICS, "Leukotriene controller"];
export const CLASS_RESCUE = "Rescue inhaler";
export const CLASS_MOUD = "Opioid use disorder medication";
export const CLASS_ANTIEMETIC = /antiemetic/i;

/** Finds every dictionary drug in a text, consuming matches so "buprenorphine-naloxone" is one drug. */
export function findDrugs(text: string): DrugEntry[] {
  const found: DrugEntry[] = [];
  let remaining = text;
  for (const entry of DRUGS) {
    const global = new RegExp(entry.aliases.source, "gi");
    if (global.test(remaining)) {
      found.push(entry);
      remaining = remaining.replace(new RegExp(entry.aliases.source, "gi"), " ");
    }
  }
  return found;
}

/** Monitoring orders tied to one drug: the order is inconsistent once that drug is stopped. */
export const MONITORING_ORDERS: { order: RegExp; drugKey: string }[] = [{ order: /\bINR\b/, drugKey: "warfarin" }];

/** Quality measures that a lapsed drug class is relevant to. */
export const GAP_LINKS: { drugClass: string; measure: RegExp }[] = [{ drugClass: "Bisphosphonate", measure: /^OMW$/ }];

/** Red-flag words in a symptom call. */
export const RED_FLAG_WORDS = /\b(fever|chills|bleeding|chest pain|suicid\w*|shortness of breath|unresponsive)\b/i;
export const SYMPTOM_CHANNEL = /nurse|symptom|triage/i;

/** Words that suggest a call holds care-management content, whatever its reason code says. */
export const CM_RELEVANT_WORDS = /home health|meals?|can't|cannot|nebulizer|medicine|overdose|follow-up|kidney|VA\b|in-home|chemo|driver no-show|missed shift/i;

export const SDOH_ASSESSMENT = /\b(HRA|SDOH|HRSN|PRAPARE)\b/i;
export const AREA_ASSESSMENT = /area-level/i;
export const SCREEN_ASSESSMENT = /\b(PHQ|C-SSRS|C-ACT|asthma control|distress|STEADI|zarit|caregiver strain)\b/i;

/** Maps a free-text SDOH statement to a domain. The first match wins. */
export const SDOH_DOMAINS: { domain: string; pattern: RegExp }[] = [
  { domain: "Housing", pattern: /\bhous|homeless|couch|shelter|\brent/i },
  { domain: "Food", pattern: /\bfood\b/i },
  { domain: "Transportation", pattern: /transport|\bbus\b|\bcar\b|\bdrives?\b/i },
  { domain: "Utilities", pattern: /utilit|shut-?off/i },
  { domain: "Financial", pattern: /financ|income/i },
  { domain: "Legal", pattern: /\blegal\b/i },
  { domain: "Home environment", pattern: /smok|mold|pests?\b/i },
  { domain: "Caregiving and support", pattern: /caregiver|lives (with|alone)|take care of everything|no help needed/i },
  { domain: "Function and falls", pattern: /\bADL\b|\bfalls?\b/i },
  { domain: "Employment", pattern: /\bshift\b|\bworks?\b/i },
];
