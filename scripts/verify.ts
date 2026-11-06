/**
 * npm run verify. Checks the brief's acceptance criteria against the real workbook, the generated
 * output and, when the app is running, the live pages. Exits non-zero if anything fails.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { WEIGHTS, type Weights } from "../lib/config/scoring";
import { DRUGS } from "../lib/pipeline/dictionaries";
import { readWorkbookBytes } from "../lib/pipeline/ingest";
import { runPipeline, SchemaError } from "../lib/pipeline";
import { normalisePhone } from "../lib/pipeline/standardise";
import type { Dataset, DemoFixture, RunReport } from "../lib/pipeline/types";

const root = path.resolve(__dirname, "..");
const BASE = process.env.PRISM_URL ?? "http://127.0.0.1:3000";
const WORKBOOK = path.join(root, "data", "PartC_Synthetic_Patients_Annex (1).xlsx");

let failures = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
function skip(name: string, why: string) {
  skipped += 1;
  console.log(`SKIP  ${name}  (${why})`);
}
const section = (title: string) => console.log(`\n${title}`);

const bytes = readFileSync(WORKBOOK);
const processed = JSON.parse(readFileSync(path.join(root, "data", "processed.json"), "utf8")) as { dataset: Dataset; report: RunReport };
const { dataset, report } = processed;
const fresh = runPipeline(readWorkbookBytes(bytes), { workbookName: path.basename(WORKBOOK) });

/* ---- 1. Row counts, against an independent read ---- */
section("Row counts match the workbook");
{
  const raw = XLSX.read(bytes, { type: "buffer" });
  let mismatches = 0;
  let total = 0;
  for (const name of raw.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(raw.Sheets[name], { header: 1, blankrows: false, defval: null });
    const rows = grid.slice(1).filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")).length;
    total += rows;
    const reported = report.sheets.find((s) => s.name === name)?.rows;
    if (reported !== rows) {
      mismatches += 1;
      console.log(`      ${name}: workbook ${rows}, report ${reported}`);
    }
  }
  check("Every sheet's row count matches an independent read", mismatches === 0, `${raw.SheetNames.length} sheets, ${total} rows`);
  check("Report covers every sheet", report.sheets.length === raw.SheetNames.length);
  check("Report total equals the sum of sheets", report.totals.rows === total);
}

/* ---- 2. Generated output ---- */
section("Generated output");
{
  const withoutDemo = (d: Dataset) => ({ ...d, demo: {} });
  check("data/processed.json is up to date with the workbook", JSON.stringify(withoutDemo(dataset)) === JSON.stringify(withoutDemo(fresh.dataset)));
  check("Pipeline is deterministic across two runs", JSON.stringify(fresh.dataset) === JSON.stringify(runPipeline(readWorkbookBytes(bytes)).dataset));
  const originalTz = process.env.TZ;
  const outputs = ["America/Los_Angeles", "Asia/Kolkata", "UTC"].map((tz) => {
    process.env.TZ = tz;
    return JSON.stringify(runPipeline(readWorkbookBytes(bytes)).dataset);
  });
  process.env.TZ = originalTz;
  check("Output does not depend on the machine's timezone", new Set(outputs).size === 1);
}

