# Milestone 1G-H — Automated Daily Intake and Upcoming Events

Date: 2026-09-17

Branch: `docs/1g-h-daily-intake-design`

Status: **Design approved in chat; implementation not started.**

## Objective

Add a reliable, privacy-conscious Daily Intake layer that reviews selected Gmail accounts and Google Calendars on a fixed schedule, produces concise ChatGPT briefings, creates durable reviewable proposals in Daily Command Center (DCC), and projects the next 45 days of calendar events without turning events into Tasks.

The system must preserve DCC's existing authorization rule: **inferred work is never written directly into canonical Tasks or Bills without the user's approval.**

## Scope

### Gmail sources in v1

- Personal Gmail → default DCC workspace: `personal`
- Professional Gmail → default DCC workspace: `personal`
- Indelitech Gmail → default DCC workspace: `indelitech`

Harvest Fire and HF IT Gmail are explicitly out of scope for v1.

### Calendar sources in v1

- Primary Google Calendar → default DCC workspace: `personal`
- Family Google Calendar → default DCC workspace: `personal`

The HFWC Praise Team/AV calendar and US Holidays calendar are explicitly out of scope for v1.

### Schedule

Run automated scans at:

- 7:00 AM America/New_York
- 12:30 PM America/New_York
- 5:30 PM America/New_York

These are v1 defaults and may be tuned later without changing the architecture.

### Calendar horizon

DCC projects a rolling **45-day forward window** of calendar events.

## Architectural decision

Use a hybrid architecture:

1. **ChatGPT Automation** reads the already-connected Gmail and Google Calendar sources and performs semantic interpretation.
2. **Todoist** remains a transport layer, not a system of record. It carries versioned structured envelopes into DCC through the existing private Cloudflare Worker relay.
3. **DCC Intake** stores pending proposals and awareness items durably for review.
4. **Canonical DCC Tasks and Bills** are created only after explicit approval inside DCC.
5. **Calendar projections** are synchronized into a dedicated DCC event model and remain separate from Tasks.
6. **Scan-status envelopes** let DCC track source freshness without requiring ChatGPT Automation to read DCC state.

This design avoids adding Google OAuth refresh-token storage and a separate model API to DCC in v1 while reusing the production-proven Todoist relay.

## Core principles

- **Proposal yes, invented deadline no.** If an action is clear but a date is not, create a proposal with no due date rather than inventing one.
- **Events are not Tasks.** Calendar events do not get completion state, overdue styling, or task semantics simply because time passes.
- **Actions tied to events may become proposals.** Examples: prepare for a meeting, review materials before an interview, send a follow-up afterward.
- **Awareness is not work.** Important but non-actionable information is surfaced without creating a Task/Bill/Follow-up proposal.
- **Minimal source storage.** DCC stores only the metadata and evidence needed to explain and review an item; complete email bodies and attachments are not copied into DCC by default.
- **Manual classification wins.** If the user corrects an event or proposal workspace, future automatic classification must not silently overwrite that correction.
- **Personal and Indelitech financial data remain isolated.** Approval of Bill proposals must use the existing workspace-specific Bills model.
- **Scheduled scans do not depend on reading DCC cursor state.** Gmail scans use a deliberate overlapping lookback; DCC semantic deduplication absorbs repeat observations.

## DCC Intake model

DCC Intake is a first-class subsystem separate from Tasks, Bills, and Calendar Events.

### Intake types

- `TASK`
- `FOLLOW_UP`
- `BILL`
- `AWARENESS`

### Intake statuses

- `PENDING`
- `DEFERRED`
- `APPROVED`
- `DISMISSED`
- `ARCHIVED`

`AWARENESS` items do not support approval into a canonical record. They may be archived/dismissed and surfaced in briefings.

### Required persisted fields

Each Intake record stores at least:

