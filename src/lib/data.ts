import processed from "../../data/processed.json";
import type { Dataset, RunReport } from "@lib/pipeline/types";

/** The generated pipeline output. All pages and API routes read this one file. */
const data = processed as unknown as { dataset: Dataset; report: RunReport };

export const dataset = data.dataset;
export const report = data.report;
export const demoFixtures = data.dataset.demo;
