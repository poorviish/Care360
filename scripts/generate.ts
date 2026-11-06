/**
 * Runs the pipeline over the workbook and writes data/processed.json. Runs on predev and prebuild.
 * The demo fixtures in data/demo are attached here so app code never has to name a member.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readWorkbookBytes } from "../lib/pipeline/ingest";
import { runPipeline } from "../lib/pipeline";
import type { DemoFixture } from "../lib/pipeline/types";

const root = path.resolve(__dirname, "..");
const WORKBOOK = "PartC_Synthetic_Patients_Annex (1).xlsx";
const workbookPath = path.join(root, "data", WORKBOOK);

if (!existsSync(workbookPath)) {
  console.error(`Missing workbook: data/${WORKBOOK}`);
  process.exit(1);
}

const { dataset, report } = runPipeline(readWorkbookBytes(readFileSync(workbookPath)), { workbookName: WORKBOOK });

const demoDir = path.join(root, "data", "demo");
if (existsSync(demoDir)) {
  for (const file of readdirSync(demoDir).filter((f) => f.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(path.join(demoDir, file), "utf8")) as DemoFixture;
    if (dataset.members.some((m) => m.id === fixture.memberId)) dataset.demo[fixture.memberId] = fixture;
  }
}

writeFileSync(path.join(root, "data", "processed.json"), `${JSON.stringify({ dataset, report }, null, 2)}\n`);
console.log(
  `Pipeline: ${report.totals.sheets} sheets, ${report.totals.datasetRows} dataset rows, ${report.totals.members} members, ` +
    `${report.flagTotal} flags, ${report.plantedCoverage.filter((p) => p.covered).length}/${report.plantedCoverage.length} planted covered, ` +
    `${Object.keys(dataset.demo).length} demo fixtures.`,
);