- stable DCC intake ID
- user ID
- physical workspace ID and logical workspace key
- intake type
- status
- source type (`gmail` or `calendar`)
- logical source account/calendar key
- source message/thread/event identity
- source timestamp
- source proposal ordinal/slot within that source item
- proposed title/action
- short source summary/evidence
- classification reason
- source-supported due/follow-up date when present
- source-supported amount/currency when present
- source-supported recurrence when present
- proposed priority only when explicitly justified or intentionally supplied; otherwise unset/default behavior remains with the canonical target
- semantic dedupe key
- originating scan-run ID
- created/updated timestamps
- defer-until timestamp when deferred
- approved target kind and canonical target ID after approval

Optional source fields must remain null/absent when unsupported rather than guessed.

## Intake lifecycle

### Pending

A detected action or obligation enters DCC as `PENDING`. Nothing canonical has been created yet.

The user may edit:

- title
- workspace
- due date
- follow-up date
- priority
- amount/currency
- recurrence when supported by the target type
- other target-specific fields supported by the canonical subsystem

### Approve

Approval is an explicit user-authorized write.

- `TASK` → canonical DCC Task
- `FOLLOW_UP` → canonical DCC Task using follow-up timing rather than a separate reminder system
- `BILL` → canonical DCC Bill/occurrence flow

The approval operation must be idempotent. Repeating an approval request after a timeout must not create duplicate canonical records.

After success, the Intake item records the canonical target ID and becomes `APPROVED`.

### Dismiss

Dismissal records a durable rejection so later scans do not recreate the same proposal from the same source simply because the source still exists.

### Defer

Deferral hides a proposal from active review until a chosen date. The defer date controls proposal visibility only; it is not automatically copied into the canonical Task due date.

### Awareness

Awareness items can be marked seen/archived/dismissed. They do not expose an Approve action.

## Proposal deduplication

Two layers of idempotency are required.

### Transport-level idempotency

The existing Todoist task ID remains authoritative for one relay delivery. Re-delivery of the same transport task must replay safely.

### Semantic idempotency

DCC must also prevent duplicates across different transport tasks carrying the same finding.

For Gmail-derived Intake, ChatGPT assigns each finding within one source message a deterministic **proposal ordinal** beginning at `1` in source order. DCC derives the semantic slot key from:

- logical Gmail source account key
- Gmail message ID
- proposal ordinal

The same slot delivered again must update/reuse the existing unresolved Intake item rather than create another one. Once that slot is approved, dismissed, or archived, later scans must not resurrect it.

The message ID boundary allows a later reply in the same Gmail thread to create a genuinely new proposal because the new reply has a different message ID. Gmail thread ID is still retained for context and diagnostics.

For non-Gmail sources, use an equivalent stable source identity plus kind-specific slot identity.

## Gmail scan behavior

### Bootstrap and recurring overlap

The recurring scanner must not backfill the entire mailbox and must not depend on ChatGPT being able to read DCC cursor state.

- Before enabling recurring Automations, run one controlled **7-day bootstrap** across the three approved Gmail accounts.
- After bootstrap, each scheduled scan reads a rolling **48-hour overlap window** from each approved Gmail account.
- Repeated observations are expected; DCC semantic deduplication prevents duplicate Intake items.
- A source-success timestamp is reported to DCC through `scan_status`; it is for freshness/diagnostics, not for constructing the next Gmail query.

This overlap intentionally tolerates missed/late automation runs without requiring stateful cursor reads from DCC.

Historical email cleanup beyond the bootstrap window is a separate one-time ChatGPT workflow and is explicitly out of scope for the recurring 1G-H scan.

### Noise filtering

Exclude obvious non-actionable noise such as Spam, Trash, Promotions, bulk marketing, and routine automated notifications unless the content is materially actionable or important.

### Thread context

When an email belongs to an ongoing conversation and interpretation depends on prior messages, ChatGPT may read the relevant thread before classifying it.

### Classification outcomes

Every meaningful finding must be classified into exactly one of:

- Task proposal
- Follow-up proposal
- Bill proposal
- Awareness
- Ignore

### Date/amount/priority rules

- Exact dates may populate proposed dates.
- Explicit amounts may populate Bill proposals.
- Explicit recurrence may populate a Bill proposal when the existing Bills model supports it.
- Vague phrases such as “soon,” “when you can,” or “ASAP” remain source context and do not become fabricated dates.
- Priority must not be invented merely because an item feels important; use only source-supported urgency or leave it unset.
- If a field cannot be supported by the source, leave it unset.

