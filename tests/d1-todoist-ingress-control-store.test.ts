import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { D1TodoistIngressControlStore } from "@/lib/server/d1-todoist-ingress-control-store";

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
    this.sqlite.exec(readFileSync(new URL("../migrations/0011_todoist_ingress_control.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

const taskA = "2026-09-16T12:00:01.000Z";
const taskB = "2026-09-16T12:00:02.000Z";
const taskC = "2026-09-16T12:00:03.000Z";

test("Todoist ingress control state defaults empty and persists stable cursor plus cooldown", async () => {
  const d1 = new TestD1();
  const store = new D1TodoistIngressControlStore(d1);

  assert.deepEqual(await store.load(), {
    cursorAddedAt: null,
    cursorTaskId: null,
    cooldownUntilMs: null,
  });

  await store.save({
    cursorAddedAt: taskB,
    cursorTaskId: "task-b",
    cooldownUntilMs: 300_000,
  }, {
    runStartedAtMs: 60_000,
    observedAtMs: 120_000,
  });
  assert.deepEqual(await store.load(), {
    cursorAddedAt: taskB,
    cursorTaskId: "task-b",
    cooldownUntilMs: 300_000,
  });

  const rows = d1.sqlite.prepare("SELECT COUNT(*) AS count FROM todoist_ingress_control").get() as { count: number };
  assert.equal(rows.count, 1);
  d1.sqlite.close();
});

test("older overlapping run cannot rewind the cursor or clear a newer future cooldown", async () => {
  const d1 = new TestD1();
  const store = new D1TodoistIngressControlStore(d1);

  await store.save({
    cursorAddedAt: taskB,
    cursorTaskId: "task-b",
    cooldownUntilMs: 300_000,
  }, {
    runStartedAtMs: 60_000,
    observedAtMs: 120_000,
  });

  await store.save({
    cursorAddedAt: taskA,
    cursorTaskId: "task-a",
    cooldownUntilMs: null,
  }, {
    runStartedAtMs: 0,
    observedAtMs: 180_000,
  });

  assert.deepEqual(await store.load(), {
    cursorAddedAt: taskB,
    cursorTaskId: "task-b",
    cooldownUntilMs: 300_000,
  });

  await store.save({
    cursorAddedAt: taskC,
    cursorTaskId: "task-c",
    cooldownUntilMs: null,
  }, {
    runStartedAtMs: 360_000,
    observedAtMs: 360_000,
  });

  assert.deepEqual(await store.load(), {
    cursorAddedAt: taskC,
    cursorTaskId: "task-c",
    cooldownUntilMs: null,
  });
  d1.sqlite.close();
});
