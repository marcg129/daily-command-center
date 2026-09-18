import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { IntakeProposalInput } from "@/lib/runtime/daily-intake";
import type { RequestContext } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { D1IntakeRepository } from "@/lib/server/d1-intake-repository";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  private input() { return this.values as SQLInputValue[]; }
  async first<T>() { return (this.statement.get(...this.input()) as T | undefined) ?? null; }
  async all<T>() { return { success: true, results: this.statement.all(...this.input()) as T[] }; }
  async run<T>(): Promise<D1Result<T>> { this.statement.run(...this.input()); return { success: true }; }
}

class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0001_workspaces.sql",
      "0002_tasks.sql",
      "0003_collector_snapshots.sql",
      "0004_secrets_and_workspace_domains.sql",
      "0005_task_capture_metadata.sql",
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql",
      "0009_bills_and_obligations.sql",
      "0010_income_and_cashflow.sql",
      "0011_todoist_ingress_control.sql",
      "0012_daily_intake_events.sql",
      "0013_chat_history_intake.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now() { return new Date(this.current); }
  set(value: string) { this.current = new Date(value); }
}

class SequenceIds implements IdGenerator {
  private index = 0;
  generate() { this.index += 1; return `intake-${this.index}`; }
}

type UserContexts = Readonly<{
  personal: RequestContext;
  indelitech: RequestContext;
}>;

