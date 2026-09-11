import { D1TaskRepository } from "../lib/server/d1-task-repository";
import { D1WorkspaceDomainRepository } from "../lib/server/d1-workspace-domain-repository";
import type { D1Database } from "../lib/runtime/d1";
import type { HostedTask } from "../lib/runtime/hosted-tasks";

type Env = { DB: D1Database };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function mustReject(operation: () => Promise<unknown>, label: string) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`${label}: expected D1 to reject the operation`);
}

async function scalar(database: D1Database, sql: string, ...bindings: unknown[]) {
  const row = await database.prepare(sql).bind(...bindings).first<{ value: unknown }>();
  return row?.value;
}

function task(taskId: string): HostedTask {
  return {
    taskId,
    primaryWorkspaceId: "indelitech",
    title: "Repository binding proof",
    context: null,
    category: null,
    project: null,
    person: null,
    type: "ONE_TIME",
    priority: "MEDIUM",
    status: "OPEN",
    dueAt: "2026-09-30",
    dueIsDateOnly: true,
    remindAt: null,
    followUpAt: null,
    estimatedDuration: null,
    recurrence: null,
    seriesId: "ci-series-independent",
    recurrenceAnchorDay: 17,
    dependency: "ci-real-dependency",
    createdAt: "2026-09-11T00:00:00.000Z",
    completedAt: null,
    source: "CI",
    sourceContext: null,
    lastNotifiedAt: null,
    updatedAt: "2026-09-11T00:00:00.000Z",
  };
}

async function runProof(database: D1Database) {
  const results: string[] = [];
  const pass = (name: string) => results.push(`${name}=PASS`);

  // D1 batch() is transactional: the valid first insert must disappear when the
  // visibility-policy trigger aborts the second statement.
  await mustReject(
    () => database.batch([
      database.prepare(`INSERT INTO tasks
        (task_id, primary_workspace_id, title, type, priority, status, due_is_date_only, created_at, source, updated_at)
        VALUES (?, 'personal', 'Rollback sentinel', 'ONE_TIME', 'LOW', 'OPEN', 0, CURRENT_TIMESTAMP, 'CI', CURRENT_TIMESTAMP)`)
        .bind("ci-batch-rollback"),
      database.prepare("INSERT INTO task_visibility (task_id, workspace_id) VALUES (?, 'indelitech')")
        .bind("ci-batch-rollback"),
    ]),
    "batch rollback trigger",
  );
  assert(Number(await scalar(database, "SELECT count(*) AS value FROM tasks WHERE task_id = ?", "ci-batch-rollback")) === 0,
    "D1 batch partially committed its first statement");
  pass("D1 batch rollback");

  const insertTask = (id: string, workspace: string) => database.prepare(`INSERT INTO tasks
    (task_id, primary_workspace_id, title, type, priority, status, due_is_date_only, created_at, source, updated_at)
    VALUES (?, ?, ?, 'ONE_TIME', 'LOW', 'OPEN', 0, CURRENT_TIMESTAMP, 'CI', CURRENT_TIMESTAMP)`)
    .bind(id, workspace, id).run();
  await insertTask("ci-indelitech-policy", "indelitech");
  await database.prepare("INSERT INTO task_visibility VALUES (?, ?)").bind("ci-indelitech-policy", "indelitech").run();
  pass("Indelitech to Indelitech visibility");
  await database.prepare("INSERT INTO task_visibility VALUES (?, ?)").bind("ci-indelitech-policy", "personal").run();
  pass("Indelitech to Personal visibility");
  assert(Number(await scalar(database, "SELECT count(*) AS value FROM tasks WHERE task_id = ?", "ci-indelitech-policy")) === 1,
    "shared visibility duplicated the underlying task");
  pass("shared task single underlying row");

  await insertTask("ci-personal-policy", "personal");
  await database.prepare("INSERT INTO task_visibility VALUES (?, ?)").bind("ci-personal-policy", "personal").run();
  pass("Personal to Personal visibility");
  await mustReject(() => database.prepare("INSERT INTO task_visibility VALUES (?, ?)").bind("ci-personal-policy", "indelitech").run(),
    "Personal to Indelitech visibility");
  pass("Personal to Indelitech rejection");
  await mustReject(() => insertTask("ci-invalid-workspace", "not-a-workspace"), "foreign workspace");
  pass("foreign workspace rejection");
  await mustReject(() => database.prepare("INSERT INTO task_visibility VALUES (?, ?)").bind("ci-personal-policy", "personal").run(),
    "duplicate visibility");
  pass("duplicate visibility rejection");
  await mustReject(() => database.prepare(`INSERT INTO collector_snapshots
    (workspace_id, collector, scope, payload_json, checked_at, updated_at) VALUES ('personal', 'ci', 'ci', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .bind("{not-json").run(), "malformed payload_json");
  pass("malformed payload_json rejection");
  await mustReject(() => database.prepare("UPDATE tasks SET primary_workspace_id = 'indelitech' WHERE task_id = 'ci-personal-policy'").run(),
    "immutable primary workspace");
  pass("primary workspace immutability");

  const tasks = new D1TaskRepository(database);
  const personal = { workspaceId: "personal" } as const;
  const indelitech = { workspaceId: "indelitech" } as const;
  const original = task("ci-repository-task");
  await tasks.create(indelitech, original, ["indelitech", "personal"]);
  assert((await tasks.get(personal, original.taskId))?.taskId === original.taskId, "repository create was not visible from Personal");
  assert((await tasks.get(indelitech, original.taskId))?.taskId === original.taskId, "repository create was not visible from Indelitech");
  pass("D1TaskRepository.create shared visibility");
  const updated = { ...original, title: "Updated through Personal", updatedAt: "2026-09-11T00:01:00.000Z" };
  await tasks.update(personal, updated);
  const observed = await tasks.get(indelitech, original.taskId);
  assert(observed?.title === updated.title, "Indelitech did not observe the Personal repository update");
  assert(observed.seriesId === "ci-series-independent", "series_id did not round-trip");
  assert(observed.recurrenceAnchorDay === 17, "recurrence_anchor_day did not round-trip");
  assert(observed.dependency === "ci-real-dependency" && observed.recurrence === null, "dependency did not round-trip independently");
  assert(observed.dueAt === "2026-09-30", "date-only due value changed");
  pass("D1TaskRepository.update cross-workspace same row");
  pass("series_id round-trip");
  pass("recurrence_anchor_day round-trip");
  pass("dependency independent round-trip");
  pass("date-only due round-trip");

  const domains = new D1WorkspaceDomainRepository(database);
  await domains.put(personal, "CONTENT", { key: "same-key", value: { owner: "personal" }, updatedAt: "2026-09-11T00:00:00Z" });
  await domains.put(indelitech, "CONTENT", { key: "same-key", value: { owner: "indelitech" }, updatedAt: "2026-09-11T00:00:00Z" });
  assert((await domains.get<{ owner: string }>(personal, "CONTENT", "same-key"))?.value.owner === "personal",
    "Personal domain record crossed workspace boundary");
  assert((await domains.get<{ owner: string }>(indelitech, "CONTENT", "same-key"))?.value.owner === "indelitech",
    "Indelitech domain record crossed workspace boundary");
  pass("D1WorkspaceDomainRepository key isolation");
  return results;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/proof") return new Response("Not found", { status: 404 });
    try {
      return Response.json({ ok: true, results: await runProof(env.DB) });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.stack : String(error) }, { status: 500 });
    }
  },
};

export default worker;
