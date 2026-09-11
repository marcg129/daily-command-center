import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { INDELITECH_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, legacyRequestContext } from "@/lib/runtime/context";
import { InMemorySessionProvider, principalId, requireAuthenticatedSession, type AuthenticatedSession } from "@/lib/runtime/session";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { applicationId, InMemorySecretProvider, secretId, secretName, SecretAuthorizationService } from "@/lib/runtime/secrets";
import { D1WorkspaceDomainRepository } from "@/lib/server/d1-workspace-domain-repository";
import { LocalWorkspaceDomainRepository } from "@/lib/server/local-workspace-domain-repository";

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
  constructor() { this.sqlite.exec("PRAGMA foreign_keys=ON"); for (const name of ["0001_workspaces.sql", "0004_secrets_and_workspace_domains.sql"]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")); }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map(statement => statement.run<T>())); }
}

const alice = { principalId: principalId("principal-alice") };
const bob = { principalId: principalId("principal-bob") };
const session: AuthenticatedSession = { sessionId: "session-1", principal: alice, expiresAt: "2099-01-01T00:00:00Z" };

test("sessions fail closed and authentication remains separate from workspace grants", async () => {
  const provider = new InMemorySessionProvider(new Map([["opaque-session", session]]));
  assert.equal(await provider.getSession(null), null);
  assert.throws(() => requireAuthenticatedSession(null), /Authentication/);
  assert.throws(() => requireAuthenticatedSession({ ...session, expiresAt: "malformed" }), /Authentication/);
  assert.equal(requireAuthenticatedSession(await provider.getSession("opaque-session")).principalId, alice.principalId);
  const resolver = new FakeWorkspaceResolver(new Map([[alice.principalId, new Set([PERSONAL_WORKSPACE_ID])]]));
  await assert.rejects(resolver.resolve(alice, INDELITECH_WORKSPACE_ID), /denied/);
  await assert.rejects(resolver.resolve(bob, PERSONAL_WORKSPACE_ID), /denied/);
});

test("secret authorization separates application, user, and exact workspace ownership", async () => {
  const provider = new InMemorySecretProvider(); const service = new SecretAuthorizationService(provider);
  const app = applicationId("collector-service");
  const appSecret = { id: secretId("secret-app"), name: secretName("api-key"), owner: { type: "APPLICATION" as const, applicationId: app } };
  const userSecret = { id: secretId("secret-user"), name: secretName("oauth-token"), owner: { type: "USER" as const, principalId: alice.principalId } };
  const workspaceSecret = { id: secretId("secret-workspace"), name: secretName("gmail-token"), owner: { type: "WORKSPACE" as const, workspaceId: INDELITECH_WORKSPACE_ID } };
  const personalAccess = { principal: alice, context: { workspaceId: PERSONAL_WORKSPACE_ID } };
  await assert.rejects(service.set(personalAccess, appSecret, "not-a-real-key"), /Application/);
  await service.set({ ...personalAccess, applicationService: app }, appSecret, "not-a-real-key");
  await service.set(personalAccess, userSecret, "not-a-real-token");
  await assert.rejects(service.get({ principal: bob, context: personalAccess.context }, userSecret), /User/);
  await assert.rejects(service.set(personalAccess, workspaceSecret, "not-a-real-token"), /Workspace/);
  await service.set({ principal: alice, context: { workspaceId: INDELITECH_WORKSPACE_ID } }, workspaceSecret, "not-a-real-token");
  assert.equal(await service.get({ principal: alice, context: { workspaceId: INDELITECH_WORKSPACE_ID } }, workspaceSecret), "not-a-real-token");
  // Personal may see a shared Indelitech content record, but that context still cannot read its secret.
  await assert.rejects(service.get(personalAccess, workspaceSecret), /Workspace/);
  assert.equal(JSON.stringify([...provider.metadata.values()]).includes("not-a-real"), false);
});

test("remaining hosted domain records bind every read and mutation to a product workspace", async () => {
  const d1 = new TestD1(); const repository = new D1WorkspaceDomainRepository(d1); const updatedAt = "2026-09-11T00:00:00Z";
  for (const domain of ["CONTENT", "DAILY_BRIEF", "INDUSTRY_DISCOVERY", "NEWSLETTER_EVIDENCE", "AUDIENCE_HISTORY", "SITEMAP_SNAPSHOT"] as const) {
    await repository.put({ workspaceId: PERSONAL_WORKSPACE_ID }, domain, { key: "same", value: { owner: "personal" }, updatedAt });
    await repository.put({ workspaceId: INDELITECH_WORKSPACE_ID }, domain, { key: "same", value: { owner: "indelitech" }, updatedAt });
    assert.deepEqual((await repository.get<{owner:string}>({ workspaceId: PERSONAL_WORKSPACE_ID }, domain, "same"))?.value, { owner: "personal" });
    await repository.delete({ workspaceId: PERSONAL_WORKSPACE_ID }, domain, "same");
    assert.equal(await repository.get({ workspaceId: PERSONAL_WORKSPACE_ID }, domain, "same"), null);
    assert.equal((await repository.list({ workspaceId: INDELITECH_WORKSPACE_ID }, domain)).length, 1);
  }
  await assert.rejects(repository.list(legacyRequestContext(), "CONTENT"), /hosted product/);
  d1.sqlite.close();
});

test("local domain adapter preserves legacy-only behavior", async () => {
  const database = new DatabaseSync(":memory:"); const repository = new LocalWorkspaceDomainRepository(database);
  await repository.put(legacyRequestContext(), "AUDIENCE_HISTORY", { key: "history", value: { count: 3 }, updatedAt: "2026-09-11T00:00:00Z" });
  assert.deepEqual((await repository.get(legacyRequestContext(), "AUDIENCE_HISTORY", "history"))?.value, { count: 3 });
  await assert.rejects(repository.get({ workspaceId: PERSONAL_WORKSPACE_ID }, "AUDIENCE_HISTORY", "history"), /local adapter/);
  database.close();
});
