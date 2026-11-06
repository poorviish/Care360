# Data map: `data/PartC_Synthetic_Patients_Annex (1).xlsx`

Phase 0 inspection of the only data source. The workbook holds five fully fictional patients across 18 datasets.

- **As-of timestamp:** `README!B3` = 2026-11-09 08:00 (a Monday). The pipeline uses this instead of the real clock.
- **Totals:** 24 sheets; 18 dataset sheets with 363 data rows, of which 211 carry a `Quality_Flag` (exactly the light-red rows).
- **Primary join key:** `Patient_ID` (column A of every dataset sheet). It is consistent, and no dataset row carries an ID outside the five in `Patient_Index`.

## Sheets

### Reference sheets

| Sheet | Rows | Columns | How the pipeline uses it |
|---|---:|---|---|
| `README` | 9 | label, value | As-of timestamp, plus reading rules |
| `Patient_Index` | 7 | Patient_ID, Name (fictional), Age/Sex, Line_Of_Business, Scenario_Headline, Trigger, Assigned_CM, Acuity, Datasets_Populated (of 18), Planted_Imperfections (count), Queue_Rank_Monday | Name, trigger, CM, acuity. Sheet rows 7 and 8 are a blank line and a footnote, not members. **`Queue_Rank_Monday` is audit-only** |
| `Dataset_Dictionary` | 18 | #, Dataset, Source_System, What_It_Tells_The_CM, Typical_Freshness_Latency, Expected_Quality_Problems, How_The_Product_Handles_It, MVP_Priority, Sheet | Human-readable source labels |
| `Planted_Imperfections` | 40 | Patient_ID, Imp_ID, Dataset(s), Imperfection, Realistic_Because, What_The_Product_Must_Do, Design_Feature_Stressed | **Audit-only**: checks detector coverage, never feeds detection |
| `Monday_8am` | 5 | Patient_ID, Patient, Queue_Rank, Why_This_Rank, What_The_CM_Should_SEE, What_The_CM_Should_DO, AI_Detected…, Clocks_Running | **Audit-only**: computed rank is compared with it on `/pipeline` |
| `Coverage_Matrix` | 15 | Dimension, one column per patient | Not read by the derivations; ingested and counted |

### Dataset sheets

