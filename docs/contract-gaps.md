# Contract gaps

What the frontend brief expects versus what this repo's API provides. `lib/pipeline/` and the API routes were not modified. Each gap below says what the UI does instead.

## The brief's references that do not exist

| The brief says | What is in the repo | What the UI does |
|---|---|---|
| `shared/contract.ts` | No such file. The published types are in `lib/pipeline/types.ts` | Imports types from `lib/pipeline/types.ts`. `shared/contract.ts` was not created |
| `app/api/` | The routes are at `src/app/api/` | Left untouched |
| `GET /api/members/:id/workspace` | No such route. `GET /api/members/:id` returns the transcript and facts as `demo`, and `member.callGuide` and `member.assessmentFields` | The workspace reads `/api/members/:id` |
| `S<T>` | `Sourced`, with a `string`, `number` or `null` value | `<Sourced>` renders this type |
| `illustrative` marker | Fixtures carry `label: "Illustrative AI output"` | Renders the brief's wording, "Illustrative AI output (demo fixture)" |
| `possibleDuplicate` | `member.duplicateBanner` | Shows the brief's banner wording, with the API's detail below it |
| `meds.discrepancies` | `member.medications.rows[].conflict` | Uses rows with a conflict |
| `nextAction` | `row.action` on the queue, `member.actions` on the Member Insight Hub | Uses those |
| `reach.state` ("poor" or "bad") | `callDemoted`, `demotionReason` and a reachability band | Demotes Call when `callDemoted` is true. At the current as-of time that is every member, because each on-file number has a problem |
| `reach.alternatives` | `row.alternatives`: phone and email contacts only | Shows those ranked. **"Message PCP" is not in the data**, so it is not offered |
| `guardrail` note | `topTierReasons` | Shown on the row and in "Why This Priority" |

## Fields the brief needs that the API does not provide

| Need | Why there is a gap | What the UI does |
|---|---|---|
| `trigger.type` | The trigger is free text | `src/lib/trigger.ts` classifies it from general healthcare vocabulary. Unmatched text gets a neutral "Trigger" chip. **No current member classifies as "program"** |
| Trigger event and received times on the queue | Not on `QueueRow` | Fetches `/api/members/:id` per row and uses, in order: the event behind the first event-based clock, the case-opening risk model (data date and score date), then the newest change. Shows "Not in source data" if none applies. The "late" chip uses the pipeline's own feed-latency threshold |
| `myDay` workload | No such field. `lib/config/scoring.ts` has a minutes-based `MY_DAY` (150 min) the API does not return | Base workload is the count of `row.commitments` across the queue. The meter adds client-side callbacks and snoozed rows, against the brief's capacity of 48, labelled as an assumption |
| Simulated alert | `dataset.simulatedAlert` is in `processed.json`, but `/api/queue` does not return it | `src/app/page.tsx` is a server component and passes only this field as a prop. It is **the one value on the three brief pages that does not arrive by `fetch`**. It works on Vercel. Returning it from `/api/queue` would remove this exception |
| Routine refresh interval | Not in the brief or API | 30 minutes, in `src/lib/constants.ts`, labelled as an assumption in the UI |
| Profile completeness | No such field | Derived on the Member Insight Hub: the share of core profile fields with a value and no conflict, stale or unverified flag. Hover lists each field. Labelled as derived |
| Current user | The API has no signed-in user | The default task owner is the member's assigned case manager |
| Current pain and mobility assessment fields | `assessmentFields` has `symptoms`, `falls`, `living` and others, but no `pain` or `mobility` | Shows the API's volatile fields under the API's labels. Pain and mobility do not appear as separate fields |
| Call guide suggestion chips | Only `member.callGuide` exists | `callGuide` is the ticked checklist. The chips come from `member.actions`, which the pipeline derives from the trigger and clocks |
| "Received" clock basis | The pipeline counts TOC clocks from the event, by design. `countedFrom` is `event`, `due date` or `as-of` | Shows the actual basis. A receipt-based due time appears in the clock's hover where the API gives `arrivalDueAt` |
| Separate list of open alerts | No such list | Open alerts are `member.signals` above low severity. The briefing strip names the top signals, and the block gives each one's detail |

