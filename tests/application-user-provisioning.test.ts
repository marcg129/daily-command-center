import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { principalId } from "@/lib/runtime/session";
import { D1ApplicationUserResolver } from "@/lib/server/d1-application-user-resolver";
import {
  AutoProvisioningApplicationUserResolver,
  D1ApplicationUserProvisioner,
  type ProvisionedIdentityIds,
} from "@/lib/server/d1-application-user-provisioner";

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
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function idsFor(name: string): ProvisionedIdentityIds {
  return {
    userId: `user:${name}-opaque`,
    personalWorkspaceId: `personal:${name}-opaque`,
  };
}

function idFactory(principal: string): ProvisionedIdentityIds {
  if (principal === "cf-user:christa") return idsFor("christa");
  if (principal === "cf-user:sister") return idsFor("sister");
  return idsFor("other");
}

function count(database: TestD1, table: string) {
  return Number((database.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

test("new authenticated identity receives one private Personal workspace and never Indelitech", async () => {
  const database = new TestD1();
  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);

  await provisioner.provision({
    principalId: principalId("cf-user:christa"),
    provider: "CLOUDFLARE_ACCESS",
  });

  assert.deepEqual(
    database.sqlite.prepare(
      `SELECT m.workspace_key, m.workspace_id, m.role, w.name, w.workspace_type
       FROM workspace_memberships m
       JOIN workspaces w ON w.workspace_id = m.workspace_id
       WHERE m.user_id = 'user:christa-opaque'
       ORDER BY m.workspace_key`,
    ).all().map((row) => ({ ...row })),
    [{
      workspace_key: "personal",
      workspace_id: "personal:christa-opaque",
      role: "OWNER",
      name: "Personal",
      workspace_type: "PERSONAL",
    }],
  );
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM workspace_memberships WHERE user_id='user:christa-opaque' AND workspace_key='indelitech'",
    ).get()!.count,
    0,
  );
  database.sqlite.close();
});

test("provisioning is idempotent and separate principals receive separate physical Personal workspaces", async () => {
  const database = new TestD1();
  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);

  await provisioner.provision({ principalId: principalId("cf-user:christa"), provider: "CLOUDFLARE_ACCESS" });
  const afterFirst = {
    users: count(database, "users"),
    workspaces: count(database, "workspaces"),
    principals: count(database, "user_principals"),
    memberships: count(database, "workspace_memberships"),
  };

  await provisioner.provision({ principalId: principalId("cf-user:christa"), provider: "CLOUDFLARE_ACCESS" });
  assert.deepEqual({
    users: count(database, "users"),
    workspaces: count(database, "workspaces"),
    principals: count(database, "user_principals"),
    memberships: count(database, "workspace_memberships"),
  }, afterFirst);

  await provisioner.provision({ principalId: principalId("cf-user:sister"), provider: "CLOUDFLARE_ACCESS" });

  assert.deepEqual(
    database.sqlite.prepare(
      "SELECT user_id, workspace_id FROM workspace_memberships WHERE workspace_key='personal' AND user_id LIKE 'user:%' ORDER BY user_id",
    ).all().map((row) => ({ ...row })),
    [
      { user_id: "user:christa-opaque", workspace_id: "personal:christa-opaque" },
      { user_id: "user:sister-opaque", workspace_id: "personal:sister-opaque" },
    ],
  );
  database.sqlite.close();
});

test("existing disabled or structurally incomplete identities fail closed instead of being repaired silently", async () => {
  const database = new TestD1();
  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:disabled','DISABLED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES ('cf-user:disabled','user:disabled','CLOUDFLARE_ACCESS',CURRENT_TIMESTAMP)",
  ).run();

  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:incomplete','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES ('cf-user:incomplete','user:incomplete','CLOUDFLARE_ACCESS',CURRENT_TIMESTAMP)",
  ).run();

  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);
  await assert.rejects(
    provisioner.provision({ principalId: principalId("cf-user:disabled"), provider: "CLOUDFLARE_ACCESS" }),
    /provisioning denied/i,
  );
  await assert.rejects(
    provisioner.provision({ principalId: principalId("cf-user:incomplete"), provider: "CLOUDFLARE_ACCESS" }),
    /provisioning denied/i,
  );
  database.sqlite.close();
});

test("auto-provisioning resolver creates only the missing Personal boundary and then uses normal authorization", async () => {
  const database = new TestD1();
  const principal = { principalId: principalId("cf-user:christa") };
  const resolver = new D1ApplicationUserResolver(database);
  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);
  const auto = new AutoProvisioningApplicationUserResolver(
    resolver,
    provisioner,
    "CLOUDFLARE_ACCESS",
  );

  const resolved = await auto.resolve(principal);
  assert.equal(resolved.userId, "user:christa-opaque");
  assert.deepEqual(resolved.workspaces, [{
    workspaceId: "personal",
    displayName: "Personal",
    workspaceType: "PERSONAL",
    themeKey: "personal-tech-blue",
    role: "OWNER",
  }]);

  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM workspace_memberships WHERE user_id='user:christa-opaque' AND workspace_key='indelitech'",
    ).get()!.count,
    0,
  );
  database.sqlite.close();
});


