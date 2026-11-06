# HiLabs Prism

A working prototype of a case-management workbench for health-plan nurses, driven by a real data pipeline over one Excel workbook. It is a demo for a campus-hiring product case, not production software. All patient data is fictional.

The stack is one Next.js app (App Router, TypeScript), Tailwind, lucide-react, SheetJS and Motion (springs). There is no Python, database, external API or secret.

## Run it locally

You need Node 20.9 or later.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. `npm run dev` binds to `0.0.0.0:3000`, so other machines can reach it by IP. Before starting, it regenerates `data/processed.json` from the workbook.

To reach the dev server through a named host rather than an IP, list that host first, or Next.js blocks its scripts and the page will not respond to clicks:

```bash
PRISM_DEV_ORIGINS=my-box.local npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Generate the data, then start the dev server on `0.0.0.0:3000` |
| `npm run build` | Generate the data, then build for production |
| `npm start` | Serve the production build on `0.0.0.0:3000` |
| `npm run lint` | Run ESLint |
| `npm run verify` | Check the acceptance criteria (see below) |

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New Project** and import the repository.
3. Keep the **Next.js** preset. No environment variables are needed.
4. Deploy.

Before you push, check that `Interview_Slots_*.xlsx` is not committed if that file is still in the folder. It holds real people's contact details and has nothing to do with this app, so `.gitignore` and `.vercelignore` exclude it.

The workbook and `data/processed.json` are both committed. The build regenerates the JSON from the workbook, and at runtime the app reads only the JSON. Route handlers use the Node runtime and write nothing to disk.

## The pages

| Page | What it is for |
|---|---|
| `/` | The queue: who, why today, and what to do, with a member focus panel ("Why This Priority", snapshot, history), snooze, the My Day strip and a simulated alert |
| `/member/[id]` | Member Insight Hub: why this member needs attention, clocks, what changed, reachability, journey chronology, medication reconciliation, conditions, risk, SDOH and the care plan. |
| `/member/[id]/engage` | Care Engagement Hub: patient context, transcript replay and assessment protocol, then review and confirm. |
| `/pipeline` | The run report: every stage with counts, every quality flag with its evidence, the planted-imperfection audit and the scoring table |

| API | What it returns |
|---|---|
| `GET /api/queue` | The ranked queue |
| `GET /api/members/[id]` | One member, with flags and demo content |
| `GET /api/report` | The run report and all flags |
| `POST /api/process` | Runs the pipeline in memory on an uploaded `.xlsx` up to 4 MB, as form field `file`. Returns the dataset, or JSON validation errors on a schema mismatch |

## Design

The interface follows the HiLabs UI Design Package, inside the brief's colour and type rules. `docs/contract-gaps.md` lists where the data or the brief overrides a design.

- **Surfaces:** flat white planes on a pale canvas with 1px borders and 4 to 6px corners. Only overlays carry a shadow.
- **Layout:** a white icon sidebar and a top bar with member search. Below 1280px the member focus panel becomes a drawer, and the Care Engagement Hub stacks its columns.
- **Type:** Inter, 14px body and 13px captions, with key figures at 16px. Sizes are in `rem`, so the browser's text size setting is honoured.
- **Your settings:** `prefers-reduced-motion` and `prefers-contrast` are respected.

## How the pipeline works

`runPipeline(workbook)` in `lib/pipeline/index.ts` returns a Dataset and a RunReport. It is pure: it reads no clock, disk or network.

1. **Ingest** (`ingest.ts`): reads every sheet, detects member ID and date columns, and records sheets, columns and row counts.
2. **Standardise** (`standardise.ts`): ISO dates, trimmed text, normalised IDs and phone numbers, with event time kept apart from arrival time. Code labels come only from the workbook.
3. **Quality flags** (`quality.ts`): every flag has a member, evidence (sheet and row) and a severity.
4. **Derive** (`derive/`): cross-source signals, clocks counted from event time, reachability, what changed, the medication comparison, the priority score and next actions.
5. **Output**: `data/processed.json` and the RunReport.

More detail: [`docs/data-map.md`](docs/data-map.md) covers the workbook, [`docs/scoring.md`](docs/scoring.md) covers how each score driver is derived, and [`docs/contract-gaps.md`](docs/contract-gaps.md) lists where the frontend brief and the API differ. All weights and thresholds are in `lib/config/scoring.ts`.

## Checks

`npm run verify` tests the acceptance criteria against the real workbook and exits non-zero on failure. Start the app first to include the live checks; without it they are reported as skipped.

- Row counts match an independent read of the workbook, and flag counts match `/pipeline`.
- No patient names, IDs, dates or clinical values appear in `src/`, or in `lib/` apart from the drug vocabulary that rules need.
- Each score equals the sum of its driver points, and changing a weight changes the order.
- Both guardrails hold, and all 40 planted imperfections are flagged and visible.
- Bad uploads return errors rather than crashing.

## What is simulated

- **As-of time:** the workbook's Monday 08:00 is "now". Countdown clocks start there and advance with elapsed browser time, one minute at a time. Real dates are never read.
- **My Day capacity:** 48 items, an assumption from the brief, labelled in the UI. Workload is the queue's open commitments plus this session's callbacks and snoozes.
- **Routine refresh:** every 30 minutes, an assumption labelled in the UI. Nothing re-orders until the nurse clicks refresh.
- **Demo call content:** the transcripts and extracted facts in `data/demo/` are authored and labelled "Illustrative AI output (demo fixture)". There is no real AI and no real call.
- **Calls and SMS:** nothing is placed or sent. Each one logs an attempt to client state.
- **The urgent alert:** it replays a real discharge row from the workbook as if it had just arrived.
- **State:** snoozes, callbacks, confirmations, edits, the ledger and accepted tasks live in memory only. Nothing persists: a reload or "Reset demo" returns to the start.