## Clock semantics

- **Business-day terms.** `hoursLeft` is calendar hours. The UI removes Saturdays and Sundays for TOC contact, task and measure clocks. Holidays are not in the data, so they are not excluded.
- **Calendar clocks.** TOC visit, TOC window, appointment and admin clocks stay in calendar days, because the pipeline defines them that way. Safety clocks also run in real time, because a same-hour triage does not pause for a weekend. Each clock states its basis.
- **Crimson** follows the actual hours left (under 24, or breached), so a business-day display cannot hide an urgent clock.

## Known conflict: `npm run verify`

`npm run verify` has one failing check by design of the brief: "The real clock is never read" flags `src/lib/clock.ts`. The brief requires clocks to advance with elapsed browser time, which needs a timer. `clock.ts` uses the monotonic `performance.now()` to measure elapsed minutes and adds them to the API's `asOf`, so the real date is still never read. The check has not been changed. To accept this, exempt `src/lib/clock.ts` from that check in `scripts/verify.ts`.

## The HiLabs UI Design Package versus this data

The UI follows `HiLabs_UI_Design_Package` (Care Priority Hub, Member Insight Hub, Care Engagement Hub). The reference images call the third screen "Member Care Hub"; its specification says "Care Engagement Hub", which is the name used here. Where a design element has no data behind it, or the brief rules it out, it was changed or left out rather than faked.

| In the design | What the UI does | Why |
|---|---|---|
| Home navigation, help and settings icons, notification bell, "MC" profile avatar | Not shown. Upload and Reset demo take the sidebar's foot, and the as-of time takes the header's right | No such pages, no alerts feed, and the API has no signed-in user |
| Tasks, Members, Reports navigation | Tasks opens the care plan tab, Members the Member Insight Hub, Reports the data pipeline audit. "Engage" is added so the third screen can be reached | These are the real pages that exist |
| "Follow-ups due" KPI | "Open commitments" | The API gives commitments, not follow-ups due |
| "Waiting on external" KPI and tab | Counts pending authorisations in each member's care plan | The API has no general waiting status. Labelled in the hover |
| "My Day" tab | A clock under 24 hours or breached, or a callback scheduled this session | The API has no assignment to a day |
| "Closed Today" tab | Not shown | Encounter closure is on the brief's DO NOT BUILD list |
| "Member Snapshot" tab beside the queue | "Snapshot" | The shorter label keeps all four tabs visible at 1440px |
| Pagination, sample ranks and counts | Not shown | The workbook has five members |
| Red priority scores, red "High" risk chips, pink high-risk fact cards | Scores are lavender. High-risk facts use amber with an icon and the words "High risk" | The brief keeps crimson for SLA breached or under 24 hours and for severe clinical conflicts |
| Active call banner, live timer, mute, hold, End Call | "Call replay", the replayed line's timestamp, and Pause, Next line and Show all | No call is placed, so presenting one as live would be false |
| Live Transcript, Transcribing live, Play audio snippet | "Transcript Replay" and "Show line", which scrolls to the source line | There is no audio and no speech recognition |
| Draft Clinical Note (AI) tab | "Typed Notes" | The AI drafting layer is on the brief's DO NOT BUILD list |
| Facts ticked by default | Unticked until the nurse confirms each one. Low-confidence facts cannot be ticked | The specification says high-risk facts must not be silently accepted |
| High, Medium and Low risk on each fact | High risk, Barrier and Low confidence filters, with the confidence shown on each card | The API gives `highRisk`, `barrier` and `confidence`, with no medium risk level |
| Protocol selector | Not shown | The API has one call guide per member and no named protocols |
| Acute triage / Safety escalation, Post-call dictation | Not shown | Closed-loop protocols are not built and there is no speech recognition |
| Draft autosaved chip | Not shown | Nothing persists, by the brief's rule |
| "Primary" condition tag | Not shown | The API does not mark a primary condition |
| Documents & Activity tab | "Clocks, Alerts & Data Quality" | The documents drawer is on the brief's DO NOT BUILD list |
| Edit member button | Not shown | The record is read-only here |
| Possible duplicate "1 similar member found" | The number of recorded names | The API gives names on one record, not a count of similar members |