### Workspace routing

Defaults:

- Personal Gmail → Personal
- Professional Gmail → Personal
- Indelitech Gmail → Indelitech

ChatGPT may propose a different workspace only when source evidence is strong. The proposal remains editable before approval.

## Calendar synchronization

Calendar projection uses a reconciliatory model rather than ordinary incremental proposal ingestion.

### Sync window

Each scheduled run reads the current rolling 45-day forward window from Primary and Family calendars.

### Projection fields

Persist only fields needed by DCC, including:

- logical source calendar key (`primary` or `family`)
- Google event ID
- recurring-series identity when available
- occurrence identity when applicable
- title
- start/end
- all-day flag
- location when present
- cancellation/deletion state as derived during completed reconciliation
- DCC workspace classification
- last-seen sync run

Do not persist full Calendar descriptions or attendee lists by default.

### Workspace routing

Defaults:

- Primary → Personal
- Family → Personal

Strong evidence may classify an individual event as Indelitech.

### Manual overrides

Workspace correction is editable inside DCC and does not modify the Google event itself.

For recurring events:

- default manual correction scope: **entire series**
- optional exception: **this occurrence only**

Precedence:

1. occurrence-specific manual override
2. series-level manual override
3. automatic classification
4. source-calendar default

### Reconciliation safety

A calendar sync run records:

- source calendar key
- scan/sync run ID
- window start/end
- expected batch count
- received batch identities
- completion state

A batch may update/upsert events it positively contains, but DCC must not reconcile deletions/removals until every expected batch for that source calendar and sync run has arrived successfully.

After full completion, events previously projected within the covered window but not seen in the completed run may be marked removed/cancelled from the projection.

## Event-related actions

A calendar event itself never becomes a Task automatically.

The scanner may create separate Intake proposals such as:

- Prepare for client meeting
- Review materials before interview
- Send interview follow-up
- Prepare agenda for prospect call

Those proposals remain confirmation-gated like all other inferred work.

DCC should show the relationship in both directions when a proposal/canonical Task is tied to a projected event.

## Scan-run identity and freshness

Every scheduled execution creates one stable `scanRunId` that is reused across all envelopes emitted by that run.

At the end of the run, ChatGPT sends a `scan_status` envelope containing one status entry for each approved source:

- Personal Gmail
- Professional Gmail
- Indelitech Gmail
- Primary Calendar
- Family Calendar

Each source status contains:

- source key
- `SUCCESS` or `FAILED`
- attempted-at timestamp
- completed-at timestamp when successful
- concise diagnostic when failed

DCC uses the newest successfully persisted `scan_status` data to show freshness/staleness. Missing status for a source is treated as unknown/stale, never as success.

## Todoist relay envelope contract

The existing legacy task-capture format must remain backward-compatible.

New 1G-H transport items use a typed, versioned envelope.

### Envelope description format

The Todoist task description contains exactly three transport metadata lines:

```text
dccEnvelopeVersion: 1
kind: intake_proposal
payload: {"...":"single-line JSON..."}
```

Supported v1 kinds:

- `intake_proposal`
- `calendar_sync`
- `scan_status`

The legacy task-capture parser remains the fallback when `dccEnvelopeVersion` is absent.

### Envelope validation

The relay must:

- require `dccEnvelopeVersion` exactly `1`
- accept only supported kinds
- parse `payload` as strict JSON
- enforce bounded serialized payload size before persistence
- reject unknown logical workspaces
- reject physical workspace IDs supplied by transport
- validate all kind-specific fields before touching canonical DCC state
- require `scanRunId` on all 1G-H envelopes

Calendar batches must be sized conservatively so each transport item remains comfortably below Todoist description limits; implementation should batch by serialized payload size rather than assuming a fixed event count.

### Trust boundary

Todoist is untrusted transport. It cannot authorize access by itself.

Every envelope resolves the configured DCC user to an active logical workspace membership before persistence. Physical workspace IDs remain server-side.

