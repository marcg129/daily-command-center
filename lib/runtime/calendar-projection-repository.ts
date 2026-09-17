import type { ProductWorkspaceId } from "./context";
import type { CalendarOverrideScope, CalendarSourceKey, CalendarSyncInput } from "./calendar-projections";
import type { IntakeStatus, IntakeType } from "./daily-intake";

export type CalendarReadRange = Readonly<{
  fromDate: string;
  throughDate: string;
}>;

export type CalendarWorkspaceOverrideInput = Readonly<{
  sourceKey: CalendarSourceKey;
  scope: CalendarOverrideScope;
  identityKey: string;
  workspaceId: ProductWorkspaceId;
}>;

export type RelatedIntakeSummary = Readonly<{
  intakeId: string;
  intakeType: IntakeType;
  status: IntakeStatus;
  approvedTargetKind: "TASK" | "BILL" | null;
  approvedTargetId: string | null;
}>;

export type ProjectedCalendarEvent = Readonly<{
  eventProjectionId: string;
  sourceKey: CalendarSourceKey;
  googleEventId: string;
  seriesId: string | null;
  occurrenceKey: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  sourceUrl: string | null;
  automaticWorkspaceId: ProductWorkspaceId;
  resolvedWorkspaceId: ProductWorkspaceId;
  removedAt: string | null;
  relatedIntake: readonly RelatedIntakeSummary[];
}>;

export type CalendarBatchIngestResult = Readonly<{
  complete: boolean;
  receivedBatchCount: number;
}>;

export interface CalendarProjectionRepository {
  ingestBatch(userId: string, input: CalendarSyncInput): Promise<CalendarBatchIngestResult>;
  list(userId: string, workspaceId: ProductWorkspaceId, range: CalendarReadRange): Promise<ProjectedCalendarEvent[]>;
  setWorkspaceOverride(userId: string, input: CalendarWorkspaceOverrideInput): Promise<void>;
  clearWorkspaceOverride(
    userId: string,
    sourceKey: CalendarSourceKey,
    scope: CalendarOverrideScope,
    identityKey: string,
  ): Promise<void>;
}