test("auto-provisioning policy can reject non-human authenticated principals without creating data", async () => {
  const database = new TestD1();
  const principal = { principalId: principalId("cf-service:worker") };
  const resolver = new D1ApplicationUserResolver(database);
  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);
  const auto = new AutoProvisioningApplicationUserResolver(
    resolver,
    provisioner,
    "CLOUDFLARE_ACCESS",
    (candidate) => candidate.principalId.startsWith("cf-user:"),
  );

  await assert.rejects(auto.resolve(principal), /Application user access denied/i);
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) count FROM user_principals WHERE principal_id='cf-service:worker'").get()!.count,
    0,
  );
  database.sqlite.close();
});


test("existing resolvable identities still fail closed unless they own exactly one Personal workspace", async () => {
  const database = new TestD1();

  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:indelitech-only','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES ('cf-user:indelitech-only','user:indelitech-only','CLOUDFLARE_ACCESS',CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:indelitech-only','indelitech','indelitech','OWNER')",
  ).run();

  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:personal-member','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES ('cf-user:personal-member','user:personal-member','CLOUDFLARE_ACCESS',CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:personal-member','personal','personal','MEMBER')",
  ).run();

  const resolver = new D1ApplicationUserResolver(database);
  const provisioner = new D1ApplicationUserProvisioner(database, idFactory);
  const auto = new AutoProvisioningApplicationUserResolver(
    resolver,
    provisioner,
    "CLOUDFLARE_ACCESS",
  );

  await assert.rejects(
    auto.resolve({ principalId: principalId("cf-user:indelitech-only") }),
    /provisioning denied/i,
  );
  await assert.rejects(
    auto.resolve({ principalId: principalId("cf-user:personal-member") }),
    /provisioning denied/i,
  );

  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM workspace_memberships WHERE user_id IN ('user:indelitech-only','user:personal-member')",
    ).get()!.count,
    2,
  );
  database.sqlite.close();
});


test("existing owner identity keeps its current Personal and Indelitech memberships without reprovisioning", async () => {
  const database = new TestD1();
  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:marc-existing','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES ('cf-user:marc','user:marc-existing','CLOUDFLARE_ACCESS',CURRENT_TIMESTAMP)",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc-existing','personal','personal','OWNER')",
  ).run();
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc-existing','indelitech','indelitech','OWNER')",
  ).run();

  let generated = false;
  const provisioner = new D1ApplicationUserProvisioner(database, () => {
    generated = true;
    return idsFor("should-not-run");
  });
  const before = {
    users: count(database, "users"),
    workspaces: count(database, "workspaces"),
    principals: count(database, "user_principals"),
    memberships: count(database, "workspace_memberships"),
  };

  await provisioner.provision({
    principalId: principalId("cf-user:marc"),
    provider: "CLOUDFLARE_ACCESS",
  });

  assert.equal(generated, false);
  assert.deepEqual({
    users: count(database, "users"),
    workspaces: count(database, "workspaces"),
    principals: count(database, "user_principals"),
    memberships: count(database, "workspace_memberships"),
  }, before);
  assert.deepEqual(
    database.sqlite.prepare(
      "SELECT workspace_key, workspace_id, role FROM workspace_memberships WHERE user_id='user:marc-existing' ORDER BY workspace_key",
    ).all().map((row) => ({ ...row })),
    [
      { workspace_key: "indelitech", workspace_id: "indelitech", role: "OWNER" },
      { workspace_key: "personal", workspace_id: "personal", role: "OWNER" },
    ],
  );
  database.sqlite.close();
});


test("provider-routed provisioning creates a private WorkOS user without Cloudflare grants", async () => {
  const database = new TestD1();
  const principal = { principalId: principalId("workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT") };
  const resolver = new D1ApplicationUserResolver(database);
  const provisioner = new D1ApplicationUserProvisioner(database, () => idsFor("workos"));
  const auto = new AutoProvisioningApplicationUserResolver(
    resolver,
    provisioner,
    (candidate) =>
      candidate.principalId.startsWith("workos-user:")
        ? "WORKOS_AUTHKIT"
        : candidate.principalId.startsWith("cf-user:")
          ? "CLOUDFLARE_ACCESS"
          : null,
  );

  const resolved = await auto.resolve(principal);
  assert.equal(resolved.userId, "user:workos-opaque");
  assert.deepEqual(resolved.workspaces, [{
    workspaceId: "personal",
    displayName: "Personal",
    workspaceType: "PERSONAL",
    themeKey: "personal-tech-blue",
    role: "OWNER",
  }]);
  assert.deepEqual(
    database.sqlite.prepare(
      "SELECT principal_id, provider FROM user_principals WHERE user_id='user:workos-opaque'",
    ).all().map((row) => ({ ...row })),
    [{
      principal_id: "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
      provider: "WORKOS_AUTHKIT",
    }],
  );
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM workspace_memberships WHERE user_id='user:workos-opaque' AND workspace_key='indelitech'",
    ).get()!.count,
    0,
  );
  database.sqlite.close();
});
