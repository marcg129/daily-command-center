import { isDateOnly } from "@/lib/runtime/bills";
import {
  CALENDAR_OVERRIDE_SCOPES,
  CALENDAR_SOURCE_KEYS,
  validateCalendarSyncInput,
  validateCalendarWorkspaceOverrideInput,
  type CalendarOverrideScope,
  type CalendarSourceKey,
  type CalendarSyncInput,
} from "@/lib/runtime/calendar-projections";
import { isProductWorkspaceId, type ProductWorkspaceId } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import type {
  CalendarBatchIngestResult,
  CalendarProjectionRepository,
  CalendarReadRange,
  CalendarWorkspaceOverrideInput,
  ProjectedCalendarEvent,
  RelatedIntakeSummary,
} from "@/lib/runtime/calendar-projection-repository";

const EVENT_COLUMNS = `e.event_projection_id, e.source_key, e.google_event_id, e.series_id, e.occurrence_key,
  e.title, e.start_at, e.end_at, e.all_day, e.location, e.source_url, e.automatic_workspace_key,
  e.removed_at`;

type SyncRunRow = Readonly<{
  window_start: string;
  window_end: string;
  batch_count: number;
  state: "RECEIVING" | "COMPLETE";
}>;

type EventRow = Readonly<{
  event_projection_id: string;
  source_key: CalendarSourceKey;
  google_event_id: string;
  series_id: string | null;
  occurrence_key: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  location: string | null;
  source_url: string | null;
  automatic_workspace_key: ProductWorkspaceId;
  removed_at: string | null;
  resolved_workspace_key: ProductWorkspaceId;
}>;

type RelatedRow = Readonly<{
  intake_id: string;
  intake_type: RelatedIntakeSummary["intakeType"];
  status: RelatedIntakeSummary["status"];
  approved_target_kind: "TASK" | "BILL" | null;
  approved_target_id: string | null;
}>;

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId.trim().length < 3 || userId.length > 160) {
    throw new Error("DCC user ID is invalid.");
  }
}

function sourceDefaultWorkspace(sourceKey: CalendarSourceKey): ProductWorkspaceId {
  if (!CALENDAR_SOURCE_KEYS.includes(sourceKey)) throw new Error("Calendar source is not supported.");
  return "personal";
}

