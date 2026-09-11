import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CollectorService } from "@/lib/runtime/collector-dispatch";
import { LEGACY_WORKSPACE_ID, legacyRequestContext } from "@/lib/runtime/context";
import type { WorkspaceRepository } from "@/lib/runtime/workspace-repository";
import { LocalWorkspaceRepository } from "@/lib/server/local-workspace-repository";
import { createWorkspaceHandlers } from "@/lib/server/workspace-service";
import { initializeWorkspaceStore } from "@/lib/workspace-store";
import { publicSettingsFromStored } from "@/lib/runtime/public-settings";
import type { StoredSettings } from "@/lib/server/settings";
import { LocalJsonSnapshotRepository } from "@/lib/server/local-json-snapshot-repository";

test("workspace route propagates its request context and deterministic primitives", async () => {
  const observed: string[] = [];
  const repository: WorkspaceRepository = {
    async read(context) {
      observed.push(`read:${context.workspaceId}`);
      return { reminders: [], tasks: [] };
    },
    async isInitialized(context) {
      observed.push(`initialized:${context.workspaceId}`);
      return true;
    },
    async write(context, state, now) {
      observed.push(`write:${context.workspaceId}:${now}`);
      return state;
    },
  };
  const context = { workspaceId: "workspace-under-test" };
  const handlers = createWorkspaceHandlers({
    repository,
    context: () => context,
    clock: { now: () => new Date("2026-09-10T12:00:00.000Z") },
    ids: { generate: () => "generated-id" },
    legacyImportAllowed: () => false,
  });

  assert.equal((await handlers.GET()).status, 200);
  const response = await handlers.PUT(new Request("http://local/api/workspace", {
    method: "PUT",
    body: JSON.stringify({ reminders: [{ title: "Follow up" }], tasks: [] }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reminders[0].id, "generated-id");
  assert.deepEqual(observed, [
    "read:workspace-under-test",
    "initialized:workspace-under-test",
    "write:workspace-under-test:2026-09-10T12:00:00.000Z",
  ]);
});

test("local workspace repository preserves SQLite recurrence history and rejects other contexts", async () => {
  const database = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  const repository = new LocalWorkspaceRepository(() => database);
  const context = legacyRequestContext();
  const active = { id: "weekly", title: "Review", description: "Review", due: "2026-09-11", recurrence: "Weekly", priority: "Normal", done: false };
  const occurrence = { ...active, id: "weekly:2026-09-04", done: true, completedAt: "2026-09-04T12:00:00.000Z", seriesId: active.id };
  const first = await repository.write(context, {
    reminders: [],
    tasks: [active, occurrence],
  }, "2026-09-10T12:00:00.000Z");
  const second = await repository.write(context, {
    reminders: [],
    tasks: [first.tasks[0]],
  }, "2026-09-10T13:00:00.000Z");

  assert.equal(second.tasks.some(({ id }) => id === occurrence.id), true);
  await assert.rejects(
    repository.read({ workspaceId: "another-workspace" }),
    /cannot access workspace another-workspace/,
  );
  database.close();
});

test("public settings DTO excludes persisted secrets", () => {
  const stored = {
    general: { workspaceName: "Control Center" },
    industry: { sources: [], keywords: [], description: "", excludedTerms: [], dailyLimit: 30 },
    mentions: { terms: [], websites: [], identityAnchors: [], negativeTerms: [], strictMode: true, excludeOwnedSites: true },
    newsletters: { googleClientId: "client.apps.googleusercontent.com", googleClientSecret: "google-secret", connectedEmail: "owner@example.com", refreshToken: "refresh-secret", accessToken: "access-secret", accessTokenExpiresAt: 1, gmailQuery: "newer_than:30d" },
    audience: { accounts: [{ id: "account", platform: "youtube", label: "Channel", username: "channel", accountId: "", profileUrl: "", credential: "audience-secret" }] },
    ai: { provider: "openai", model: "", apiKeys: { openai: "openai-secret", anthropic: "", gemini: "", xai: "", lmstudio: "", ollama: "" }, localBaseUrls: { lmstudio: "http://127.0.0.1:1234", ollama: "http://127.0.0.1:11434" } },
    dailyBrief: { sourceLabels: [], lookbackDays: 7, sections: { industry: 5, mentions: 5, newsletters: 5 } },
  } as StoredSettings;
  const serialized = JSON.stringify(publicSettingsFromStored(stored, () => ""));
  for (const secret of ["google-secret", "refresh-secret", "access-secret", "audience-secret", "openai-secret"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("collector service dispatches logic directly and carries workspace context", async () => {
  const seen: string[] = [];
  const handler = async (name: string, workspaceId: string) => {
    seen.push(`${name}:${workspaceId}`);
    return Response.json({ ok: true });
  };
  const service = new CollectorService({
    industry: (context) => handler("industry", context.workspaceId),
    mentions: (context) => handler("mentions", context.workspaceId),
    audience: (context) => handler("audience", context.workspaceId),
    newsletters: (context) => handler("newsletters", context.workspaceId),
  });

  const results = await service.dispatchAll({ workspaceId: LEGACY_WORKSPACE_ID });
  assert.deepEqual(results.map(({ ok }) => ok), [true, true, true, true]);
  assert.deepEqual(seen.sort(), ["audience:legacy-local", "industry:legacy-local", "mentions:legacy-local", "newsletters:legacy-local"]);
});

test("local snapshot repository retains file behavior and enforces context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "control-center-snapshot-"));
  const target = path.join(directory, "snapshots.json");
  const repository = new LocalJsonSnapshotRepository<{ count: number }>(
    () => target,
    (value) => value as { count: number },
    () => ({ count: 0 }),
    "Snapshot is corrupt.",
  );
  try {
    assert.deepEqual(await repository.read(legacyRequestContext()), { count: 0 });
    await repository.write(legacyRequestContext(), { count: 4 });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { count: 4 });
    await assert.rejects(repository.read({ workspaceId: "other" }), /cannot access workspace other/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
