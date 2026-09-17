import { isDateOnly, validateBillSchedule, type BillSchedule } from "@/lib/runtime/bills";
import {
  INTAKE_PRIORITIES,
  validateIntakeProposalInput,
  isExactInstant,
  type IntakeEditablePatch,
  type IntakeProposalInput,
} from "@/lib/runtime/daily-intake";
import { requireHostedWorkspaceInstance, type ProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import type {
  ApprovedTarget,
  HostedIntakeItem,
  IntakeIngestResult,
  IntakeListFilter,
  IntakeRepository,
} from "@/lib/runtime/intake-repository";
import { resolveAuthorizedWorkspaceInstances } from "@/lib/server/d1-workspace-instances";

const TERMINAL_STATUSES = new Set(["APPROVED", "DISMISSED", "ARCHIVED"]);
const rowColumns = `intake_id, user_id, workspace_id, workspace_key, intake_type, status, source_type, source_key,
  source_message_id, source_thread_id, source_event_id, source_series_id, proposal_ordinal, source_timestamp,
  source_sender, source_subject, source_url, source_summary, classification_reason, title, due_date, follow_up_at,
  priority, amount_minor, currency, target_payload_json, semantic_key, scan_run_id, user_edited_at, defer_until,
  approved_target_kind, approved_target_id, created_at, updated_at`;

type Row = Record<string, unknown>;

type TargetPayload = Readonly<{
  recurrence?: BillSchedule;
}>;

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

function semanticKey(input: IntakeProposalInput): string {
  if (input.sourceType === "gmail") {
    return `${input.sourceKey}:message:${input.messageId}:${input.proposalOrdinal}`;
  }
  return `${input.sourceKey}:event:${input.eventId}:${input.proposalOrdinal}`;
}

function payloadForProposal(input: IntakeProposalInput): string {
  return JSON.stringify(input.recurrence ? { recurrence: input.recurrence } : {});
}

function parsePayload(value: unknown): TargetPayload {
  if (typeof value !== "string") throw new Error("Stored Intake target payload is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored Intake target payload is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored Intake target payload is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.recurrence !== undefined) validateBillSchedule(record.recurrence as BillSchedule);
  return record as TargetPayload;
}

function itemFromRow(row: Row): HostedIntakeItem {
  const payload = parsePayload(row.target_payload_json);
  return {
    intakeId: String(row.intake_id),
    userId: String(row.user_id),
    workspaceKey: row.workspace_key as ProductWorkspaceId,
    intakeType: row.intake_type as HostedIntakeItem["intakeType"],
    status: row.status as HostedIntakeItem["status"],
    sourceType: row.source_type as HostedIntakeItem["sourceType"],
    sourceKey: row.source_key as HostedIntakeItem["sourceKey"],
    sourceMessageId: row.source_message_id as string | null,
    sourceThreadId: row.source_thread_id as string | null,
    sourceEventId: row.source_event_id as string | null,
    sourceSeriesId: row.source_series_id as string | null,
    proposalOrdinal: Number(row.proposal_ordinal),
    sourceTimestamp: String(row.source_timestamp),
    sourceSender: row.source_sender as string | null,
    sourceSubject: row.source_subject as string | null,
    sourceUrl: row.source_url as string | null,
    sourceSummary: String(row.source_summary),
    classificationReason: String(row.classification_reason),
    title: String(row.title),
    dueDate: row.due_date as string | null,
    followUpAt: row.follow_up_at as string | null,
    priority: row.priority as HostedIntakeItem["priority"],
    amountMinor: row.amount_minor == null ? null : Number(row.amount_minor),
    currency: row.currency as string | null,
    recurrence: payload.recurrence ?? null,
    semanticKey: String(row.semantic_key),
    scanRunId: String(row.scan_run_id),
    userEditedAt: row.user_edited_at as string | null,
    deferUntil: row.defer_until as string | null,
    approvedTargetKind: row.approved_target_kind as "TASK" | "BILL" | null,
    approvedTargetId: row.approved_target_id as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function assertId(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1024) {
    throw new Error(`${field} is invalid.`);
  }
}

function assertPatchShape(patch: IntakeEditablePatch): void {
  if (!patch || typeof patch !== "object") throw new Error("Intake edit is required.");
  if (patch.title !== undefined && (typeof patch.title !== "string" || patch.title.trim().length === 0 || patch.title.length > 300)) {
    throw new Error("Intake title is invalid.");
  }
  if (patch.dueDate !== undefined && patch.dueDate !== null && !isDateOnly(patch.dueDate)) {
    throw new Error("Intake due date is invalid.");
  }
  if (patch.followUpAt !== undefined && patch.followUpAt !== null && !isExactInstant(patch.followUpAt)) {
    throw new Error("Intake follow-up timestamp is invalid.");
  }
  if (patch.priority !== undefined && patch.priority !== null && !includes(INTAKE_PRIORITIES, patch.priority)) {
    throw new Error("Intake priority is invalid.");
  }
  if (patch.amountMinor !== undefined && patch.amountMinor !== null &&
      (!Number.isSafeInteger(patch.amountMinor) || patch.amountMinor < 0)) {
    throw new Error("Intake amount is invalid.");
  }
  if (patch.currency !== undefined && patch.currency !== null && !/^[A-Z]{3}$/.test(patch.currency)) {
    throw new Error("Intake currency is invalid.");
  }
  if (patch.recurrence !== undefined && patch.recurrence !== null) validateBillSchedule(patch.recurrence);
}

export class D1IntakeRepository implements IntakeRepository {
  constructor(
    private readonly database: D1Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  private now(): string {
    return this.clock.now().toISOString();
  }

  private async authorize(context: RequestContext) {
    const instance = requireHostedWorkspaceInstance(context);
    const resolved = await resolveAuthorizedWorkspaceInstances(this.database, context, [instance.workspaceKey]);
    if (resolved.get(instance.workspaceKey) !== instance.workspaceId) throw new Error("Workspace access denied.");
    return instance;
  }

  private async rowForSemantic(userId: string, key: string): Promise<Row | null> {
    return this.database.prepare(`SELECT ${rowColumns} FROM intake_items WHERE user_id=? AND semantic_key=?`)
      .bind(userId, key).first<Row>();
  }

  private async exactRow(context: RequestContext, intakeId: string): Promise<Row | null> {
    const instance = await this.authorize(context);
    return this.database.prepare(`SELECT ${rowColumns} FROM intake_items
      WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=?`)
      .bind(intakeId, instance.userId, instance.workspaceId, instance.workspaceKey).first<Row>();
  }

  private async requireExactRow(context: RequestContext, intakeId: string): Promise<Row> {
    assertId(intakeId, "Intake ID");
    const row = await this.exactRow(context, intakeId);
    if (!row) throw new Error("Intake item not found.");
    return row;
  }

  private async persistAndRead(sql: string, values: readonly unknown[], context: RequestContext, intakeId: string) {
    const result = await this.database.prepare(sql).bind(...values).run();
    if (!result.success) throw new Error("Intake persistence failed.");
    const row = await this.exactRow(context, intakeId);
    if (!row) throw new Error("Intake item not found.");
    return itemFromRow(row);
  }

  async ingest(context: RequestContext, input: IntakeProposalInput): Promise<IntakeIngestResult> {
    validateIntakeProposalInput(input);
    const instance = await this.authorize(context);
    if (input.workspaceId !== instance.workspaceKey) throw new Error("Workspace access denied.");

    const key = semanticKey(input);
    const existing = await this.rowForSemantic(instance.userId, key);
    if (existing) return this.refreshExisting(existing, instance, input);

    const intakeId = this.ids.generate();
    const timestamp = this.now();
    const values = [
      intakeId,
      instance.userId,
      instance.workspaceId,
      instance.workspaceKey,
      input.intakeType,
      "PENDING",
      input.sourceType,
      input.sourceKey,
      input.messageId ?? null,
      input.threadId ?? null,
      input.eventId ?? null,
      input.seriesId ?? null,
      input.proposalOrdinal,
      input.sourceTimestamp,
      input.sender ?? null,
      input.subject ?? null,
      input.sourceUrl ?? null,
      input.summary,
      input.classificationReason,
      input.title,
      input.dueDate ?? null,
      input.followUpAt ?? null,
      input.priority ?? null,
      input.amountMinor ?? null,
      input.currency ?? null,
      payloadForProposal(input),
      key,
      input.scanRunId,
      null,
      null,
      null,
      null,
      timestamp,
      timestamp,
    ] as const;

    try {
      const result = await this.database.prepare(`INSERT INTO intake_items (
        intake_id, user_id, workspace_id, workspace_key, intake_type, status, source_type, source_key,
        source_message_id, source_thread_id, source_event_id, source_series_id, proposal_ordinal, source_timestamp,
        source_sender, source_subject, source_url, source_summary, classification_reason, title, due_date, follow_up_at,
        priority, amount_minor, currency, target_payload_json, semantic_key, scan_run_id, user_edited_at, defer_until,
        approved_target_kind, approved_target_id, created_at, updated_at
      ) VALUES (${values.map(() => "?").join(", ")})`).bind(...values).run();
      if (!result.success) throw new Error("Intake persistence failed.");
    } catch (error) {
      const raced = await this.rowForSemantic(instance.userId, key);
      if (raced) return this.refreshExisting(raced, instance, input);
      throw error;
    }

    const row = await this.rowForSemantic(instance.userId, key);
    if (!row) throw new Error("Intake persistence failed.");
    return { status: "created", item: itemFromRow(row) };
  }

  private async refreshExisting(
    existing: Row,
    instance: ReturnType<typeof requireHostedWorkspaceInstance>,
    input: IntakeProposalInput,
  ): Promise<IntakeIngestResult> {
    const existingStatus = String(existing.status);
    if (TERMINAL_STATUSES.has(existingStatus)) {
      return { status: "terminal", item: itemFromRow(existing) };
    }

    const timestamp = this.now();
    const intakeId = String(existing.intake_id);
    if (existing.user_edited_at == null) {
      const result = await this.database.prepare(`UPDATE intake_items SET
        workspace_id=?, workspace_key=?, intake_type=?, source_timestamp=?, source_sender=?, source_subject=?, source_url=?,
        source_summary=?, classification_reason=?, title=?, due_date=?, follow_up_at=?, priority=?, amount_minor=?, currency=?,
        target_payload_json=?, scan_run_id=?, updated_at=?
        WHERE intake_id=? AND user_id=? AND semantic_key=? AND status IN ('PENDING','DEFERRED')`)
        .bind(
          instance.workspaceId,
          instance.workspaceKey,
          input.intakeType,
          input.sourceTimestamp,
          input.sender ?? null,
          input.subject ?? null,
          input.sourceUrl ?? null,
          input.summary,
          input.classificationReason,
          input.title,
          input.dueDate ?? null,
          input.followUpAt ?? null,
          input.priority ?? null,
          input.amountMinor ?? null,
          input.currency ?? null,
          payloadForProposal(input),
          input.scanRunId,
          timestamp,
          intakeId,
          instance.userId,
          String(existing.semantic_key),
        ).run();
      if (!result.success) throw new Error("Intake persistence failed.");
    } else {
      const result = await this.database.prepare(`UPDATE intake_items SET
        source_timestamp=?, source_sender=?, source_subject=?, source_url=?, source_summary=?, classification_reason=?, scan_run_id=?, updated_at=?
        WHERE intake_id=? AND user_id=? AND semantic_key=? AND status IN ('PENDING','DEFERRED')`)
        .bind(
          input.sourceTimestamp,
          input.sender ?? null,
          input.subject ?? null,
          input.sourceUrl ?? null,
          input.summary,
          input.classificationReason,
          input.scanRunId,
          timestamp,
          intakeId,
          instance.userId,
          String(existing.semantic_key),
        ).run();
      if (!result.success) throw new Error("Intake persistence failed.");
    }

    const refreshed = await this.rowForSemantic(instance.userId, String(existing.semantic_key));
    if (!refreshed) throw new Error("Intake persistence failed.");
    return { status: "reused", item: itemFromRow(refreshed) };
  }

  async list(context: RequestContext, filter: IntakeListFilter = {}): Promise<HostedIntakeItem[]> {
    const instance = await this.authorize(context);
    const clauses = ["user_id=?", "workspace_id=?", "workspace_key=?"];
    const values: unknown[] = [instance.userId, instance.workspaceId, instance.workspaceKey];
    const now = this.now();

    if (filter.status === "PENDING") {
      clauses.push("(status='PENDING' OR (status='DEFERRED' AND defer_until IS NOT NULL AND defer_until<=?))");
      values.push(now);
    } else if (filter.status === "DEFERRED") {
      clauses.push("status='DEFERRED' AND defer_until IS NOT NULL AND defer_until>?");
      values.push(now);
    } else if (filter.status !== undefined) {
      clauses.push("status=?");
      values.push(filter.status);
    }
    if (filter.type !== undefined) {
      clauses.push("intake_type=?");
      values.push(filter.type);
    }
    if (filter.sourceKey !== undefined) {
      clauses.push("source_key=?");
      values.push(filter.sourceKey);
    }

    const result = await this.database.prepare(`SELECT ${rowColumns} FROM intake_items
      WHERE ${clauses.join(" AND ")}
      ORDER BY source_timestamp DESC, created_at DESC, intake_id`).bind(...values).all<Row>();
    if (!result.success) throw new Error("Intake read failed.");
    return (result.results ?? []).map(itemFromRow);
  }

  async get(context: RequestContext, intakeId: string): Promise<HostedIntakeItem | null> {
    assertId(intakeId, "Intake ID");
    const row = await this.exactRow(context, intakeId);
    return row ? itemFromRow(row) : null;
  }

  async edit(
    context: RequestContext,
    intakeId: string,
    patch: IntakeEditablePatch,
    destinationContext?: RequestContext,
  ): Promise<HostedIntakeItem> {
    assertPatchShape(patch);
    const row = await this.requireExactRow(context, intakeId);
    if (TERMINAL_STATUSES.has(String(row.status))) throw new Error("Intake item is in a terminal state.");

    const sourceInstance = requireHostedWorkspaceInstance(context);
    let destinationInstance = sourceInstance;
    const requestedWorkspace = patch.workspaceId ?? sourceInstance.workspaceKey;
    if (requestedWorkspace !== sourceInstance.workspaceKey) {
      if (!destinationContext) throw new Error("A separately authorized destination workspace is required.");
      destinationInstance = await this.authorize(destinationContext);
      if (destinationInstance.userId !== sourceInstance.userId || destinationInstance.workspaceKey !== requestedWorkspace) {
        throw new Error("Destination workspace access denied.");
      }
    } else if (destinationContext) {
      const checkedDestination = await this.authorize(destinationContext);
      if (checkedDestination.userId !== sourceInstance.userId || checkedDestination.workspaceKey !== requestedWorkspace) {
        throw new Error("Destination workspace access denied.");
      }
      destinationInstance = checkedDestination;
    }

    const current = itemFromRow(row);
    const title = patch.title ?? current.title;
    const dueDate = patch.dueDate === undefined ? current.dueDate : patch.dueDate;
    const followUpAt = patch.followUpAt === undefined ? current.followUpAt : patch.followUpAt;
    const priority = patch.priority === undefined ? current.priority : patch.priority;
    const amountMinor = patch.amountMinor === undefined ? current.amountMinor : patch.amountMinor;
    const currency = patch.currency === undefined ? current.currency : patch.currency;
    const recurrence = patch.recurrence === undefined ? current.recurrence : patch.recurrence;

    if (current.intakeType !== "BILL" && (amountMinor !== null || currency !== null || recurrence !== null)) {
      throw new Error("Only Bill proposals may include amount, currency, or recurrence.");
    }
    if ((amountMinor === null) !== (currency === null)) throw new Error("Bill amount and currency must be supplied together.");

    const targetPayload = JSON.stringify(recurrence ? { recurrence } : {});
    const timestamp = this.now();
    return this.persistAndRead(
      `UPDATE intake_items SET workspace_id=?, workspace_key=?, title=?, due_date=?, follow_up_at=?, priority=?,
       amount_minor=?, currency=?, target_payload_json=?, user_edited_at=?, updated_at=?
       WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=? AND status IN ('PENDING','DEFERRED')`,
      [
        destinationInstance.workspaceId,
        destinationInstance.workspaceKey,
        title,
        dueDate,
        followUpAt,
        priority,
        amountMinor,
        currency,
        targetPayload,
        timestamp,
        timestamp,
        intakeId,
        sourceInstance.userId,
        sourceInstance.workspaceId,
        sourceInstance.workspaceKey,
      ],
      { userId: sourceInstance.userId, workspaceId: destinationInstance.workspaceId, workspaceKey: destinationInstance.workspaceKey },
      intakeId,
    );
  }

  async defer(context: RequestContext, intakeId: string, until: string): Promise<HostedIntakeItem> {
    if (!isExactInstant(until)) throw new Error("Defer-until timestamp is invalid.");
    if (Date.parse(until) <= this.clock.now().getTime()) throw new Error("Defer-until timestamp must be in the future.");
    const row = await this.requireExactRow(context, intakeId);
    if (TERMINAL_STATUSES.has(String(row.status))) throw new Error("Intake item is in a terminal state.");
    const instance = requireHostedWorkspaceInstance(context);
    const timestamp = this.now();
    return this.persistAndRead(
      `UPDATE intake_items SET status='DEFERRED', defer_until=?, updated_at=?
       WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=? AND status IN ('PENDING','DEFERRED')`,
      [until, timestamp, intakeId, instance.userId, instance.workspaceId, instance.workspaceKey],
      context,
      intakeId,
    );
  }

  async dismiss(context: RequestContext, intakeId: string): Promise<HostedIntakeItem> {
    const row = await this.requireExactRow(context, intakeId);
    if (row.status === "DISMISSED") return itemFromRow(row);
    if (TERMINAL_STATUSES.has(String(row.status))) throw new Error("Intake item is in a terminal state.");
    const instance = requireHostedWorkspaceInstance(context);
    const timestamp = this.now();
    return this.persistAndRead(
      `UPDATE intake_items SET status='DISMISSED', defer_until=NULL, updated_at=?
       WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=? AND status IN ('PENDING','DEFERRED')`,
      [timestamp, intakeId, instance.userId, instance.workspaceId, instance.workspaceKey],
      context,
      intakeId,
    );
  }

  async archive(context: RequestContext, intakeId: string): Promise<HostedIntakeItem> {
    const row = await this.requireExactRow(context, intakeId);
    if (row.status === "ARCHIVED") return itemFromRow(row);
    if (TERMINAL_STATUSES.has(String(row.status))) throw new Error("Intake item is in a terminal state.");
    const instance = requireHostedWorkspaceInstance(context);
    const timestamp = this.now();
    return this.persistAndRead(
      `UPDATE intake_items SET status='ARCHIVED', defer_until=NULL, updated_at=?
       WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=? AND status IN ('PENDING','DEFERRED')`,
      [timestamp, intakeId, instance.userId, instance.workspaceId, instance.workspaceKey],
      context,
      intakeId,
    );
  }

  async markApproved(context: RequestContext, intakeId: string, target: ApprovedTarget): Promise<HostedIntakeItem> {
    assertId(target?.id, "Approved target ID");
    if (target.kind !== "TASK" && target.kind !== "BILL") throw new Error("Approved target kind is invalid.");
    const row = await this.requireExactRow(context, intakeId);
    const current = itemFromRow(row);

    if (current.status === "APPROVED") {
      if (current.approvedTargetKind === target.kind && current.approvedTargetId === target.id) return current;
      throw new Error("Intake item is already approved to a different target.");
    }
    if (current.status === "DISMISSED" || current.status === "ARCHIVED") {
      throw new Error("Intake item is in a terminal state.");
    }
    if (current.intakeType === "AWARENESS") throw new Error("Awareness items cannot be approved.");
    const expectedKind = current.intakeType === "BILL" ? "BILL" : "TASK";
    if (target.kind !== expectedKind) throw new Error(`${current.intakeType === "BILL" ? "Bill" : "Task"} Intake target kind does not match.`);

    const instance = requireHostedWorkspaceInstance(context);
    const timestamp = this.now();
    return this.persistAndRead(
      `UPDATE intake_items SET status='APPROVED', defer_until=NULL, approved_target_kind=?, approved_target_id=?, updated_at=?
       WHERE intake_id=? AND user_id=? AND workspace_id=? AND workspace_key=? AND status IN ('PENDING','DEFERRED')`,
      [target.kind, target.id, timestamp, intakeId, instance.userId, instance.workspaceId, instance.workspaceKey],
      context,
      intakeId,
    );
  }
}