DCC persistence always occurs before the Todoist transport item is closed. A failed acknowledgement may cause redelivery, but redelivery must be safe.

## Privacy and source retention

### Gmail-derived Intake

Store only:

- sender
- subject
- received timestamp
- logical source account key
- Gmail message/thread IDs
- short evidence/summary
- proposal data

Do not store full message bodies or attachments by default.

### Calendar projection

Store only DCC-useful event metadata. Do not persist full descriptions or attendee lists by default.

### Source links

Where feasible, DCC may expose an “Open source” action that returns the user to the originating Gmail message or Calendar event without storing source content locally.

## Scheduled briefing behavior

Each Automation run produces a concise ChatGPT briefing after processing available sources.

Because the v1 Automation path does not require ChatGPT to read DCC state, the briefing reports **new proposals/findings generated in that run**, not the authoritative total number of pending Intake items. DCC itself remains authoritative for pending totals.

### 7:00 AM

Emphasize:

- today’s agenda
- overnight/new important email
- upcoming deadlines
- new proposals generated in this run
- near-term events

### 12:30 PM

Emphasize deltas since morning:

- newly important/actionable email
- schedule changes
- new proposals generated in this run
- newly urgent items

### 5:30 PM

Emphasize:

- late-day changes
- unresolved source findings that still matter in the current run context
- tomorrow’s calendar
- near-term events/deadlines requiring advance attention

Briefings are ephemeral summaries; DCC Intake is the durable review system.

## Partial failure and stale-source behavior

Each source is attempted independently.

If one Gmail account or Calendar source fails:

- preserve successful results from other sources
- do not roll back successful persisted Intake/events
- record the failed source in `scan_status`
- explicitly disclose the stale/failed source in the ChatGPT briefing
- do not present the overall scan as fully complete

For Calendar specifically, incomplete batch delivery may upsert positively received events but must not perform deletion reconciliation.

If Todoist itself is unavailable, ChatGPT must report that DCC delivery was incomplete even if source reads succeeded.

## DCC UI

### Intake surface

Add a dedicated Intake surface with views/counts for:

- Pending
- Deferred
- Awareness
- recently Approved/Dismissed

Default Pending sort:

1. source-supported urgency/date when present
2. newest first when no real date exists

Each card shows at minimum:

- proposed title/action
- type
- workspace
- source
- source timestamp
- source-supported due/follow-up date or amount when present
- short “Why this was suggested” explanation

Expanded details may show additional short source context without persisting complete email bodies.

Actions:

- Approve
- Edit & Approve
- Defer
- Dismiss
- Archive for Awareness
- Open source where supported

Bulk actions:

- allow conservative bulk Approve/Dismiss for straightforward non-Bill items
- Bills require individual approval in v1

### Upcoming Events surface

Add a dedicated 45-day Upcoming Events view grouped by date with:

- Personal / Indelitech / All filter
- source calendar indication
- recurring-series indication
- editable workspace classification
- series-default override behavior
- occurrence-only exception
- links to related proposed/approved prep or follow-up Tasks

Events must never display Task completion or overdue semantics.

### Today integration

Keep Today lightweight:

- Today’s Events
- compact Upcoming preview for the next 7 days
- Intake requiring review count/card
- canonical Tasks remain in the existing task area

Do not render the entire 45-day calendar horizon on Today.

## Hosted API / repository boundaries

Implementation should add focused, independently testable repositories/services rather than placing Intake and Calendar logic directly in UI handlers.

Expected hosted capabilities include:

- list/filter authorized Intake items
- edit a pending/deferred Intake item
- approve an Intake item idempotently
- defer/dismiss/archive an Intake item
- list authorized projected events for a bounded date window
- set/clear event workspace overrides with series/occurrence scope
- expose per-source sync/scan freshness for UI and diagnostics

Every hosted operation starts from the authenticated DCC user and authorized workspace membership. IDs alone never grant access.

## Rollout order

To avoid breaking the production Todoist relay:

