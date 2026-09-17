import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext } from "../lib/runtime/context";
import type { HostedTaskRepository } from "../lib/runtime/hosted-task-repository";
import type { HostedTask } from "../lib/runtime/hosted-tasks";
import type {
  ApprovedTarget,
  HostedIntakeItem,
  IntakeIngestResult,
  IntakeRepository,
} from "../lib/runtime/intake-repository";
import type { BillDefinitionCore } from "../lib/runtime/bills";
import type { HostedBill, HostedBillOccurrence } from "../lib/runtime/hosted-bills";
import { createIntakeApprovalService } from "../lib/server/intake-approval-service";

const personal: RequestContext = { userId: "user:marc", workspaceId: "personal", workspaceKey: "personal" };
const indelitech: RequestContext = { userId: "user:marc", workspaceId: "indelitech", workspaceKey: "indelitech" };
const clock = { now: () => new Date("2026-09-17T17:00:00.000Z") };

function item(overrides: Partial<HostedIntakeItem> = {}): HostedIntakeItem {
  return {
    intakeId: "intake-1",
    userId: "user:marc",
    workspaceKey: "personal",
    intakeType: "TASK",
    status: "PENDING",
    sourceType: "gmail",
    sourceKey: "personal_gmail",
    sourceMessageId: "msg-1",
    sourceThreadId: "thread-1",
    sourceEventId: null,
    sourceSeriesId: null,
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-17T16:30:00Z",
    sourceSender: "sender@example.com",
    sourceSubject: "Please reply",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/msg-1",
    sourceSummary: "The sender asked for a reply.",
    classificationReason: "A direct response was requested.",
    title: "Reply to sender",
    dueDate: null,
    followUpAt: null,
    priority: null,
    amountMinor: null,
    currency: null,
    recurrence: null,
    semanticKey: "personal_gmail:message:msg-1:1",
    scanRunId: "scan-1",
    userEditedAt: null,
    deferUntil: null,
    approvedTargetKind: null,
    approvedTargetId: null,
    createdAt: "2026-09-17T16:31:00Z",
    updatedAt: "2026-09-17T16:31:00Z",
    ...overrides,
  };
}

class FakeIntakeRepository implements IntakeRepository {
  constructor(public current: HostedIntakeItem) {}
  async ingest(): Promise<IntakeIngestResult> { throw new Error("unused"); }
  async list() { return [this.current]; }
  async get(context: RequestContext, intakeId: string) {
    if (intakeId !== this.current.intakeId || context.userId !== this.current.userId || context.workspaceKey !== this.current.workspaceKey) return null;
    return this.current;
  }
  async edit(): Promise<HostedIntakeItem> { throw new Error("unused"); }
  async defer(): Promise<HostedIntakeItem> { throw new Error("unused"); }
  async dismiss(): Promise<HostedIntakeItem> { throw new Error("unused"); }
  async archive(): Promise<HostedIntakeItem> { throw new Error("unused"); }
  async markApproved(context: RequestContext, intakeId: string, target: ApprovedTarget) {
    if (context.workspaceKey !== this.current.workspaceKey || intakeId !== this.current.intakeId) throw new Error("Intake item not found.");
    if (this.current.status === "APPROVED") {
      if (this.current.approvedTargetKind === target.kind && this.current.approvedTargetId === target.id) return this.current;
      throw new Error("Intake item is already approved to a different target.");
    }
    this.current = { ...this.current, status: "APPROVED", approvedTargetKind: target.kind, approvedTargetId: target.id };
    return this.current;
  }
}

class FakeTaskRepository implements HostedTaskRepository {
  readonly rows = new Map<string, HostedTask>();
  async list() { return [...this.rows.values()]; }
  async get(_context: RequestContext, taskId: string) { return this.rows.get(taskId) ?? null; }
  async create(_context: RequestContext, task: HostedTask) { this.rows.set(task.taskId, task); return task; }
  async update(_context: RequestContext, task: HostedTask) { this.rows.set(task.taskId, task); return task; }
}

type BillCreateOptions = Readonly<{ sourceIntakeId?: string }>;
type BillCreateResult = Readonly<{ bill: HostedBill; occurrences: HostedBillOccurrence[] }>;

class FakeBillRepository {
  readonly byIntake = new Map<string, BillCreateResult>();
  readonly creates: Array<{ core: BillDefinitionCore; options?: BillCreateOptions }> = [];
  async create(core: BillDefinitionCore, options?: BillCreateOptions): Promise<BillCreateResult> {
    const key = options?.sourceIntakeId;
    if (key && this.byIntake.has(key)) return this.byIntake.get(key)!;
    this.creates.push({ core, options });
    const bill: HostedBill = {
      billId: `bill-${this.creates.length}`,
      primaryWorkspaceId: "personal",
      ...core,
      createdByUserId: "user:marc",
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    };
    const result = { bill, occurrences: [] };
    if (key) this.byIntake.set(key, result);
    return result;
  }
}