/* ---- 3. Flags ---- */
section("Quality flags");
{
  const sum = report.flagsByType.reduce((n, t) => n + t.count, 0);
  check("Flags by type sum to the total", sum === report.flagTotal, `${sum}`);
  check("Report total equals the dataset's flags", report.flagTotal === dataset.flags.length, `${dataset.flags.length}`);
  const severity = Object.values(report.flagsBySeverity).reduce((a, b) => a + b, 0);
  check("Flags by severity sum to the total", severity === report.flagTotal);
  check("Every flag has a member, a severity and evidence", dataset.flags.every((f) => f.memberId && f.severity && f.evidence.length > 0 && f.evidence.every((e) => e.sheet && e.row > 0)));
  check("Evidence points at real sheets and rows", dataset.flags.every((f) => f.evidence.every((e) => report.sheets.some((s) => s.name === e.sheet))));
  const declared = report.flagsByType.find((t) => t.type === "source_flag")?.count;
  check("Every Quality_Flag cell in the workbook is carried through", declared === report.totals.rowsWithSourceFlag, `${declared} of ${report.totals.rowsWithSourceFlag}`);
  const named = ["possible_duplicate_profile", "conflicting_medication", "delayed_or_pending_claim", "bad_or_wrong_person_phone", "stale_sdoh", "missing_field"];
  check("All six flag types the brief names are raised", named.every((t) => (report.flagsByType.find((x) => x.type === t)?.count ?? 0) > 0));
}

/* ---- 4. Planted imperfections ---- */
section("Planted imperfections");
{
  const uncovered = report.plantedCoverage.filter((p) => !p.covered);
  check("Every planted imperfection is flagged", uncovered.length === 0 && report.plantedCoverage.length === 40, `${report.plantedCoverage.length - uncovered.length} of ${report.plantedCoverage.length}${uncovered.length ? `; missing ${uncovered.map((p) => p.id).join(", ")}` : ""}`);
  const lib = walk(path.join(root, "lib")).filter((f) => !/plantedCoverage\.ts$/.test(f) && !/index\.ts$/.test(f));
  const peeks = lib.filter((f) => /Planted_Imperfections|Monday_8am|Queue_Rank/.test(readFileSync(f, "utf8")));
  check("Detectors never read the answer-key sheets", peeks.length === 0, peeks.map((f) => path.relative(root, f)).join(", "));
  const index = readFileSync(path.join(root, "lib", "pipeline", "index.ts"), "utf8");
  const reportBody = index.slice(index.indexOf("function buildReport"));
  const beforeReport = index.slice(0, index.indexOf("function buildReport"));
  check("Answer-key sheets are read only while building the audit report", !/Planted_Imperfections|Monday_8am/.test(beforeReport) && /Planted_Imperfections/.test(reportBody));
}

/* ---- 5. Scoring ---- */
section("Scoring");
{
  const order = (d: Dataset) => d.queue.map((q) => q.id).join(",");
  check("Each score equals the sum of its shown driver points", dataset.members.every((m) => m.priority.score === m.priority.drivers.reduce((n, d) => n + d.points, 0)));
  check("Each queue row's score equals its driver points", dataset.queue.every((q) => q.score === q.drivers.reduce((n, d) => n + d.points, 0)));
  check("Default weights match the brief", WEIGHTS.deadline === 35 && WEIGHTS.clinicalRisk === 30 && WEIGHTS.newSignal === 20 && WEIGHTS.openCommitments === 10 && WEIGHTS.contactableNow === 5);
  check("Scores use the configured weights", dataset.members.every((m) => m.priority.drivers.every((d) => d.weight === WEIGHTS[d.key])));

  const reweigh = (patch: Partial<Weights>) => runPipeline(readWorkbookBytes(bytes), { weights: { ...WEIGHTS, ...patch } }).dataset;
  const noCommitments = reweigh({ openCommitments: 0 });
  check("Changing one weight changes the order", order(noCommitments) !== order(dataset), `Open commitments 0: ${noCommitments.queue.map((q) => q.rank + ":" + q.id).join(" ")}`);
  const flipped = reweigh({ deadline: 5, clinicalRisk: 5, newSignal: 5, openCommitments: 80, contactableNow: 5 });
  check("A heavier reweighting changes the order too", order(flipped) !== order(dataset));

  const noReach = reweigh({ contactableNow: 0 });
  const heavyReach = reweigh({ contactableNow: 50 });
  check("Guardrail: reachability never lowers a rank", dataset.queue.every((q) => {
    const without = noReach.queue.find((x) => x.id === q.id)!.rank;
    return q.rank <= without;
  }) && order(heavyReach) === order(noReach), `order with weight 0 and 50 is identical`);

  const mustBeTop = dataset.members.filter((m) => m.clocks.some((c) => c.cls === "toc_contact" && (c.status === "breached" || c.status === "final24")));
  check("Guardrail: TOC contact clock in final 24 h or breached is top tier", mustBeTop.length > 0 && mustBeTop.every((m) => m.priority.topTier), `${mustBeTop.length} members`);
  const lowestTop = Math.max(...dataset.queue.filter((q) => q.topTier).map((q) => q.rank));
  const highestRest = Math.min(...dataset.queue.filter((q) => !q.topTier).map((q) => q.rank));
  check("Top tier always ranks above the rest", lowestTop < highestRest);
  const breachedArrival = dataset.members.flatMap((m) => m.clocks.filter((c) => c.cls === "toc_contact"));
  check("TOC clocks count from event time", breachedArrival.every((c) => c.countedFrom === "event" && c.startAt !== null));
  const audit = report.rankAudit.filter((r) => r.workbookRank === r.computedRank).length;
  console.log(`      Computed rank matches the workbook's reference for ${audit} of ${report.rankAudit.length} members.`);
}