| # | Sheet | Rows | Columns | Event time | Arrival time |
|---|---|---:|---|---|---|
| 01 | `01_Member_Eligibility` | 7 | Patient_ID, Name_As_Recorded, DOB_As_Recorded, Sex, Line_Of_Business, Plan_Product, Group_Or_Aid_Code, Elig_Start, Elig_End, Elig_Status, Attributed_PCP, PCP_NPI, Language_On_File, Address_On_File, ZIP, County_Setting, Household_Link, Source_File, Received_Date, Quality_Flag, Note | Elig_Start | Received_Date |
| 02 | `02_Contact_Consent` | 18 | Patient_ID, Record_Type, Value, Owner_Of_Contact, Label_In_System, Source, Last_Verified, Status, Preferred_Channel, Best_Time, Language_Interpreter, Consent_Type, Consent_Status, Consent_Expiry, Quality_Flag, Note | Last_Verified | n/a |
| 03 | `03_ADT_Alerts` | 24 | Patient_ID, Alert_ID, HL7_Event, Event_Type, Facility, Event_DateTime, Received_DateTime, Latency_Hours, Diagnosis_In_Alert, Discharge_Disposition, Feed_Source, Match_Confidence, Quality_Flag, Note | Event_DateTime | Received_DateTime |
| 04 | `04_Medical_Claims` | 29 | Patient_ID, Claim_ID, Claim_Type, Service_Date, Service_Date_To, Provider_Or_Facility, Place_Of_Service, Primary_Dx_ICD10, Secondary_Dx, Procedure_CPT_DRG, Billed_USD, Paid_USD, Adjudication_Status, Received_Date, Lag_Days, Quality_Flag, Note | Service_Date(_To) | Received_Date |
| 05 | `05_Pharmacy_Fills` | 33 | Patient_ID, Rx_ID, Fill_Date, Drug, NDC, Strength_Sig, Qty, Days_Supply, Expected_Runout, Days_Past_Runout, Prescriber, Pharmacy, Copay_USD, Source, Received_Date, Quality_Flag, Note | Fill_Date | Received_Date |
| 06 | `06_Clinical_Records_HIE` | 17 | Patient_ID, Doc_ID, Doc_Type, Source_Organisation, Doc_Date, Received_Date, Structured_Or_Free_Text, Problems, Medications_Listed, Allergies, Key_Content, Match_Confidence, Quality_Flag, Note | Doc_Date | Received_Date |
| 07 | `07_Lab_Results` | 26 | Patient_ID, Result_Date, Received_Date, Test, LOINC, Value, Unit, Ref_Range, Flag, Prior_Value_Date, Prior_Value, Source, Quality_Flag, Note | Result_Date | Received_Date |
| 08 | `08_Prior_Auth_UM` | 18 | Patient_ID, Auth_ID, Request_Date, Service_Requested, Requesting_Provider, Status, Decision_Date, Units_Approved, Valid_From, Valid_To, Pend_Or_Denial_Reason, Owner_Queue, Days_In_Queue, Quality_Flag, Note | Request_Date | Decision_Date |
| 09 | `09_Risk_Stratification` | 9 | Patient_ID, Model, Score_Date, Score, Tier, Prior_Score, Prior_Score_Date, Top_Reason_Codes, Data_As_Of, Trigger_For_Case, Quality_Flag, Note | Data_As_Of | Score_Date |
| 10 | `10_Quality_Care_Gaps` | 27 | Patient_ID, Measure_Code, Measure_Name, Measurement_Year, Status, Due_Date, Gap_Detail, Last_Refresh, Quality_Flag, Note | Due_Date | Last_Refresh |
| 11 | `11_Assessments` | 21 | Patient_ID, Assessment, Date, Administered_By, Respondent, Completion_Pct, Key_Responses, Score, Source_System, Staleness_Days, Quality_Flag, Note | Date | n/a |
| 12 | `12_Outreach_History` | 28 | Patient_ID, Attempt_ID, DateTime, Channel, Number_Or_Address_Used, Owner_Of_Number, Interpreter_Used, Outcome, Duration_Min, By, Program, Disposition_Note, Quality_Flag, Note | DateTime | n/a |
| 13 | `13_Care_Plan_Tasks` | 17 | Patient_ID, Case_ID, Case_Status, Program, Open_Date, Close_Date, Close_Reason, Assigned_CM, Acuity, Item_Type, Goal_Barrier_Or_Task, Due_Date, Item_Status, Quality_Flag, Note | Open_Date | n/a |
| 14 | `14_Appointments` | 17 | Patient_ID, Appt_ID, Appt_DateTime, Provider_Facility, Type, Distance_Miles, Status, Source, Received_Date, Quality_Flag, Note | Appt_DateTime | Received_Date |
| 15 | `15_Member_Services` | 8 | Patient_ID, Interaction_ID, DateTime, Channel, Caller, Language_Interpreter, Reason_Category, Summary, Resolution, Routed_To_CM, Grievance_ID, Received_By_CM_System, Quality_Flag, Note | DateTime | Received_By_CM_System |
| 16 | `16_Supplemental_Vendors` | 27 | Patient_ID, Benefit_Or_Service, Vendor_Or_Agency, Eligibility, Status, Request_Date, Service_Date, Detail, Used_YTD, Remaining, Quality_Flag, Note | Service_Date | Request_Date |
| 17 | `17_RPM_Vitals` | 10 | Patient_ID, Source, Reading_Date, Metric, Value, Unit, Threshold, Flag, Received_Date, Quality_Flag, Note | Reading_Date | Received_Date |
| 18 | `18_Provider_CareTeam` | 27 | Patient_ID, Role, Name, Organisation, NPI, Network_Status, Last_Contact, Source, Quality_Flag, Note | Last_Contact | n/a |

## Join keys

| Key | Where it appears | Notes |
|---|---|---|
| `Patient_ID` | all dataset sheets, `Patient_Index`, `Planted_Imperfections`, `Monday_8am` | Primary key. One ID per patient, by design |
| Phone value | 02 `Value` to 12 `Number_Or_Address_Used` | Normalised to digits before joining; this is how attempts are counted per number |
| Auth ID | 08 `Auth_ID` to 05 `Rx_ID` (PA row) and 16 `Detail` ("See AUTH-…") | Links denials to drugs and pended auths to vendors |
| NPI | 01 `PCP_NPI` to 18 `NPI` | Compares attributed PCP with the care team |
| Facility plus date | 03 to 04 | No shared encounter ID, so an ADT row and a claim are joined on overlapping dates. This is how a claim diagnosis upgrades an ADT diagnosis |
| Case ID | within 13 | Groups tasks under one case |
| Household IDs | 01 `Household_Link` and 18 text only (spouse and sibling IDs) | **These members have no rows.** They exist only as text, so household links can be flagged but not traversed |

## Column conventions that shape the parser

