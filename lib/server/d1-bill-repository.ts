import { billDueDatesInRange } from "@/lib/runtime/bill-schedule";
import {
  daysInMonth,
  isDateOnly,
  parseDateOnlyParts,
  type BillDefinitionCore,
} from "@/lib/runtime/bills";
import { requireHostedWorkspaceInstance, type ProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import {
  validateBillOccurrenceResolutionInput,
  validateHostedBillDefinition,
  type BillOccurrenceResolutionInput,
  type HostedBill,
  type HostedBillOccurrence,
} from "@/lib/runtime/hosted-bills";
import { resolveAuthorizedWorkspaceInstances } from "@/lib/server/d1-workspace-instances";

const PRODUCT_TIME_ZONE = "America/New_York";

type Row = Record<string, unknown>;

type OccurrenceFilter = Readonly<{
  billId?: string | null;
  fromDate?: string | null;
  throughDate?: string | null;
}>;

const billColumns = `bill_id, primary_workspace_id, name, payee, category, amount_mode, default_amount_minor, currency,
  autopay, payment_url, notes, schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode,
  reminder_days_before, status, created_by_user_id, created_at, updated_at`;

const occurrenceColumns = `occurrence_id, bill_id, due_date, expected_amount_minor, currency, status, paid_amount_minor,
  paid_on, resolved_by_user_id, resolved_at, resolution_note, created_at, updated_at`;
const selectedOccurrenceColumns = occurrenceColumns.split(",").map((column) => `o.${column.trim()}`).join(", ");

function billCoreFromRow(row: Row): BillDefinitionCore {
  return {
    name: String(row.name),
    payee: row.payee as string | null,
    category: row.category as string | null,
    amountMode: row.amount_mode as BillDefinitionCore["amountMode"],
    defaultAmountMinor: row.default_amount_minor == null ? null : Number(row.default_amount_minor),
    currency: String(row.currency),
    autopay: Number(row.autopay) === 1,
    paymentUrl: row.payment_url as string | null,
    notes: row.notes as string | null,
    scheduleStartDate: String(row.schedule_start_date),
    recurrenceUnit: row.recurrence_unit as BillDefinitionCore["recurrenceUnit"],
    recurrenceInterval: Number(row.recurrence_interval),
    recurrenceDayMode: row.recurrence_day_mode as BillDefinitionCore["recurrenceDayMode"],
    reminderDaysBefore: row.reminder_days_before == null ? null : Number(row.reminder_days_before),
    status: row.status as BillDefinitionCore["status"],
  };
}

function billFromRow(row: Row, workspaceKey: ProductWorkspaceId): HostedBill {
  return {
    billId: String(row.bill_id),
    primaryWorkspaceId: workspaceKey,
    ...billCoreFromRow(row),
    createdByUserId: row.created_by_user_id as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function occurrenceFromRow(row: Row): HostedBillOccurrence {
  return {
    occurrenceId: String(row.occurrence_id),
    billId: String(row.bill_id),
    dueDate: String(row.due_date),
    expectedAmountMinor: row.expected_amount_minor == null ? null : Number(row.expected_amount_minor),
    currency: String(row.currency),
    status: row.status as HostedBillOccurrence["status"],
    paidAmountMinor: row.paid_amount_minor == null ? null : Number(row.paid_amount_minor),
    paidOn: row.paid_on as string | null,
    resolvedByUserId: row.resolved_by_user_id as string | null,
    resolvedAt: row.resolved_at as string | null,
    resolutionNote: row.resolution_note as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function dateInProductTimeZone(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addMonthsClamped(dateOnly: string, months: number): string {
  const source = parseDateOnlyParts(dateOnly);
  const absolute = source.year * 12 + (source.month - 1) + months;
  const year = Math.floor(absolute / 12);
  const month = (absolute % 12) + 1;
  if (year < 1 || year > 9999) throw new Error("Bill materialization horizon exceeded supported calendar range.");
  const day = Math.min(source.day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function occurrenceId(billId: string, dueDate: string): string {
  return `${billId}:${dueDate}`;
}

function billInsertValues(
  billId: string,
  physicalWorkspaceId: string,
  core: BillDefinitionCore,
  userId: string,
  timestamp: string,
) {
  return [
    billId, physicalWorkspaceId, core.name, core.payee, core.category, core.amountMode, core.defaultAmountMinor,
    core.currency, core.autopay ? 1 : 0, core.paymentUrl, core.notes, core.scheduleStartDate, core.recurrenceUnit,
    core.recurrenceInterval, core.recurrenceDayMode, core.reminderDaysBefore, core.status, userId, timestamp, timestamp,
  ];
}

function occurrenceShapeChanged(previous: BillDefinitionCore, next: BillDefinitionCore): boolean {
  return previous.amountMode !== next.amountMode ||
    previous.defaultAmountMinor !== next.defaultAmountMinor ||
    previous.currency !== next.currency ||
    previous.scheduleStartDate !== next.scheduleStartDate ||
    previous.recurrenceUnit !== next.recurrenceUnit ||
    previous.recurrenceInterval !== next.recurrenceInterval ||
    previous.recurrenceDayMode !== next.recurrenceDayMode;
}

export class D1BillRepository {
  constructor(
    private readonly database: D1Database,
    private readonly context: RequestContext,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  private async authorize() {
    const instance = requireHostedWorkspaceInstance(this.context);
    await resolveAuthorizedWorkspaceInstances(this.database, this.context, [instance.workspaceKey]);
    return instance;
  }

  private async getBillRow(billId: string, physicalWorkspaceId: string): Promise<Row | null> {
    return this.database.prepare(`SELECT ${billColumns} FROM bills WHERE bill_id=? AND primary_workspace_id=?`)
      .bind(billId, physicalWorkspaceId).first<Row>();
  }

  private async getOccurrenceRow(occurrenceIdValue: string, physicalWorkspaceId: string): Promise<Row | null> {
    return this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM bill_occurrences o
      JOIN bills b ON b.bill_id=o.bill_id
      WHERE o.occurrence_id=? AND b.primary_workspace_id=?`)
      .bind(occurrenceIdValue, physicalWorkspaceId).first<Row>();
  }

  private occurrenceInsertStatements(
    billId: string,
    core: BillDefinitionCore,
    dates: readonly string[],
    timestamp: string,
  ): D1PreparedStatement[] {
    return dates.map((dueDate) => this.database.prepare(`INSERT OR IGNORE INTO bill_occurrences
      (occurrence_id, bill_id, due_date, expected_amount_minor, currency, status, paid_amount_minor, paid_on,
       resolved_by_user_id, resolved_at, resolution_note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, NULL, NULL, NULL, NULL, ?, ?)`)
      .bind(occurrenceId(billId, dueDate), billId, dueDate, core.defaultAmountMinor, core.currency, timestamp, timestamp));
  }

  private materializationDates(core: BillDefinitionCore, startDate: string, endDate: string): string[] {
    if (core.status !== "ACTIVE" || startDate > endDate || core.scheduleStartDate > endDate) return [];
    const actualStart = core.scheduleStartDate > startDate ? core.scheduleStartDate : startDate;
    return billDueDatesInRange(core, { startDate: actualStart, endDate });
  }

  private defaultMaterializationStart(core: BillDefinitionCore, today: string): string {
    if (core.recurrenceUnit === "NONE") return core.scheduleStartDate;
    return core.scheduleStartDate > today ? core.scheduleStartDate : today;
  }

  async listSummary(includeArchived = false): Promise<Readonly<{ bills: HostedBill[]; occurrences: HostedBillOccurrence[] }>> {
    const instance = await this.authorize();
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const archiveClause = includeArchived ? "" : "AND status <> 'ARCHIVED'";
    const billRows = (await this.database.prepare(`SELECT ${billColumns} FROM bills
      WHERE primary_workspace_id=? ${archiveClause} ORDER BY name, bill_id`)
      .bind(instance.workspaceId).all<Row>()).results ?? [];
    const bills = billRows.map((row) => billFromRow(row, instance.workspaceKey));

    const materialization = bills.flatMap((bill) => this.occurrenceInsertStatements(
      bill.billId,
      bill,
      this.materializationDates(bill, this.defaultMaterializationStart(bill, today), horizon),
      timestamp,
    ));
    if (materialization.length > 0) {
      const results = await this.database.batch(materialization);
      if (results.some((result) => !result.success)) throw new Error("Bill occurrence materialization failed.");
    }

    const occurrenceArchiveClause = includeArchived ? "" : "AND b.status <> 'ARCHIVED'";
    const occurrenceRows = (await this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM bill_occurrences o
      JOIN bills b ON b.bill_id=o.bill_id
      WHERE b.primary_workspace_id=? AND o.status='OPEN' ${occurrenceArchiveClause}
      ORDER BY o.due_date, b.name, o.occurrence_id`)
      .bind(instance.workspaceId).all<Row>()).results ?? [];
    return { bills, occurrences: occurrenceRows.map(occurrenceFromRow) };
  }

  async listOccurrences(filter: OccurrenceFilter = {}): Promise<HostedBillOccurrence[]> {
    const instance = await this.authorize();
    const where = ["b.primary_workspace_id=?"];
    const bindings: unknown[] = [instance.workspaceId];
    if (filter.billId != null) {
      if (typeof filter.billId !== "string" || filter.billId.trim().length === 0) throw new Error("Bill ID is invalid.");
      where.push("o.bill_id=?");
      bindings.push(filter.billId);
    }
    if (filter.fromDate != null) {
      if (!isDateOnly(filter.fromDate)) throw new Error("fromDate must be an exact calendar date.");
      where.push("o.due_date>=?");
      bindings.push(filter.fromDate);
    }
    if (filter.throughDate != null) {
      if (!isDateOnly(filter.throughDate)) throw new Error("throughDate must be an exact calendar date.");
      where.push("o.due_date<=?");
      bindings.push(filter.throughDate);
    }
    if (filter.fromDate && filter.throughDate && filter.throughDate < filter.fromDate) {
      throw new Error("throughDate must not precede fromDate.");
    }
    const rows = (await this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM bill_occurrences o
      JOIN bills b ON b.bill_id=o.bill_id WHERE ${where.join(" AND ")}
      ORDER BY o.due_date, o.occurrence_id`).bind(...bindings).all<Row>()).results ?? [];
    return rows.map(occurrenceFromRow);
  }

  async create(core: BillDefinitionCore): Promise<Readonly<{ bill: HostedBill; occurrences: HostedBillOccurrence[] }>> {
    validateHostedBillDefinition(core);
    const instance = await this.authorize();
    const billId = this.ids.generate();
    if (typeof billId !== "string" || billId.trim().length === 0) throw new Error("Bill ID generation failed.");
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const dates = this.materializationDates(core, this.defaultMaterializationStart(core, today), horizon);
    const values = billInsertValues(billId, instance.workspaceId, core, instance.userId, timestamp);
    const placeholders = values.map(() => "?").join(", ");
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`INSERT INTO bills (${billColumns}) VALUES (${placeholders})`).bind(...values),
      ...this.occurrenceInsertStatements(billId, core, dates, timestamp),
    ];
    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Bill creation failed.");

    const bill: HostedBill = {
      billId,
      primaryWorkspaceId: instance.workspaceKey,
      ...core,
      createdByUserId: instance.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const occurrences = dates.map((dueDate): HostedBillOccurrence => ({
      occurrenceId: occurrenceId(billId, dueDate), billId, dueDate,
      expectedAmountMinor: core.defaultAmountMinor, currency: core.currency, status: "OPEN",
      paidAmountMinor: null, paidOn: null, resolvedByUserId: null, resolvedAt: null, resolutionNote: null,
      createdAt: timestamp, updatedAt: timestamp,
    }));
    return { bill, occurrences };
  }

  async update(
    billId: string,
    core: BillDefinitionCore,
    effectiveDate: string | null = null,
  ): Promise<HostedBill> {
    validateHostedBillDefinition(core);
    if (typeof billId !== "string" || billId.trim().length === 0) throw new Error("Bill ID is invalid.");
    const instance = await this.authorize();
    const existingRow = await this.getBillRow(billId, instance.workspaceId);
    if (!existingRow) throw new Error("Bill not found.");
    const existing = billFromRow(existingRow, instance.workspaceKey);
    const shapeChanged = occurrenceShapeChanged(existing, core);
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);

    if (shapeChanged) {
      if (!isDateOnly(effectiveDate)) throw new Error("Occurrence-affecting bill edits require an effectiveDate.");
      if (effectiveDate < today) throw new Error("Bill edit effectiveDate cannot be before today.");
    } else if (effectiveDate !== null && !isDateOnly(effectiveDate)) {
      throw new Error("Bill edit effectiveDate is invalid.");
    }

    const statements: D1PreparedStatement[] = [this.database.prepare(`UPDATE bills SET
      name=?, payee=?, category=?, amount_mode=?, default_amount_minor=?, currency=?, autopay=?, payment_url=?, notes=?,
      schedule_start_date=?, recurrence_unit=?, recurrence_interval=?, recurrence_day_mode=?, reminder_days_before=?, status=?, updated_at=?
      WHERE bill_id=? AND primary_workspace_id=?`).bind(
      core.name, core.payee, core.category, core.amountMode, core.defaultAmountMinor, core.currency, core.autopay ? 1 : 0,
      core.paymentUrl, core.notes, core.scheduleStartDate, core.recurrenceUnit, core.recurrenceInterval,
      core.recurrenceDayMode, core.reminderDaysBefore, core.status, timestamp, billId, instance.workspaceId,
    )];

    let generationStart = this.defaultMaterializationStart(core, today);
    if (shapeChanged) {
      generationStart = effectiveDate! > core.scheduleStartDate ? effectiveDate! : core.scheduleStartDate;
      statements.push(this.database.prepare(`DELETE FROM bill_occurrences
        WHERE bill_id=? AND status='OPEN' AND due_date>=?`).bind(billId, effectiveDate));
    }
    const dates = this.materializationDates(core, generationStart, horizon);
    statements.push(...this.occurrenceInsertStatements(billId, core, dates, timestamp));

    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Bill update failed.");
    const savedRow = await this.getBillRow(billId, instance.workspaceId);
    if (!savedRow) throw new Error("Bill update failed.");
    return billFromRow(savedRow, instance.workspaceKey);
  }

  async resolveOccurrence(
    occurrenceIdValue: string,
    input: BillOccurrenceResolutionInput,
  ): Promise<HostedBillOccurrence> {
    validateBillOccurrenceResolutionInput(input);
    if (typeof occurrenceIdValue !== "string" || occurrenceIdValue.trim().length === 0) {
      throw new Error("Bill occurrence ID is invalid.");
    }
    const instance = await this.authorize();
    const existingRow = await this.getOccurrenceRow(occurrenceIdValue, instance.workspaceId);
    if (!existingRow) throw new Error("Bill occurrence not found.");
    const existing = occurrenceFromRow(existingRow);
    if (existing.status !== "OPEN") throw new Error("Bill occurrence is already resolved.");
    const billRow = await this.getBillRow(existing.billId, instance.workspaceId);
    if (!billRow) throw new Error("Bill occurrence not found.");
    const bill = billFromRow(billRow, instance.workspaceKey);

    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const paidOn = input.action === "PAID" ? input.paidOn! : null;
    const paidAmountMinor = input.action === "PAID" ? (input.paidAmountMinor ?? null) : null;
    const note = input.resolutionNote ?? null;
    const statements: D1PreparedStatement[] = [this.database.prepare(`UPDATE bill_occurrences SET
      status=?, paid_amount_minor=?, paid_on=?, resolved_by_user_id=?, resolved_at=?, resolution_note=?, updated_at=?
      WHERE occurrence_id=? AND status='OPEN' AND EXISTS (
        SELECT 1 FROM bills b WHERE b.bill_id=bill_occurrences.bill_id AND b.primary_workspace_id=?
      )`).bind(
      input.action, paidAmountMinor, paidOn, instance.userId, timestamp, note, timestamp,
      occurrenceIdValue, instance.workspaceId,
    )];
    const dates = this.materializationDates(bill, this.defaultMaterializationStart(bill, today), horizon);
    statements.push(...this.occurrenceInsertStatements(bill.billId, bill, dates, timestamp));
    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Bill occurrence resolution failed.");

    const savedRow = await this.getOccurrenceRow(occurrenceIdValue, instance.workspaceId);
    if (!savedRow) throw new Error("Bill occurrence resolution failed.");
    const saved = occurrenceFromRow(savedRow);
    if (saved.status !== input.action || saved.resolvedAt !== timestamp || saved.resolvedByUserId !== instance.userId) {
      throw new Error("Bill occurrence is already resolved.");
    }
    return saved;
  }
}