/* ---- 6. As-of and schema handling ---- */
section("As-of time and uploads");
{
  check("As-of comes from the workbook", dataset.asOf === "2026-11-09T08:00" && /README/.test(dataset.asOfSource), dataset.asOfSource);
  const noReadme = readWorkbookBytes(bytes);
  noReadme.SheetNames = noReadme.SheetNames.filter((n) => n !== "README");
  delete noReadme.Sheets["README"];
  const fallback = runPipeline(noReadme).dataset;
  check("Without an as-of cell, it falls back to Monday 08:00 after the latest event", fallback.asOf === "2026-11-09T08:00" && /Derived/.test(fallback.asOfSource), fallback.asOfSource);

  const wrong = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wrong, XLSX.utils.aoa_to_sheet([["Panel", "Slot"], [1, 2]]), "Sheet1");
  let errors = 0;
  let crashed = false;
  try {
    runPipeline(wrong);
  } catch (error) {
    if (error instanceof SchemaError) errors = error.errors.length;
    else crashed = true;
  }
  check("A wrong workbook gives validation errors, not a crash", errors > 0 && !crashed, `${errors} errors`);
}

/* ---- 7. Demo fixtures ---- */
section("Demo fixtures");
{
  const dir = path.join(root, "data", "demo");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const fixtures = files.map((f) => ({ file: f, fixture: JSON.parse(readFileSync(path.join(dir, f), "utf8")) as DemoFixture }));
  check("One fixture per member", dataset.members.every((m) => fixtures.some((x) => x.fixture.memberId === m.id)) && fixtures.every((x) => x.file === `${x.fixture.memberId}.json`), `${files.length} files`);
  check('Every fixture is labelled "Illustrative AI output"', fixtures.every((x) => x.fixture.label === "Illustrative AI output"));
  check("Every fixture has at least one low-confidence item", fixtures.every((x) => x.fixture.facts.some((f) => f.confidence < 0.6)));
  check("Every fact points at a real transcript line", fixtures.every((x) => x.fixture.facts.every((f) => f.evidenceLine >= 0 && f.evidenceLine < x.fixture.transcript.length)));
  check("Every fixture has a barrier that proposes a task", fixtures.every((x) => x.fixture.facts.some((f) => f.barrier)));
  check("Fixtures are attached to the generated output", Object.keys(dataset.demo).length === files.length);
}