function service(current: HostedIntakeItem, billRepository = new FakeBillRepository()) {
  const intake = new FakeIntakeRepository(current);
  const tasks = new FakeTaskRepository();
  return {
    intake,
    tasks,
    billRepository,
    approve: createIntakeApprovalService({
      intakeRepository: intake,
      taskRepository: tasks,
      billRepositoryForContext: () => billRepository,
      clock,
    }),
  };
}

test("Task approval creates exactly one canonical structured-capture task and then marks Intake approved", async () => {
  const harness = service(item({ dueDate: "2026-09-22", priority: "HIGH" }));
  const approved = await harness.approve(personal, "intake-1");
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedTargetKind, "TASK");
  assert.equal(harness.tasks.rows.size, 1);
  const task = [...harness.tasks.rows.values()][0];
  assert.equal(task.taskId, "capture:intake:intake-1");
  assert.equal(task.title, "Reply to sender");
  assert.equal(task.dueAt, "2026-09-22");
  assert.equal(task.priority, "HIGH");
  assert.equal(task.sourceContext, "The sender asked for a reply.");
});

test("Follow-up approval creates a canonical Task with follow-up timing and no reminder invention", async () => {
  const harness = service(item({ intakeType: "FOLLOW_UP", followUpAt: "2026-09-20T14:00:00-04:00" }));
  await harness.approve(personal, "intake-1");
  const task = [...harness.tasks.rows.values()][0];
  assert.equal(task.followUpAt, "2026-09-20T18:00:00.000Z");
  assert.equal(task.remindAt, null);
});

test("Bill approval requires source-supported canonical fields and is linked idempotently to its Intake", async () => {
  const bills = new FakeBillRepository();
  const harness = service(item({
    intakeType: "BILL",
    title: "Pay annual renewal",
    dueDate: "2026-09-30",
    amountMinor: 14900,
    currency: "USD",
  }), bills);
  const approved = await harness.approve(personal, "intake-1");
  assert.equal(approved.approvedTargetKind, "BILL");
  assert.equal(bills.creates.length, 1);
  assert.equal(bills.creates[0].options?.sourceIntakeId, "intake-1");
  assert.deepEqual(bills.creates[0].core, {
    name: "Pay annual renewal",
    payee: null,
    category: null,
    amountMode: "FIXED",
    defaultAmountMinor: 14900,
    currency: "USD",
    autopay: false,
    paymentUrl: null,
    notes: "The sender asked for a reply.",
    scheduleStartDate: "2026-09-30",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    reminderDaysBefore: null,
    status: "ACTIVE",
  });
});

test("approval rejects Awareness, terminal Intake, workspace mismatch, and incomplete Bill data without canonical writes", async () => {
  for (const current of [
    item({ intakeType: "AWARENESS" }),
    item({ status: "DISMISSED" }),
  ]) {
    const harness = service(current);
    await assert.rejects(harness.approve(personal, "intake-1"));
    assert.equal(harness.tasks.rows.size, 0);
    assert.equal(harness.billRepository.creates.length, 0);
  }

  const mismatch = service(item({ workspaceKey: "indelitech", sourceKey: "indelitech_gmail" }));
  await assert.rejects(mismatch.approve(personal, "intake-1"), /not found|workspace|access/i);
  assert.equal(mismatch.tasks.rows.size, 0);

  const incomplete = service(item({ intakeType: "BILL", amountMinor: null, currency: null, dueDate: null }));
  await assert.rejects(incomplete.approve(personal, "intake-1"), /Bill.*due date|currency|amount/i);
  assert.equal(incomplete.billRepository.creates.length, 0);
});

test("retry after canonical Task persistence but before Intake update reuses the same canonical target", async () => {
  const intake = new FakeIntakeRepository(item());
  const tasks = new FakeTaskRepository();
  let failMark = true;
  const originalMark = intake.markApproved.bind(intake);
  intake.markApproved = async (...args) => {
    if (failMark) { failMark = false; throw new Error("simulated post-canonical timeout"); }
    return originalMark(...args);
  };
  const bills = new FakeBillRepository();
  const approve = createIntakeApprovalService({
    intakeRepository: intake,
    taskRepository: tasks,
    billRepositoryForContext: () => bills,
    clock,
  });

  await assert.rejects(approve(personal, "intake-1"), /timeout/);
  assert.equal(tasks.rows.size, 1);
  const retried = await approve(personal, "intake-1");
  assert.equal(tasks.rows.size, 1);
  assert.equal(retried.approvedTargetId, "capture:intake:intake-1");
});

test("Bill approval never crosses the authorized workspace boundary", async () => {
  const bills = new FakeBillRepository();
  const harness = service(item({
    workspaceKey: "indelitech",
    sourceKey: "indelitech_gmail",
    intakeType: "BILL",
    dueDate: "2026-09-30",
    amountMinor: 25000,
    currency: "USD",
  }), bills);
  await assert.rejects(harness.approve(personal, "intake-1"));
  assert.equal(bills.creates.length, 0);
  const approved = await harness.approve(indelitech, "intake-1");
  assert.equal(approved.workspaceKey, "indelitech");
  assert.equal(bills.creates.length, 1);
});
