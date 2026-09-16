import { incomePayDatesInRange } from "@/lib/runtime/income-schedule";
import {
  daysInMonth,
  isDateOnly,
  parseDateOnlyParts,
} from "@/lib/runtime/bills";
import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import { requireHostedWorkspaceInstance, type ProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import {
  validateCashflowBaselineInput,
  validateHostedIncomeDefinition,
  validateIncomeOccurrenceResolutionInput,
  type CashflowBaselineInput,
  type HostedCashflowBaseline,
  type HostedIncomeOccurrence,
  type HostedIncomeSource,
  type IncomeOccurrenceResolutionInput,
} from "@/lib/runtime/hosted-income";
import { resolveAuthorizedWorkspaceInstances } from "@/lib/server/d1-workspace-instances";

const PRODUCT_TIME_ZONE = "America/New_York";

type Row = Record<string, unknown>;

type OccurrenceFilter = Readonly<{
  incomeSourceId?: string | null;
  fromDate?: string | null;
  throughDate?: string | null;
}>;

const sourceColumns = `income_source_id, primary_workspace_id, name, payer, amount_mode, default_net_amount_minor,
  currency, schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode, semimonth_day_one,
  semimonth_day_two, status, created_by_user_id, created_at, updated_at`;

const occurrenceColumns = `occurrence_id, income_source_id, pay_date, expected_amount_minor, currency, status,
  received_amount_minor, received_on, resolved_by_user_id, resolved_at, resolution_note, created_at, updated_at`;
const selectedOccurrenceColumns = occurrenceColumns.split(",").map((column) => `o.${column.trim()}`).join(", ");

function sourceCoreFromRow(row: Row): IncomeDefinitionCore {
  return {
    name: String(row.name),
    payer: row.payer as string | null,
    amountMode: row.amount_mode as IncomeDefinitionCore["amountMode"],
    defaultNetAmountMinor: row.default_net_amount_minor == null ? null : Number(row.default_net_amount_minor),
    currency: String(row.currency),
    scheduleStartDate: String(row.schedule_start_date),
    recurrenceUnit: row.recurrence_unit as IncomeDefinitionCore["recurrenceUnit"],
    recurrenceInterval: Number(row.recurrence_interval),
    recurrenceDayMode: row.recurrence_day_mode as IncomeDefinitionCore["recurrenceDayMode"],
    semimonthDayOne: row.semimonth_day_one == null ? null : Number(row.semimonth_day_one),
    semimonthDayTwo: row.semimonth_day_two == null ? null : Number(row.semimonth_day_two),
    status: row.status as IncomeDefinitionCore["status"],
  };
}

function sourceFromRow(row: Row, workspaceKey: ProductWorkspaceId): HostedIncomeSource {
  return {
    incomeSourceId: String(row.income_source_id),
    primaryWorkspaceId: workspaceKey,
    ...sourceCoreFromRow(row),
    createdByUserId: row.created_by_user_id as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function occurrenceFromRow(row: Row): HostedIncomeOccurrence {
  return {
    occurrenceId: String(row.occurrence_id),
    incomeSourceId: String(row.income_source_id),
    payDate: String(row.pay_date),
    expectedAmountMinor: row.expected_amount_minor == null ? null : Number(row.expected_amount_minor),
    currency: String(row.currency),
    status: row.status as HostedIncomeOccurrence["status"],
    receivedAmountMinor: row.received_amount_minor == null ? null : Number(row.received_amount_minor),
    receivedOn: row.received_on as string | null,
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
  if (year < 1 || year > 9999) throw new Error("Income materialization horizon exceeded supported calendar range.");
  const day = Math.min(source.day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function occurrenceId(sourceId: string, payDate: string): string {
  return `${sourceId}:${payDate}`;
}

function sourceInsertValues(
  sourceId: string,
  physicalWorkspaceId: string,
  core: IncomeDefinitionCore,
  userId: string,
  timestamp: string,
) {
  return [
    sourceId, physicalWorkspaceId, core.name, core.payer, core.amountMode, core.defaultNetAmountMinor, core.currency,
    core.scheduleStartDate, core.recurrenceUnit, core.recurrenceInterval, core.recurrenceDayMode,
    core.semimonthDayOne, core.semimonthDayTwo, core.status, userId, timestamp, timestamp,
  ];
}

function occurrenceShapeChanged(previous: IncomeDefinitionCore, next: IncomeDefinitionCore): boolean {
  return previous.amountMode !== next.amountMode ||
    previous.defaultNetAmountMinor !== next.defaultNetAmountMinor ||
    previous.currency !== next.currency ||
    previous.scheduleStartDate !== next.scheduleStartDate ||
    previous.recurrenceUnit !== next.recurrenceUnit ||
    previous.recurrenceInterval !== next.recurrenceInterval ||
    previous.recurrenceDayMode !== next.recurrenceDayMode ||
    previous.semimonthDayOne !== next.semimonthDayOne ||
    previous.semimonthDayTwo !== next.semimonthDayTwo;
}

export class D1IncomeRepository {
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

  private async getSourceRow(sourceId: string, physicalWorkspaceId: string): Promise<Row | null> {
    return this.database.prepare(`SELECT ${sourceColumns} FROM income_sources
      WHERE income_source_id=? AND primary_workspace_id=?`)
      .bind(sourceId, physicalWorkspaceId).first<Row>();
  }

  private async getOccurrenceRow(occurrenceIdValue: string, physicalWorkspaceId: string): Promise<Row | null> {
    return this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM income_occurrences o
      JOIN income_sources s ON s.income_source_id=o.income_source_id
      WHERE o.occurrence_id=? AND s.primary_workspace_id=?`)
      .bind(occurrenceIdValue, physicalWorkspaceId).first<Row>();
  }

  private occurrenceInsertStatements(
    sourceId: string,
    core: IncomeDefinitionCore,
    dates: readonly string[],
    timestamp: string,
  ): D1PreparedStatement[] {
    return dates.map((payDate) => this.database.prepare(`INSERT OR IGNORE INTO income_occurrences
      (occurrence_id, income_source_id, pay_date, expected_amount_minor, currency, status,
       received_amount_minor, received_on, resolved_by_user_id, resolved_at, resolution_note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'EXPECTED', NULL, NULL, NULL, NULL, NULL, ?, ?)`)
      .bind(occurrenceId(sourceId, payDate), sourceId, payDate, core.defaultNetAmountMinor, core.currency, timestamp, timestamp));
  }

  private materializationDates(core: IncomeDefinitionCore, startDate: string, endDate: string): string[] {
    if (core.status !== "ACTIVE" || startDate > endDate || core.scheduleStartDate > endDate) return [];
    const actualStart = core.scheduleStartDate > startDate ? core.scheduleStartDate : startDate;
    return incomePayDatesInRange(core, { startDate: actualStart, endDate });
  }

  private defaultMaterializationStart(core: IncomeDefinitionCore, today: string): string {
    if (core.recurrenceUnit === "NONE") return core.scheduleStartDate;
    return core.scheduleStartDate > today ? core.scheduleStartDate : today;
  }

  async listSummary(includeArchived = false): Promise<Readonly<{
    incomeSources: HostedIncomeSource[];
    occurrences: HostedIncomeOccurrence[];
  }>> {
    const instance = await this.authorize();
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const archiveClause = includeArchived ? "" : "AND status <> 'ARCHIVED'";
    const sourceRows = (await this.database.prepare(`SELECT ${sourceColumns} FROM income_sources
      WHERE primary_workspace_id=? ${archiveClause} ORDER BY name, income_source_id`)
      .bind(instance.workspaceId).all<Row>()).results ?? [];
    const incomeSources = sourceRows.map((row) => sourceFromRow(row, instance.workspaceKey));

    const materialization = incomeSources.flatMap((source) => this.occurrenceInsertStatements(
      source.incomeSourceId,
      source,
      this.materializationDates(source, this.defaultMaterializationStart(source, today), horizon),
      timestamp,
    ));
    if (materialization.length > 0) {
      const results = await this.database.batch(materialization);
      if (results.some((result) => !result.success)) throw new Error("Income occurrence materialization failed.");
    }

    const occurrenceRows = (await this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM income_occurrences o
      JOIN income_sources s ON s.income_source_id=o.income_source_id
      WHERE s.primary_workspace_id=? AND o.status='EXPECTED' AND s.status='ACTIVE'
      ORDER BY o.pay_date, s.name, o.occurrence_id`)
      .bind(instance.workspaceId).all<Row>()).results ?? [];
    return { incomeSources, occurrences: occurrenceRows.map(occurrenceFromRow) };
  }

  async listOccurrences(filter: OccurrenceFilter = {}): Promise<HostedIncomeOccurrence[]> {
    const instance = await this.authorize();
    const where = ["s.primary_workspace_id=?"];
    const bindings: unknown[] = [instance.workspaceId];
    if (filter.incomeSourceId != null) {
      if (typeof filter.incomeSourceId !== "string" || filter.incomeSourceId.trim().length === 0) {
        throw new Error("Income source ID is invalid.");
      }
      where.push("o.income_source_id=?");
      bindings.push(filter.incomeSourceId);
    }
    if (filter.fromDate != null) {
      if (!isDateOnly(filter.fromDate)) throw new Error("fromDate must be an exact calendar date.");
      where.push("o.pay_date>=?");
      bindings.push(filter.fromDate);
    }
    if (filter.throughDate != null) {
      if (!isDateOnly(filter.throughDate)) throw new Error("throughDate must be an exact calendar date.");
      where.push("o.pay_date<=?");
      bindings.push(filter.throughDate);
    }
    if (filter.fromDate && filter.throughDate && filter.throughDate < filter.fromDate) {
      throw new Error("throughDate must not precede fromDate.");
    }
    const rows = (await this.database.prepare(`SELECT ${selectedOccurrenceColumns} FROM income_occurrences o
      JOIN income_sources s ON s.income_source_id=o.income_source_id WHERE ${where.join(" AND ")}
      ORDER BY o.pay_date, o.occurrence_id`).bind(...bindings).all<Row>()).results ?? [];
    return rows.map(occurrenceFromRow);
  }

  async create(core: IncomeDefinitionCore): Promise<Readonly<{
    incomeSource: HostedIncomeSource;
    occurrences: HostedIncomeOccurrence[];
  }>> {
    validateHostedIncomeDefinition(core);
    const instance = await this.authorize();
    const sourceId = this.ids.generate();
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) throw new Error("Income source ID generation failed.");
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const dates = this.materializationDates(core, this.defaultMaterializationStart(core, today), horizon);
    const values = sourceInsertValues(sourceId, instance.workspaceId, core, instance.userId, timestamp);
    const placeholders = values.map(() => "?").join(", ");
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`INSERT INTO income_sources (${sourceColumns}) VALUES (${placeholders})`).bind(...values),
      ...this.occurrenceInsertStatements(sourceId, core, dates, timestamp),
    ];
    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Income source creation failed.");

    const incomeSource: HostedIncomeSource = {
      incomeSourceId: sourceId,
      primaryWorkspaceId: instance.workspaceKey,
      ...core,
      createdByUserId: instance.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const occurrences = dates.map((payDate): HostedIncomeOccurrence => ({
      occurrenceId: occurrenceId(sourceId, payDate),
      incomeSourceId: sourceId,
      payDate,
      expectedAmountMinor: core.defaultNetAmountMinor,
      currency: core.currency,
      status: "EXPECTED",
      receivedAmountMinor: null,
      receivedOn: null,
      resolvedByUserId: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    return { incomeSource, occurrences };
  }

  async update(
    sourceId: string,
    core: IncomeDefinitionCore,
    effectiveDate: string | null = null,
  ): Promise<HostedIncomeSource> {
    validateHostedIncomeDefinition(core);
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) throw new Error("Income source ID is invalid.");
    const instance = await this.authorize();
    const existingRow = await this.getSourceRow(sourceId, instance.workspaceId);
    if (!existingRow) throw new Error("Income source not found.");
    const existing = sourceFromRow(existingRow, instance.workspaceKey);
    const shapeChanged = occurrenceShapeChanged(existing, core);
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);

    if (shapeChanged) {
      if (!isDateOnly(effectiveDate)) throw new Error("Occurrence-affecting income edits require an effectiveDate.");
      if (effectiveDate < today) throw new Error("Income edit effectiveDate cannot be before today.");
    } else if (effectiveDate !== null && !isDateOnly(effectiveDate)) {
      throw new Error("Income edit effectiveDate is invalid.");
    }

    const statements: D1PreparedStatement[] = [this.database.prepare(`UPDATE income_sources SET
      name=?, payer=?, amount_mode=?, default_net_amount_minor=?, currency=?, schedule_start_date=?, recurrence_unit=?,
      recurrence_interval=?, recurrence_day_mode=?, semimonth_day_one=?, semimonth_day_two=?, status=?, updated_at=?
      WHERE income_source_id=? AND primary_workspace_id=?`).bind(
      core.name, core.payer, core.amountMode, core.defaultNetAmountMinor, core.currency, core.scheduleStartDate,
      core.recurrenceUnit, core.recurrenceInterval, core.recurrenceDayMode, core.semimonthDayOne, core.semimonthDayTwo,
      core.status, timestamp, sourceId, instance.workspaceId,
    )];

    let generationStart = this.defaultMaterializationStart(core, today);
    if (shapeChanged) {
      generationStart = effectiveDate! > core.scheduleStartDate ? effectiveDate! : core.scheduleStartDate;
      statements.push(this.database.prepare(`DELETE FROM income_occurrences
        WHERE income_source_id=? AND status='EXPECTED' AND pay_date>=?`).bind(sourceId, effectiveDate));
    }
    const dates = this.materializationDates(core, generationStart, horizon);
    statements.push(...this.occurrenceInsertStatements(sourceId, core, dates, timestamp));

    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Income source update failed.");
    const savedRow = await this.getSourceRow(sourceId, instance.workspaceId);
    if (!savedRow) throw new Error("Income source update failed.");
    return sourceFromRow(savedRow, instance.workspaceKey);
  }

  async resolveOccurrence(
    occurrenceIdValue: string,
    input: IncomeOccurrenceResolutionInput,
  ): Promise<HostedIncomeOccurrence> {
    validateIncomeOccurrenceResolutionInput(input);
    if (typeof occurrenceIdValue !== "string" || occurrenceIdValue.trim().length === 0) {
      throw new Error("Income occurrence ID is invalid.");
    }
    const instance = await this.authorize();
    const existingRow = await this.getOccurrenceRow(occurrenceIdValue, instance.workspaceId);
    if (!existingRow) throw new Error("Income occurrence not found.");
    const existing = occurrenceFromRow(existingRow);
    if (existing.status !== "EXPECTED") throw new Error("Income occurrence is already resolved.");
    const sourceRow = await this.getSourceRow(existing.incomeSourceId, instance.workspaceId);
    if (!sourceRow) throw new Error("Income occurrence not found.");
    const source = sourceFromRow(sourceRow, instance.workspaceKey);

    const now = this.clock.now();
    const timestamp = now.toISOString();
    const today = dateInProductTimeZone(now);
    const horizon = addMonthsClamped(today, 12);
    const receivedOn = input.action === "RECEIVED" ? input.receivedOn! : null;
    const receivedAmountMinor = input.action === "RECEIVED" ? (input.receivedAmountMinor ?? null) : null;
    const note = input.resolutionNote ?? null;
    const statements: D1PreparedStatement[] = [this.database.prepare(`UPDATE income_occurrences SET
      status=?, received_amount_minor=?, received_on=?, resolved_by_user_id=?, resolved_at=?, resolution_note=?, updated_at=?
      WHERE occurrence_id=? AND status='EXPECTED' AND EXISTS (
        SELECT 1 FROM income_sources s
        WHERE s.income_source_id=income_occurrences.income_source_id AND s.primary_workspace_id=?
      )`).bind(
      input.action, receivedAmountMinor, receivedOn, instance.userId, timestamp, note, timestamp,
      occurrenceIdValue, instance.workspaceId,
    )];
    const dates = this.materializationDates(source, this.defaultMaterializationStart(source, today), horizon);
    statements.push(...this.occurrenceInsertStatements(source.incomeSourceId, source, dates, timestamp));
    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Income occurrence resolution failed.");

    const savedRow = await this.getOccurrenceRow(occurrenceIdValue, instance.workspaceId);
    if (!savedRow) throw new Error("Income occurrence resolution failed.");
    const saved = occurrenceFromRow(savedRow);
    if (saved.status !== input.action || saved.resolvedAt !== timestamp || saved.resolvedByUserId !== instance.userId) {
      throw new Error("Income occurrence is already resolved.");
    }
    return saved;
  }

  async getBaseline(): Promise<HostedCashflowBaseline | null> {
    const instance = await this.authorize();
    const row = await this.database.prepare(`SELECT primary_workspace_id, amount_minor, currency, as_of_date,
      updated_by_user_id, created_at, updated_at FROM cashflow_baselines WHERE primary_workspace_id=?`)
      .bind(instance.workspaceId).first<Row>();
    if (!row) return null;
    return {
      primaryWorkspaceId: instance.workspaceKey,
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      asOfDate: String(row.as_of_date),
      updatedByUserId: row.updated_by_user_id as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async saveBaseline(input: CashflowBaselineInput): Promise<HostedCashflowBaseline> {
    validateCashflowBaselineInput(input);
    const instance = await this.authorize();
    const now = this.clock.now();
    const today = dateInProductTimeZone(now);
    if (input.asOfDate > today) throw new Error("Cash-flow baseline as-of date cannot be after today.");
    const timestamp = now.toISOString();
    await this.database.prepare(`INSERT INTO cashflow_baselines
      (primary_workspace_id, amount_minor, currency, as_of_date, updated_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(primary_workspace_id) DO UPDATE SET
        amount_minor=excluded.amount_minor,
        currency=excluded.currency,
        as_of_date=excluded.as_of_date,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=excluded.updated_at`)
      .bind(instance.workspaceId, input.amountMinor, input.currency, input.asOfDate, instance.userId, timestamp, timestamp)
      .run();
    const saved = await this.getBaseline();
    if (!saved) throw new Error("Cash-flow baseline update failed.");
    return saved;
  }

  async clearBaseline(): Promise<void> {
    const instance = await this.authorize();
    await this.database.prepare("DELETE FROM cashflow_baselines WHERE primary_workspace_id=?")
      .bind(instance.workspaceId).run();
  }
}
