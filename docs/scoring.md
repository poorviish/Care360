# Scoring

How a member's priority is computed. Every number here lives in `lib/config/scoring.ts`, so changing a weight there changes the score and can change the order. The code is `lib/pipeline/derive/scoring.ts`.

## The score

`score = Deadline + Clinical risk + New signal + Open commitments + Contactable now`

Each driver is a fraction from 0 to 1 multiplied by its weight, then rounded to a whole number. The score is the sum of those rounded points, so it always equals the points shown beside it.

| Driver | Weight | Question it answers |
|---|---:|---|
| Deadline | 35 | How close is the most pressing clock? |
| Clinical risk | 30 | How sick is this person likely to get, and how soon? |
| New signal | 20 | Did something important just arrive? |
| Open commitments | 10 | What has the plan promised and not done? |
| Contactable now | 5 | Could the nurse actually reach them at the as-of time? |

## How each driver is derived

### Deadline (35)

The maximum, across the member's clocks, of `urgency x class weight`.

**Urgency**, from the hours left at the as-of time:

| Hours left | Urgency |
|---|---:|
| Breached, or up to 24 | 1.0 |
| Up to 48 | 0.8 |
| Up to 72 | 0.6 |
| Up to 168 (7 days) | 0.4 |
| Up to 720 (30 days) | 0.2 |
| More | 0.1 |

**Class weight** says how much that kind of clock matters today:

| Clock class | Weight | Where it comes from |
|---|---:|---|
| Safety | 1.0 | Same-hour triage of a red-flag call; same-day reconciliation when two anticoagulants are in supply |
| TOC contact | 1.0 | 2 business days from the discharge event |
| TOC visit | 0.7 | 7 calendar days from the discharge event |
| Task | 0.5 | Open items with a due date in `13_Care_Plan_Tasks` |
| Appointment | 0.4 | Scheduled visits in the next 30 days |
| TOC window, quality measure | 0.3 | 30-day window; measure due dates in `10_Quality_Care_Gaps` |
| Admin | 0.2 | Coverage renewal; consent expiry |

A date with no time is treated as due at the end of that day.

### Clinical risk (30)

`min(1, base + uplift)`.

- **Base** is the maximum across the member's rows in `09_Risk_Stratification` of `tier value x horizon factor`.
- **Tier value:** Very high 1.0; High or Tier 1 0.8; Flag 0.6; Moderate or Tier 2 0.5; Low 0.2; otherwise 0.3.
- **Horizon factor:** 0.75 for a 12-month model, otherwise 1. A risk over a year is less urgent today than the same tier over 30 days.
- **Uplift:** +0.2 if a severe clinical signal exists, else +0.1 if a high one does. Models cannot see what only joined data shows, such as two anticoagulants or a fever call.

Raw model scores are not compared, because a 30-day readmission probability and a 12-month progression probability are not on one scale.

### New signal (20)

The maximum, across what changed since the last successful contact, of `freshness x severity`.

| Arrived within | Freshness |
|---|---:|
| 24 hours | 1.0 |
| 72 hours | 0.8 |
| 7 days | 0.5 |
| 14 days | 0.25 |
| Older | 0 |

Severity: severe 1.0, high 0.7, medium 0.4, low 0.2. This uses **arrival** time, because the question is what is new to the nurse. A date with no time counts as arriving at the end of that day, so urgency is never understated.

**What changed** starts from the last successful contact, meaning an outreach outcome of exactly "Connected" or a two-way reply. Connecting to a relative with no release does not count. With no successful contact, it starts from the open case's start date.

### Open commitments (10)

`min(1, (overdue x 2 + open x 1) / 10)`.

Counted: open tasks and referrals; pended authorisations (overdue past 48 hours); pending county or vendor applications; unconfirmed deliveries; required visits not scheduled; no-shows not rebooked; open grievances; referrals pending acceptance (overdue past 7 days); benefits asked for and not activated; prescriptions with no fill found. Items that restate each other are skipped, so a visit task and an unscheduled visit count once.

### Contactable now (5)

The sum of the parts that hold at the as-of time, for the highest-ranked working contact:

| Part | Fraction |
|---|---:|
| Working number | 0.4 |
| Consent in order (on file, implied guardian, or the member's own number) | 0.2 |
| Inside the best-time window (for SMS: outside stated sleep and work times) | 0.4 |

## Rank and guardrails

Members sort by:

1. **Top tier first.**
2. **Rank basis:** the score without Contactable now.
3. **Contactable now**, which only breaks an exact tie.
4. Member ID, so the order is always deterministic.

### Guardrails from the brief

- **A TOC contact clock in its final 24 hours or breached goes to the top tier.** `npm run verify` checks this.
- **Reachability never lowers a rank.** Rank is computed without Contactable now. A consequence is that total scores can look out of order when two members are within 5 points. The "Why this rank" view and `/pipeline` show the rank basis beside the score. `npm run verify` proves it by re-ranking with that weight set to 0 and to 50.

### Added beyond the brief

**A red-flag symptom call, or two anticoagulants in supply, also goes to the top tier.** The brief's TOC rule alone would rank a possible neutropenic fever below an ED follow-up that lapsed six days ago, because that member has no discharge in the TOC window. The workbook's planted item I5.7 requires red-flag calls to go to the top of the queue, and item I1.1 treats the anticoagulant conflict as same-day.

To apply only the brief's rule, empty `GUARDRAILS.safetyTopTierSignals` in `lib/config/scoring.ts`. The order then becomes members with a TOC clock in final hours or breached first, then the rest by score.

## Transition-of-care clocks

- **Which discharges count:** HL7 A03 rows to the community, within 30 days of the as-of time. A discharge to a skilled nursing facility does not start a contact clock, because the member is still in a facility. ED and observation discharges do count: the workbook's own task for an ED discharge uses the same 2-business-day window.
- **Contact:** 2 business days (Monday to Friday) from the event, keeping the time of day. A step landing on a weekend moves to Monday.
- **Visit:** 7 calendar days from the event, matching the workbook's due dates.
- **Window:** 30 calendar days from the event.
- **Counted from event time, never arrival.** The clock also shows what a receipt-based clock would have said, which is planted item I4.8's trap.
- **A successful contact after the event stops the clock.** Earlier discharges in the window are shown as history and do not count twice.

## Contact ranking

Each number gets a 0 to 100 confidence score, from `lib/pipeline/derive/reachability.ts`. A dead or do-not-call number scores 0.

| Factor | Points |
|---|---:|
| Status active | +40 (+25 if it rings but goes unanswered) |
| Member's own number | +20 |
| Other person: consent on file or guardian | +25 |
| Other person: release held outside the plan | +15 |
| Other person: no release, or expired | +5 |
| Verified within 30 days | +20 |
| Verified within 180 days | +10 |
| Each failed attempt in the last 30 days | -10 (down to -30) |
| Two-way contact in the last 90 days | +10 |

## Worked result at the workbook's as-of time

The current figures are on `/pipeline` under Scoring, computed from the run rather than copied here. Computed ranks match the workbook's `Monday_8am` sheet for all five members. That sheet is never an input, only a comparison.