/* ---- 8. No hard-coded patient values in the code ---- */
section("No patient values in the code");
{
  const wb = readWorkbookBytes(bytes);
  const rows = (prefix: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames.find((n) => n.startsWith(prefix))!], { defval: null });
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const exact = new Set<string>();
  const words = new Set<string>();
  const NOT_A_NAME = new Set(["Dr", "Member", "Mother", "Son", "Daughter", "Grandmother", "Spouse", "Employer", "School", "Household", "Unassigned", "None", "Old", "Pharmacy", "Closed", "Sleep", "Center", "Memphis", "Eastwood", "Elementary", "Harold's", "Unknown", "Primary", "Care", "Medicine", "Family"]);

  // Member IDs, including household IDs that appear only in text.
  for (const sheet of wb.SheetNames) {
    for (const row of XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: null })) {
      for (const value of row) for (const id of text(value).match(/\b[A-Z]{1,2}-\d{5}\b/g) ?? []) exact.add(id);
    }
  }
  const addNameWords = (value: string) => {
    for (const word of value.replace(/\(.*?\)/g, " ").split(/[\s,./-]+/)) if (/^[A-Z][a-z]{2,}$/.test(word) && !NOT_A_NAME.has(word)) words.add(word);
    for (const word of value.replace(/\(.*?\)/g, " ").split(/[\s,./-]+/)) if (/^[A-Z]{4,}$/.test(word)) words.add(word);
  };
  for (const r of rows("Patient_Index")) addNameWords(text(r["Name (fictional)"]));
  for (const r of rows("01_")) {
    addNameWords(text(r["Name_As_Recorded"]));
    addNameWords(text(r["Attributed_PCP"]).split(",")[0]);
    const address = text(r["Address_On_File"]).split(",")[0];
    if (address) exact.add(address);
    if (r["PCP_NPI"]) exact.add(text(r["PCP_NPI"]));
  }
  for (const r of rows("18_")) {
    const name = text(r["Name"]);
    if (/^(Dr\.|[A-Z][a-z]+ [A-Z])/.test(name) && !/^(Sleep|Tully|Eastwood)/.test(name)) addNameWords(name);
    if (r["NPI"]) exact.add(text(r["NPI"]));
  }
  for (const r of rows("02_")) {
    const value = text(r["Value"]);
    const phone = normalisePhone(value);
    if (phone) exact.add(phone.display.split(" ")[0]);
    if (/@/.test(value)) exact.add(value);
    if (/^Address/i.test(text(r["Record_Type"]))) exact.add(value.split(",")[0]);
  }
  const idColumns: [string, string][] = [["03_", "Alert_ID"], ["04_", "Claim_ID"], ["05_", "Rx_ID"], ["06_", "Doc_ID"], ["08_", "Auth_ID"], ["12_", "Attempt_ID"], ["13_", "Case_ID"], ["14_", "Appt_ID"], ["15_", "Interaction_ID"]];
  for (const [prefix, column] of idColumns) {
    for (const r of rows(prefix)) {
      const value = text(r[column]);
      if (value && !value.startsWith("(") && /\d/.test(value)) exact.add(value);
    }
  }
  for (const r of rows("05_")) if (r["NDC"]) for (const ndc of text(r["NDC"]).split(";")) exact.add(ndc.trim());
  for (const r of rows("07_")) if (r["LOINC"]) exact.add(text(r["LOINC"]));

  // Dates and ICD codes that appear anywhere in the dataset sheets.
  const dates = new Set<string>();
  const icd = new Set<string>();
  const datasetSheets = readWorkbookBytes(bytes);
  datasetSheets.SheetNames.filter((n) => /^\d{2}_/.test(n)).forEach((name) => {
    const ws = datasetSheets.Sheets[name];
    for (const row of XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null })) {
      for (const value of row) {
        for (const d of text(value).match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? []) dates.add(d);
        for (const c of text(value).match(/\b[A-TV-Z]\d{2}\.[0-9A-Z]{1,4}\b/g) ?? []) icd.add(c);
      }
    }
  });
  // Clinical values: result + unit, and blood pressures.
  const clinical = new Set<string>();
  for (const r of rows("07_")) if (typeof r["Value"] === "number" && r["Unit"]) clinical.add(`${r["Value"]} ${r["Unit"]}`);
  for (const r of rows("17_")) if (/^\d+\/\d+$/.test(text(r["Value"]))) clinical.add(text(r["Value"]));

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scan = (files: string[], tokens: Set<string>, boundary: boolean) => {
    const hits: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const token of tokens) {
        const pattern = boundary ? new RegExp(`(?<![A-Za-z0-9])${escape(token)}(?![A-Za-z0-9])`) : new RegExp(escape(token));
        if (pattern.test(content)) hits.push(`${path.relative(root, file)}: ${token}`);
      }
    }
    return hits;
  };
  const srcFiles = walk(path.join(root, "src"));
  const libFiles = walk(path.join(root, "lib"));
  const drugWords = new Set(DRUGS.flatMap((d) => [d.key, d.label]));

  const report2 = (name: string, hits: string[]) => check(name, hits.length === 0, hits.length ? hits.slice(0, 8).join("; ") : "");
  console.log(`      Scanning for ${exact.size} identifiers, ${words.size} name words, ${dates.size} dates, ${icd.size} codes, ${clinical.size} clinical values, ${drugWords.size} drug names.`);
  report2("src/: no member IDs, record IDs, phones, emails, addresses, NPIs, NDCs or LOINCs", scan(srcFiles, exact, true));
  report2("src/: no patient or provider names", scan(srcFiles, words, true));
  report2("src/: no workbook dates", scan(srcFiles, dates, true));
  report2("src/: no diagnosis codes", scan(srcFiles, icd, true));
  report2("src/: no clinical values", scan(srcFiles, clinical, true));
  report2("src/: no drug names", scan(srcFiles, drugWords, true));
  report2("lib/: no member IDs, record IDs, phones, emails, addresses, NPIs, NDCs or LOINCs", scan(libFiles, exact, true));
  report2("lib/: no patient or provider names", scan(libFiles, words, true));
  report2("lib/: no workbook dates", scan(libFiles, dates, true));
  report2("lib/: no specific diagnosis codes", scan(libFiles, icd, true));
  console.log("      lib/pipeline/dictionaries.ts and rule files may name drugs: that is vocabulary, not patient data.");
}