1. Add schema/repositories/services and tests.
2. Add typed envelope parsing/dispatch while preserving legacy task-capture behavior.
3. Add Intake, Calendar, and scan-freshness hosted APIs/UI.
4. Deploy the DCC/relay changes first.
5. Run manual production acceptance with one `intake_proposal`, one small `calendar_sync`, and one `scan_status` envelope.
6. Confirm legacy ChatGPT → Todoist → DCC task capture still works.
7. Run the controlled 7-day Gmail bootstrap.
8. Only then enable the three scheduled ChatGPT Automations using the 48-hour recurring Gmail overlap.
9. Verify all three scheduled runs and source-staleness reporting in production.

## Testing requirements

At minimum, automated coverage must prove:

- legacy Todoist task capture remains backward-compatible
- malformed/unsupported envelopes fail closed
- physical workspace IDs cannot be selected by transport
- unauthorized logical workspace access fails closed
- Todoist redelivery is idempotent
- repeated Gmail observations for the same message/proposal ordinal do not create duplicate Intake items
- multiple distinct proposal ordinals from one Gmail message can coexist
- a later genuinely new action in the same Gmail thread can create a new Intake item through its later message ID
- approval creates exactly one canonical target
- approval replay does not duplicate the canonical target
- dismissed/approved/archived source slots are not resurrected
- deferred items return when their defer-until time is reached
- Awareness items cannot create canonical Tasks/Bills
- Bill proposals require individual approval
- partial calendar batches cannot trigger deletion reconciliation
- complete calendar sync reconciles missing events correctly
- manual occurrence override beats series override
- series override beats automatic classification
- Primary/Family source defaults work when no stronger classification exists
- events never inherit Task completion/overdue semantics
- `scan_status` updates source freshness correctly
- missing/failed scan status is never interpreted as source success
- no full Gmail body/attachment is persisted by the Intake repository contract

## Production acceptance criteria

1. A new actionable Personal Gmail message produces a Personal Intake proposal, not an immediate Task.
2. A new Indelitech Gmail action produces an Indelitech proposal.
3. An important non-actionable email appears as Awareness only.
4. A source-supported Bill email produces a Bill proposal with no invented fields.
5. Approving a proposal creates one canonical target and links it back to Intake.
6. Dismissing a proposal prevents repeated recreation from the same source slot.
7. Primary + Family events appear in the 45-day Upcoming Events view.
8. A clearly Indelitech Primary-calendar event can auto-classify to Indelitech and remains manually editable.
9. A recurring-event workspace correction applies to the series by default, with an occurrence-only option.
10. Calendar events remain separate from Tasks.
11. Today shows Today’s Events, a 7-day preview, and Intake review state without becoming a 45-day dashboard.
12. A deliberately failed source is reported as stale/incomplete in both DCC diagnostics and the ChatGPT briefing.
13. Existing explicit ChatGPT → Todoist → DCC task capture continues to work after deployment.
14. The controlled 7-day bootstrap completes without requiring recurring scans to process older mail.
15. The 7:00 AM, 12:30 PM, and 5:30 PM ET scheduled briefings run successfully with the approved source scope.
16. The ChatGPT briefing reports new findings for the run while DCC remains authoritative for the total pending Intake count.

## Explicitly deferred / out of scope

- historical full-mailbox email backfill beyond the controlled 7-day bootstrap; this will be handled as a separate one-time ChatGPT task-generation workflow
- Harvest Fire Gmail
- HF IT Gmail
- HFWC Praise Team/AV calendar
- US Holidays calendar
- direct Google OAuth/token storage inside DCC
- separate paid LLM/API classification inside DCC
- automatic creation of inferred Tasks or Bills without approval
- storing complete Gmail bodies/attachments in DCC by default
- storing full Calendar descriptions/attendee lists by default
- automatic calendar-event creation from email
- standalone reminder subsystem
- changing Google Calendar events when DCC workspace classification is edited
- direct payment execution or bank transaction matching

## Success definition

Milestone 1G-H is complete when DCC reliably receives and reviews semantically classified email findings, safely projects the approved 45-day calendar scope, preserves user control over every inferred canonical write, delivers the three daily ChatGPT briefings, and does so without compromising the existing Personal/Indelitech authorization and financial-isolation boundaries.