- **True Excel dates** only in 03, 04, 05, 11, 12, 14 and 15. Everywhere else dates are text.
- **Dates with suffixes:** `2026-11-01 (monthly)`, `2026-09-14 (replied to PBM SMS)`, `2026-11-04 (assign within 3 d)`, `2027-01-31 (renewal due)`, `2026-08-14 (last fill)`.
- **Non-dates in date columns:** `open`, `n/a`, `never`, and a bare year `2019`. These stay as raw text with a null ISO value.
- **Placeholder rows** exist to show a gap: `Alert_ID` of `(none)` or `(none - watch)`, `Claim_ID` of `(none)`, `(expected)`, `(suppressed)`, `Doc_ID` of `(blocked)`, `(not sent)`, `(external)`, and `Appt_ID` of `(none)`, `(external)`. They are absences, not events. Of the 24 ADT rows, 19 are real alerts and 5 are placeholders.
- **Combined drug rows:** `Lisinopril / Amlodipine / Metformin ER / Atorvastatin (4 Rx)` and `Albuterol HFA + Prednisolone oral soln` must be split. `Buprenorphine-naloxone` and `Senna-docusate` must not.
- **Formulas** carry cached values (latency, lag, run-out, staleness). The pipeline recomputes them from raw dates so an upload without cached values still works, then warns on any disagreement.
- **Code-to-label pairs** appear inside cells (`S72.001A fracture neck of femur, R`). The pipeline harvests labels only from those cells. A code with no label in the workbook, such as `E11.22`, stays a bare code.

## Planted imperfections: the 40 in the register

| Member | IDs | What is planted |
|---|---|---|
| `M-20261` | I1.1 to I1.9 | Two anticoagulants across sources; SNF admission with no ADT and a discharge 50 h late; pended and missing claims; mislabelled daughter's cell and unreachable landline; stale HRA and unlinked caregiver role; unrouted daughter call; pended home-health auth; standing INR order after warfarin stopped; lapsed alendronate |
| `C-77419` | I2.1 to I2.7 | VA switch reads as non-adherence, with a false reason code and false SPD gap; SMS reply siloed; HRA 55% but "complete"; 10:00 slot for a night worker and a miscoded "refused"; SGLT2i denied despite labs on file; old UTR label and unassigned referral; device data fragmented |
| `MD-30877` | I3.1 to I3.8 | Suspension coded as termination, suppressing an alert; dead primary number with the real one in an ED note; unreliable address; expired Part 2 consent and contradictory UDS; `JALEN` name variant at 0.81 match; unspecific ADT code upgraded by a late claim; hearsay close reason; pending peer referral and unverified court date |
| `MD-41552` | I4.1 to I4.8 | Language conflict and English IVR; parent's cell only on a sibling's record; stale address not written back; two controllers, neither in the home; attributed PCP never seen; ED alert 43 h late and urgent care visible only via claim; allergen and housing data never joined; callback booked outside the stated time |
| `D-55308` | I5.1 to I5.8 | Medicare/Medi-Cal identity split with placeholder DOB and conflicting PCP; language defaulted to English and a UTR closure; antiemetics sent to a closed pharmacy; chemo visible only via UM and schedule; proxy HRA and overdue reassessment; NEMT booked to the wrong ZIP; nurse-line fever call in a batch file; son's release and number held only at oncology |

Coverage of all 40 by pipeline rules is computed and shown on `/pipeline`.

## Other imperfections found (not in the register)

Stated values that the rows do not support. The UI shows the computed value and keeps the workbook's text beside it, never silently correcting either.

| Where | Workbook says | Rows show | Handling |
|---|---|---|---|
| 02 r5 | "all 8 outreach attempts in 2 years" | 7 rows in 12: 6 voice, 1 SMS | Show the row count |
| 17 r6, I2.7 | "10 readings Sep-Oct, mean 161/98" | 4 BP rows: mean 165/100, max 174/104 | Show both, labelled |
| 05 r4, I1.9 | alendronate "lapsed 19 months" | 17.1 months past run-out, 19.9 months since fill | Show computed days |
| 07 r9 | creatinine implies eGFR "~43" | CKD-EPI 2021 gives 41 (male, 54, Cr 1.9) | Show computed, labelled as derived |
| 06 r5 | VA CCD "arrived 103 days after" | 104 days by date arithmetic | Show computed |
| 02 r8 | "3 attempts dialled it after carrier lookup" | 2 rows on or after the lookup date (r14, r15) | Show row count |
| 02 r13/r14, 12 r18 | best time "after 19:30" | Outreach note says "after 8 pm"; I4.8 says "after 20:00" | Show the contact record and the conflicting note side by side |
| 10 r14, r16 | measures MISSED with due dates 11/07 and 11/08 | `Last_Refresh` is 11/06, before either date | Flag as refreshed before due |
| `Monday_8am` r2 | "nadir window now" | At as-of it is day 6; the window is day 7 to 14 per 07 r25 | Compute from chemo date: opens 11/10 |
| 12 r13 | one row summarises `OUT-12..20` (9 attempts) | Row count understates attempts | Parse the `x9` count when counting attempts |

## What the workbook cannot supply

- **Household members' records**, as noted above: IDs only, no rows.
- **Race and ethnicity** appear only in `Coverage_Matrix`, not in any dataset. Not used.
- **Member-reported medication data** has no dedicated source. It is mined from quoted free text and an HRA-derived row, and every such item is tagged "self-reported".
- **Actual call content.** Transcripts and extracted facts are authored in `data/demo/` and labelled "Illustrative AI output", as the brief allows.