/* ---- 9. Code rules from the brief ---- */
section("Code rules");
{
  const code = [...walk(path.join(root, "src")), ...walk(path.join(root, "lib"))];
  const search = (pattern: RegExp, files = code) => files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
  const clock = search(/Date\.now\(|new Date\(\s*\)|performance\.now/);
  check("The real clock is never read", clock.length === 0, clock.join(", "));
  const routes = walk(path.join(root, "src", "app", "api"));
  check("API routes use the Node runtime", routes.every((f) => /export const runtime = "nodejs"/.test(readFileSync(f, "utf8"))), `${routes.length} routes`);
  const writes = search(/writeFile|appendFile|createWriteStream|mkdirSync/, code);
  check("Nothing writes to disk at runtime", writes.length === 0, writes.join(", "));
  const amberText = search(/text-amber/, walk(path.join(root, "src")));
  check("Amber is never used as text colour", amberText.length === 0, amberText.join(", "));
  const external = search(/https?:\/\/(?!www\.w3\.org)/, code);
  check("No external API calls in app code", external.length === 0, external.join(", "));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  check("predev and prebuild generate the output", /generate/.test(pkg.scripts.predev) && /generate/.test(pkg.scripts.prebuild));
  const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  check("data/processed.json is not ignored by git", !/^data\/processed\.json$/m.test(gitignore) && existsSync(path.join(root, "data", "processed.json")));
}

/* ---- 10. Live app, when it is running ---- */
void (async () => {
  section(`Live app at ${BASE}`);
  let up = false;
  try {
    up = (await fetch(`${BASE}/api/queue`, { signal: AbortSignal.timeout(20000) })).ok;
  } catch {
    up = false;
  }
  if (!up) {
    skip("Live checks", "server not reachable: run npm run dev, then run this again");
  } else {
    const html = await (await fetch(`${BASE}/pipeline`)).text();
    const total = /data-flag-total="(\d+)"/.exec(html)?.[1];
    check("/pipeline shows the same flag total", Number(total) === report.flagTotal, `${total}`);
    const shownTypes = [...html.matchAll(/data-flag-type="([a-z_]+)"[^>]*>(\d+)</g)];
    const typeMismatch = shownTypes.filter(([, type, count]) => report.flagsByType.find((t) => t.type === type)?.count !== Number(count));
    check("/pipeline flag counts match by type", shownTypes.length > 0 && typeMismatch.length === 0, `${shownTypes.length} types`);
    const missingIds = report.plantedCoverage.filter((p) => !html.includes(`>${p.id}<`));
    check("Every planted imperfection is visible on /pipeline", missingIds.length === 0, missingIds.map((p) => p.id).join(", "));
    const live = (await (await fetch(`${BASE}/api/report`)).json()) as RunReport & { flags: unknown[] };
    check("/api/report matches the generated report", live.flagTotal === report.flagTotal && live.flags.length === dataset.flags.length);
    const queue = (await (await fetch(`${BASE}/api/queue`)).json()) as { queue: { id: string }[] };
    check("/api/queue matches the generated order", queue.queue.map((q) => q.id).join() === dataset.queue.map((q) => q.id).join());
    const results = await Promise.all(dataset.members.map(async (m) => [(await fetch(`${BASE}/member/${m.id}`)).status, (await fetch(`${BASE}/api/members/${m.id}`)).status]));
    check("Every member page and API record loads", results.every(([a, b]) => a === 200 && b === 200), `${results.length} members`);
    check("Unknown member returns 404 from the API", (await fetch(`${BASE}/api/members/NOBODY`)).status === 404);

    const post = async (name: string, content: BlobPart) => {
      const body = new FormData();
      body.append("file", new File([content], name));
      const response = await fetch(`${BASE}/api/process`, { method: "POST", body });
      return { status: response.status, json: (await response.json()) as { ok: boolean; errors?: unknown[]; dataset?: Dataset } };
    };
    const garbage = await post("not-really.xlsx", "this is not a workbook");
    check("POST /api/process: unreadable file returns errors", !garbage.json.ok && (garbage.json.errors?.length ?? 0) > 0, `HTTP ${garbage.status}`);
    const text = await post("notes.txt", "hello");
    check("POST /api/process: wrong type is refused", text.status === 415 && !text.json.ok, `HTTP ${text.status}`);
    const huge = await post("huge.xlsx", new Uint8Array(4 * 1024 * 1024 + 1024));
    check("POST /api/process: over 4 MB is refused", huge.status === 413 && !huge.json.ok, `HTTP ${huge.status}`);
    const mismatch = XLSX.write(
      (() => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Panel"], [1]]), "Sheet1");
        return book;
      })(),
      { type: "buffer", bookType: "xlsx" },
    ) as Buffer;
    const wrong = await post("wrong-schema.xlsx", new Uint8Array(mismatch));
    check("POST /api/process: schema mismatch returns validation errors", wrong.status === 422 && !wrong.json.ok && (wrong.json.errors?.length ?? 0) === 18, `HTTP ${wrong.status}, ${wrong.json.errors?.length} errors`);
    const good = await post(path.basename(WORKBOOK), new Uint8Array(bytes));
    check("POST /api/process: the real workbook returns a matching dataset", good.status === 200 && good.json.ok && good.json.dataset?.queue.map((q) => q.id).join() === dataset.queue.map((q) => q.id).join(), `HTTP ${good.status}`);
    const stillFine = await fetch(`${BASE}/api/queue`);
    check("The server is still healthy after bad uploads", stillFine.ok);
  }

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}${skipped ? `, ${skipped} skipped` : ""}.`);
  process.exit(failures === 0 ? 0 : 1);
})();

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|css|mjs|js)$/.test(name) ? [full] : [];
  });
}