function addWorkspace(database: TestD1, workspaceId: string, name: string, type: "PERSONAL" | "BUSINESS") {
  database.sqlite.prepare(`INSERT INTO workspaces
    (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      workspaceId,
      name,
      type,
      type === "PERSONAL" ? "personal-tech-blue" : "indelitech-business",
      "2026-09-17T12:00:00Z",
      "2026-09-17T12:00:00Z",
    );
}

function addUser(database: TestD1, userId: string, suffix: string): UserContexts {
  const personalId = `personal:${suffix}`;
  const indelitechId = `indelitech:${suffix}`;
  addWorkspace(database, personalId, `${suffix} Personal`, "PERSONAL");
  addWorkspace(database, indelitechId, `${suffix} Indelitech`, "BUSINESS");
  database.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
    .run(userId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, ?, 'personal', 'OWNER', ?, ?)`)
    .run(userId, personalId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, ?, 'indelitech', 'OWNER', ?, ?)`)
    .run(userId, indelitechId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
  return {
    personal: { userId, workspaceId: personalId, workspaceKey: "personal" },
    indelitech: { userId, workspaceId: indelitechId, workspaceKey: "indelitech" },
  };
}

function proposal(overrides: Partial<IntakeProposalInput> = {}): IntakeProposalInput {
  return {
    scanRunId: "scan-morning",
    workspaceId: "personal",
    sourceKey: "personal_gmail",
    sourceType: "gmail",
    messageId: "msg-1",
    threadId: "thread-1",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-17T11:00:00-04:00",
    sender: "sender@example.com",
    subject: "Please reply",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/msg-1",
    intakeType: "TASK",
    title: "Reply to sender",
    summary: "The sender requested a reply.",
    classificationReason: "The source contains an explicit response request.",
    dueDate: "2026-09-19",
    ...overrides,
  };
}

function setup() {
  const database = new TestD1();
  const clock = new MutableClock(new Date("2026-09-17T16:00:00Z"));
  const ids = new SequenceIds();
  const repo = new D1IntakeRepository(database, clock, ids);
  const marc = addUser(database, "user:marc", "marc");
  const other = addUser(database, "user:other", "other");
  return { database, clock, repo, marc, other };
}

test("ingest derives semantic identity and reads only from the exact authorized workspace", async () => {
  const { database, repo, marc } = setup();
  const result = await repo.ingest(marc.personal, proposal());

  assert.equal(result.status, "created");
  assert.equal(result.item.intakeId, "intake-1");
  assert.equal(result.item.workspaceKey, "personal");
  assert.equal(result.item.status, "PENDING");
  assert.equal(result.item.semanticKey, "personal_gmail:message:msg-1:1");
  assert.equal(result.item.userEditedAt, null);

  const row = database.sqlite.prepare(
    "SELECT user_id, workspace_id, workspace_key, semantic_key FROM intake_items WHERE intake_id='intake-1'",
  ).get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, {
    user_id: "user:marc",
    workspace_id: "personal:marc",
    workspace_key: "personal",
    semantic_key: "personal_gmail:message:msg-1:1",
  });

  assert.deepEqual((await repo.list(marc.personal, { status: "PENDING" })).map((item) => item.intakeId), ["intake-1"]);
  assert.equal(await repo.get(marc.indelitech, "intake-1"), null);
  database.sqlite.close();
});

test("semantic replay reuses one Gmail slot while a new message or ordinal creates a new finding", async () => {
  const { database, repo, marc } = setup();
  const first = await repo.ingest(marc.personal, proposal());
  const replay = await repo.ingest(marc.personal, proposal({
    scanRunId: "scan-noon",
    sourceTimestamp: "2026-09-17T12:15:00-04:00",
    title: "Reply to sender with quote",
    summary: "The same source finding was observed again with more context.",
    classificationReason: "The explicit request remains actionable.",
  }));
  const nextMessage = await repo.ingest(marc.personal, proposal({
    messageId: "msg-2",
    scanRunId: "scan-evening",
    sourceTimestamp: "2026-09-17T17:00:00-04:00",
  }));
  const secondSlot = await repo.ingest(marc.personal, proposal({ proposalOrdinal: 2 }));

  assert.equal(replay.status, "reused");
  assert.equal(replay.item.intakeId, first.item.intakeId);
  assert.equal(replay.item.title, "Reply to sender with quote");
  assert.notEqual(nextMessage.item.intakeId, first.item.intakeId);
  assert.notEqual(secondSlot.item.intakeId, first.item.intakeId);
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM intake_items").get()?.count, 3);
  database.sqlite.close();
});

test("terminal findings never resurrect when the same semantic slot is delivered again", async () => {
  const { database, repo, marc } = setup();

  const dismissed = await repo.ingest(marc.personal, proposal({ messageId: "msg-dismissed" }));
  await repo.dismiss(marc.personal, dismissed.item.intakeId);
  const dismissedReplay = await repo.ingest(marc.personal, proposal({
    messageId: "msg-dismissed",
    title: "Changed source title",
    summary: "Changed source summary.",
  }));
  assert.equal(dismissedReplay.status, "terminal");
  assert.equal(dismissedReplay.item.status, "DISMISSED");
  assert.notEqual(dismissedReplay.item.title, "Changed source title");

  const approved = await repo.ingest(marc.personal, proposal({ messageId: "msg-approved" }));
  await repo.markApproved(marc.personal, approved.item.intakeId, { kind: "TASK", id: "task-123" });
  const approvedReplay = await repo.ingest(marc.personal, proposal({ messageId: "msg-approved" }));
  assert.equal(approvedReplay.status, "terminal");
  assert.equal(approvedReplay.item.status, "APPROVED");
  assert.equal(approvedReplay.item.approvedTargetId, "task-123");

  const archived = await repo.ingest(marc.personal, proposal({ messageId: "msg-archived" }));
  await repo.archive(marc.personal, archived.item.intakeId);
  const archivedReplay = await repo.ingest(marc.personal, proposal({ messageId: "msg-archived" }));
  assert.equal(archivedReplay.status, "terminal");
  assert.equal(archivedReplay.item.status, "ARCHIVED");
  database.sqlite.close();
});

test("manual workspace and proposal corrections survive later source replay while source evidence can refresh", async () => {
  const { database, repo, marc } = setup();
  const created = await repo.ingest(marc.personal, proposal());
  const edited = await repo.edit(
    marc.personal,
    created.item.intakeId,
    {
      workspaceId: "indelitech",
      title: "Send Indelitech response",
      dueDate: "2026-09-22",
      priority: "HIGH",
    },
    marc.indelitech,
  );
  assert.equal(edited.workspaceKey, "indelitech");
  assert.equal(edited.userEditedAt, "2026-09-17T16:00:00.000Z");

  const replay = await repo.ingest(marc.personal, proposal({
    scanRunId: "scan-noon",
    sourceTimestamp: "2026-09-17T12:30:00-04:00",
    title: "Source-suggested title should not win",
    dueDate: "2026-09-20",
    priority: "LOW",
    summary: "Updated source evidence after the user corrected the proposal.",
    classificationReason: "Updated source classification context.",
  }));

  assert.equal(replay.status, "reused");
  assert.equal(replay.item.workspaceKey, "indelitech");
  assert.equal(replay.item.title, "Send Indelitech response");
  assert.equal(replay.item.dueDate, "2026-09-22");
  assert.equal(replay.item.priority, "HIGH");
  assert.equal(replay.item.sourceSummary, "Updated source evidence after the user corrected the proposal.");
  assert.equal(replay.item.classificationReason, "Updated source classification context.");
  assert.equal(replay.item.sourceTimestamp, "2026-09-17T12:30:00-04:00");

  const row = database.sqlite.prepare("SELECT workspace_id, workspace_key FROM intake_items WHERE intake_id=?")
    .get(created.item.intakeId) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { workspace_id: "indelitech:marc", workspace_key: "indelitech" });
  database.sqlite.close();
});

test("workspace moves require a separately authorized destination context for the same user", async () => {
  const { database, repo, marc, other } = setup();
  const created = await repo.ingest(marc.personal, proposal());

  await assert.rejects(
    repo.edit(marc.personal, created.item.intakeId, { workspaceId: "indelitech" }),
    /destination|workspace access/i,
  );
  await assert.rejects(
    repo.edit(marc.personal, created.item.intakeId, { workspaceId: "indelitech" }, other.indelitech),
    /destination|workspace access|user/i,
  );
  assert.equal((await repo.get(marc.personal, created.item.intakeId))?.workspaceKey, "personal");
  database.sqlite.close();
});

test("deferred proposals disappear from Pending until their defer time and then resurface", async () => {
  const { database, clock, repo, marc } = setup();
  const created = await repo.ingest(marc.personal, proposal());
  await repo.defer(marc.personal, created.item.intakeId, "2026-09-18T12:00:00-04:00");

  assert.deepEqual(await repo.list(marc.personal, { status: "PENDING" }), []);
  assert.equal((await repo.list(marc.personal, { status: "DEFERRED" })).length, 1);

  clock.set("2026-09-18T16:01:00Z");
  assert.equal((await repo.list(marc.personal, { status: "PENDING" })).length, 1);
  assert.deepEqual(await repo.list(marc.personal, { status: "DEFERRED" }), []);
  database.sqlite.close();
});

test("Awareness items cannot be approved but can be dismissed or archived", async () => {
  const { database, repo, marc } = setup();
  const awareness = await repo.ingest(marc.personal, proposal({
    messageId: "msg-awareness",
    intakeType: "AWARENESS",
    title: "Service maintenance notice",
    dueDate: undefined,
  }));
  await assert.rejects(
    repo.markApproved(marc.personal, awareness.item.intakeId, { kind: "TASK", id: "task-awareness" }),
    /Awareness|approve/i,
  );
  assert.equal((await repo.dismiss(marc.personal, awareness.item.intakeId)).status, "DISMISSED");

  const awareness2 = await repo.ingest(marc.personal, proposal({
    messageId: "msg-awareness-2",
    intakeType: "AWARENESS",
    title: "Another notice",
    dueDate: undefined,
  }));
  assert.equal((await repo.archive(marc.personal, awareness2.item.intakeId)).status, "ARCHIVED");
  database.sqlite.close();
});

test("repository enforces cross-user and exact-workspace isolation on every user-facing mutation", async () => {
  const { database, repo, marc, other } = setup();
  const created = await repo.ingest(marc.personal, proposal());

  assert.equal(await repo.get(other.personal, created.item.intakeId), null);
  assert.deepEqual(await repo.list(other.personal, { status: "PENDING" }), []);
  await assert.rejects(repo.edit(other.personal, created.item.intakeId, { title: "Hijack" }), /not found/i);
  await assert.rejects(repo.defer(other.personal, created.item.intakeId, "2026-09-20T12:00:00-04:00"), /not found/i);
  await assert.rejects(repo.dismiss(other.personal, created.item.intakeId), /not found/i);
  await assert.rejects(repo.archive(other.personal, created.item.intakeId), /not found/i);
  await assert.rejects(repo.markApproved(other.personal, created.item.intakeId, { kind: "TASK", id: "task-x" }), /not found/i);

  await assert.rejects(repo.edit(marc.indelitech, created.item.intakeId, { title: "Wrong workspace" }), /not found/i);
  assert.equal((await repo.get(marc.personal, created.item.intakeId))?.title, "Reply to sender");
  database.sqlite.close();
});

test("approval target kind must match Intake type and terminal mutations fail closed", async () => {
  const { database, repo, marc } = setup();
  const task = await repo.ingest(marc.personal, proposal({ messageId: "task" }));
  await assert.rejects(repo.markApproved(marc.personal, task.item.intakeId, { kind: "BILL", id: "bill-x" }), /target|Task/i);

  const bill = await repo.ingest(marc.personal, proposal({
    messageId: "bill",
    intakeType: "BILL",
    title: "Pay renewal",
    dueDate: "2026-09-30",
    amountMinor: 14900,
    currency: "USD",
  }));
  await assert.rejects(repo.markApproved(marc.personal, bill.item.intakeId, { kind: "TASK", id: "task-x" }), /target|Bill/i);

  await repo.dismiss(marc.personal, task.item.intakeId);
  await assert.rejects(repo.edit(marc.personal, task.item.intakeId, { title: "Too late" }), /terminal|state|resolved/i);
  await assert.rejects(repo.defer(marc.personal, task.item.intakeId, "2026-09-20T12:00:00-04:00"), /terminal|state|resolved/i);
  database.sqlite.close();
});

test("chat-history semantic replay deduplicates one historical candidate without pretending it is Gmail", async () => {
  const { database, repo, marc } = setup();
  const base: IntakeProposalInput = {
    scanRunId: "chat-history-2026-09-18",
    workspaceId: "personal",
    sourceKey: "chat_history",
    sourceType: "chat",
    chatItemId: "career-auraone-submit",
    chatThreadId: "job-search-side-gigs",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-07T15:57:58Z",
    subject: "AuraOne application",
    intakeType: "TASK",
    title: "Finish and submit AuraOne application",
    summary: "The application was at final review/submission.",
    classificationReason: "A concrete unresolved application action remains.",
    priority: "HIGH",
  };
  const first = await repo.ingest(marc.personal, base);
  const replay = await repo.ingest(marc.personal, { ...base, summary: "Updated historical evidence." });

  assert.equal(first.status, "created");
  assert.equal(replay.status, "reused");
  assert.equal(replay.item.intakeId, first.item.intakeId);
  assert.equal(replay.item.sourceType, "chat");
  assert.equal(replay.item.sourceKey, "chat_history");
  assert.equal(replay.item.semanticKey, "chat_history:chat:career-auraone-submit:1");
  assert.equal(replay.item.sourceMessageId, "career-auraone-submit");
  assert.equal(replay.item.sourceThreadId, "job-search-side-gigs");
  database.sqlite.close();
});
