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

test("Todoist ingress control state defaults empty and persists cooldown plus rotation", async () => {
  const d1 = new TestD1();
  const store = new D1TodoistIngressControlStore(d1);

  assert.deepEqual(await store.load(), { rotationOffset: 0, cooldownUntilMs: null });

  await store.save({ rotationOffset: 50, cooldownUntilMs: 1_800_000 });
  assert.deepEqual(await store.load(), { rotationOffset: 50, cooldownUntilMs: 1_800_000 });

  await store.save({ rotationOffset: 12, cooldownUntilMs: null });
  assert.deepEqual(await store.load(), { rotationOffset: 12, cooldownUntilMs: null });

  const rows = d1.sqlite.prepare("SELECT COUNT(*) AS count FROM todoist_ingress_control").get() as { count: number };
  assert.equal(rows.count, 1);
  d1.sqlite.close();
});
