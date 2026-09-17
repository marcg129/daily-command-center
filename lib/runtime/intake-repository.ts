import type { ProductWorkspaceId, RequestContext } from "./context";
import type {
  BillProposalRecurrence,
  DailyIntakeSourceKey,
  IntakeEditablePatch,
  IntakePriority,
  IntakeProposalInput,
  IntakeSourceType,
  IntakeStatus,
  IntakeType,
} from "./daily-intake";

export type ApprovedTarget = Readonly<{
  kind: "TASK" | "BILL";
  id: string;
}>;

export type HostedIntakeItem = Readonly<{
  intakeId: string;
  userId: string;
  workspaceKey: ProductWorkspaceId;
  intakeType: IntakeType;
  status: IntakeStatus;
  sourceType: IntakeSourceType;
  sourceKey: DailyIntakeSourceKey;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceEventId: string | null;
  sourceSeriesId: string | null;
  proposalOrdinal: number;
  sourceTimestamp: string;
  sourceSender: string | null;
  sourceSubject: string | null;
  sourceUrl: string | null;
  sourceSummary: string;
  classificationReason: string;
  title: string;
  dueDate: string | null;
  followUpAt: string | null;
  priority: IntakePriority | null;
  amountMinor: number | null;
  currency: string | null;
  recurrence: BillProposalRecurrence | null;
  semanticKey: string;
  scanRunId: string;
  userEditedAt: string | null;
  deferUntil: string | null;
  approvedTargetKind: "TASK" | "BILL" | null;
  approvedTargetId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type IntakeIngestResult = Readonly<{
  status: "created" | "reused" | "terminal";
  item: HostedIntakeItem;
}>;

export type IntakeListFilter = Readonly<{
  status?: IntakeStatus;
  type?: IntakeType;
  sourceKey?: DailyIntakeSourceKey;
}>;

export interface IntakeRepository {
  ingest(context: RequestContext, input: IntakeProposalInput): Promise<IntakeIngestResult>;
  list(context: RequestContext, filter?: IntakeListFilter): Promise<HostedIntakeItem[]>;
  get(context: RequestContext, intakeId: string): Promise<HostedIntakeItem | null>;
  edit(
    context: RequestContext,
    intakeId: string,
    patch: IntakeEditablePatch,
    destinationContext?: RequestContext,
  ): Promise<HostedIntakeItem>;
  defer(context: RequestContext, intakeId: string, until: string): Promise<HostedIntakeItem>;
  dismiss(context: RequestContext, intakeId: string): Promise<HostedIntakeItem>;
  archive(context: RequestContext, intakeId: string): Promise<HostedIntakeItem>;
  markApproved(context: RequestContext, intakeId: string, target: ApprovedTarget): Promise<HostedIntakeItem>;
}