function dateMs(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function validateReadRange(range: CalendarReadRange): void {
  if (!range || !isDateOnly(range.fromDate) || !isDateOnly(range.throughDate)) {
    throw new Error("Calendar read range requires exact dates.");
  }
  const span = dateMs(range.throughDate) - dateMs(range.fromDate);
  if (span < 0 || span > 45 * 24 * 60 * 60 * 1000) {
    throw new Error("Calendar read range cannot exceed 45 days.");
  }
}

function assertSource(sourceKey: CalendarSourceKey): void {
  if (!CALENDAR_SOURCE_KEYS.includes(sourceKey)) throw new Error("Calendar source is not supported.");
}

function assertScope(scope: CalendarOverrideScope): void {
  if (!CALENDAR_OVERRIDE_SCOPES.includes(scope)) throw new Error("Calendar override scope is not supported.");
}

function assertIdentity(identityKey: string): void {
  if (typeof identityKey !== "string" || identityKey.trim().length === 0 || identityKey.length > 1024) {
    throw new Error("Calendar override identity is invalid.");
  }
}

export class D1CalendarProjectionRepository implements CalendarProjectionRepository {
  constructor(
    private readonly database: D1Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  private now(): string {
    return this.clock.now().toISOString();
  }

  private async requireActiveUser(userId: string): Promise<void> {
    assertUserId(userId);
    const row = await this.database.prepare("SELECT user_id FROM users WHERE user_id=? AND status='ACTIVE'")
      .bind(userId).first<{ user_id: string }>();
    if (!row) throw new Error("DCC user access denied.");
  }

  private eventUpsert(
    userId: string,
    input: CalendarSyncInput,
    event: CalendarSyncInput["events"][number],
    timestamp: string,
  ): D1PreparedStatement {
    const automaticWorkspace = event.automaticWorkspaceId ?? sourceDefaultWorkspace(input.sourceKey);
    const removedAt = event.cancelled ? timestamp : null;
    return this.database.prepare(`INSERT INTO projected_calendar_events (
      event_projection_id, user_id, source_key, google_event_id, series_id, occurrence_key,
      title, start_at, end_at, all_day, location, source_url, automatic_workspace_key,
      last_seen_scan_run_id, removed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_key, google_event_id) DO UPDATE SET
      series_id=excluded.series_id,
      occurrence_key=excluded.occurrence_key,
      title=excluded.title,
      start_at=excluded.start_at,
      end_at=excluded.end_at,
      all_day=excluded.all_day,
      location=excluded.location,
      source_url=excluded.source_url,
      automatic_workspace_key=excluded.automatic_workspace_key,
      last_seen_scan_run_id=excluded.last_seen_scan_run_id,
      removed_at=excluded.removed_at,
      updated_at=excluded.updated_at`)
      .bind(
        this.ids.generate(),
        userId,
        input.sourceKey,
        event.eventId,
        event.seriesId ?? null,
        event.occurrenceId ?? null,
        event.title,
        event.start,
        event.end,
        event.allDay ? 1 : 0,
        event.location ?? null,
        event.sourceUrl ?? null,
        automaticWorkspace,
        input.scanRunId,
        removedAt,
        timestamp,
        timestamp,
      );
  }

  async ingestBatch(userId: string, input: CalendarSyncInput): Promise<CalendarBatchIngestResult> {
    await this.requireActiveUser(userId);
    validateCalendarSyncInput(input);
    const timestamp = this.now();

    const runInsert = await this.database.prepare(`INSERT OR IGNORE INTO calendar_sync_runs (
      user_id, source_key, scan_run_id, window_start, window_end, batch_count, state, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'RECEIVING', ?, NULL)`)
      .bind(userId, input.sourceKey, input.scanRunId, input.windowStart, input.windowEnd, input.batchCount, timestamp)
      .run();
    if (!runInsert.success) throw new Error("Calendar sync persistence failed.");

    const run = await this.database.prepare(`SELECT window_start, window_end, batch_count, state
      FROM calendar_sync_runs WHERE user_id=? AND source_key=? AND scan_run_id=?`)
      .bind(userId, input.sourceKey, input.scanRunId).first<SyncRunRow>();
    if (!run || run.window_start !== input.windowStart || run.window_end !== input.windowEnd || Number(run.batch_count) !== input.batchCount) {
      throw new Error("Calendar sync run metadata conflict.");
    }

    const batchStatements: D1PreparedStatement[] = [
      this.database.prepare(`INSERT OR IGNORE INTO calendar_sync_batches
        (user_id, source_key, scan_run_id, batch_index, received_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(userId, input.sourceKey, input.scanRunId, input.batchIndex, timestamp),
      ...input.events.map((event) => this.eventUpsert(userId, input, event, timestamp)),
    ];
    const batchResults = await this.database.batch(batchStatements);
    if (batchResults.some((result) => !result.success)) throw new Error("Calendar sync persistence failed.");

    const count = await this.database.prepare(`SELECT count(*) AS count FROM calendar_sync_batches
      WHERE user_id=? AND source_key=? AND scan_run_id=?`)
      .bind(userId, input.sourceKey, input.scanRunId).first<{ count: number }>();
    const receivedBatchCount = Number(count?.count ?? 0);
    const complete = receivedBatchCount === input.batchCount;

    if (complete) {
      const startDate = input.windowStart.slice(0, 10);
      const endDate = input.windowEnd.slice(0, 10);
      const results = await this.database.batch([
        this.database.prepare(`UPDATE projected_calendar_events SET removed_at=?, updated_at=?
          WHERE user_id=? AND source_key=? AND removed_at IS NULL
            AND substr(start_at, 1, 10)>=? AND substr(start_at, 1, 10)<?
            AND last_seen_scan_run_id<>?`)
          .bind(timestamp, timestamp, userId, input.sourceKey, startDate, endDate, input.scanRunId),
        this.database.prepare(`UPDATE calendar_sync_runs SET state='COMPLETE', completed_at=?
          WHERE user_id=? AND source_key=? AND scan_run_id=?`)
          .bind(timestamp, userId, input.sourceKey, input.scanRunId),
      ]);
      if (results.some((result) => !result.success)) throw new Error("Calendar reconciliation failed.");
    }

    return { complete, receivedBatchCount };
  }

  private async relatedIntake(userId: string, sourceKey: CalendarSourceKey, eventId: string): Promise<RelatedIntakeSummary[]> {
    const result = await this.database.prepare(`SELECT intake_id, intake_type, status, approved_target_kind, approved_target_id
      FROM intake_items
      WHERE user_id=? AND source_key=? AND source_event_id=?
      ORDER BY proposal_ordinal, intake_id`)
      .bind(userId, sourceKey, eventId).all<RelatedRow>();
    if (!result.success) throw new Error("Calendar relationship read failed.");
    return (result.results ?? []).map((row) => ({
      intakeId: row.intake_id,
      intakeType: row.intake_type,
      status: row.status,
      approvedTargetKind: row.approved_target_kind,
      approvedTargetId: row.approved_target_id,
    }));
  }

  async list(userId: string, workspaceId: ProductWorkspaceId, range: CalendarReadRange): Promise<ProjectedCalendarEvent[]> {
    await this.requireActiveUser(userId);
    if (!isProductWorkspaceId(workspaceId)) throw new Error("Calendar workspace is not supported.");
    validateReadRange(range);

    const result = await this.database.prepare(`SELECT ${EVENT_COLUMNS},
      COALESCE(occ.workspace_key, series.workspace_key, e.automatic_workspace_key) AS resolved_workspace_key
      FROM projected_calendar_events e
      LEFT JOIN calendar_workspace_overrides occ
        ON occ.user_id=e.user_id AND occ.source_key=e.source_key AND occ.scope='OCCURRENCE'
        AND occ.identity_key=e.occurrence_key
      LEFT JOIN calendar_workspace_overrides series
        ON series.user_id=e.user_id AND series.source_key=e.source_key AND series.scope='SERIES'
        AND series.identity_key=e.series_id
      WHERE e.user_id=? AND e.removed_at IS NULL
        AND substr(e.start_at, 1, 10)>=? AND substr(e.start_at, 1, 10)<=?
        AND COALESCE(occ.workspace_key, series.workspace_key, e.automatic_workspace_key)=?
      ORDER BY e.start_at, e.source_key, e.google_event_id`)
      .bind(userId, range.fromDate, range.throughDate, workspaceId).all<EventRow>();
    if (!result.success) throw new Error("Calendar projection read failed.");

    const output: ProjectedCalendarEvent[] = [];
    for (const row of result.results ?? []) {
      output.push({
        eventProjectionId: row.event_projection_id,
        sourceKey: row.source_key,
        googleEventId: row.google_event_id,
        seriesId: row.series_id,
        occurrenceKey: row.occurrence_key,
        title: row.title,
        startAt: row.start_at,
        endAt: row.end_at,
        allDay: row.all_day === 1,
        location: row.location,
        sourceUrl: row.source_url,
        automaticWorkspaceId: row.automatic_workspace_key,
        resolvedWorkspaceId: row.resolved_workspace_key,
        removedAt: row.removed_at,
        relatedIntake: await this.relatedIntake(userId, row.source_key, row.google_event_id),
      });
    }
    return output;
  }

  async setWorkspaceOverride(userId: string, input: CalendarWorkspaceOverrideInput): Promise<void> {
    await this.requireActiveUser(userId);
    validateCalendarWorkspaceOverrideInput(input);
    const timestamp = this.now();
    const result = await this.database.prepare(`INSERT INTO calendar_workspace_overrides (
      user_id, source_key, scope, identity_key, workspace_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_key, scope, identity_key) DO UPDATE SET
      workspace_key=excluded.workspace_key, updated_at=excluded.updated_at`)
      .bind(userId, input.sourceKey, input.scope, input.identityKey, input.workspaceId, timestamp, timestamp).run();
    if (!result.success) throw new Error("Calendar workspace override persistence failed.");
  }

  async clearWorkspaceOverride(
    userId: string,
    sourceKey: CalendarSourceKey,
    scope: CalendarOverrideScope,
    identityKey: string,
  ): Promise<void> {
    await this.requireActiveUser(userId);
    assertSource(sourceKey);
    assertScope(scope);
    assertIdentity(identityKey);
    const result = await this.database.prepare(`DELETE FROM calendar_workspace_overrides
      WHERE user_id=? AND source_key=? AND scope=? AND identity_key=?`)
      .bind(userId, sourceKey, scope, identityKey).run();
    if (!result.success) throw new Error("Calendar workspace override persistence failed.");
  }
}
