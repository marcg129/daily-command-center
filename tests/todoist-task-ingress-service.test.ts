import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestContext } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import { hostedTaskFromCapture } from "@/lib/runtime/hosted-task-capture";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import type { Clock } from "@/lib/runtime/primitives";
import { parseTodoistRelayTask, type TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import {
  createTodoistTaskIngressService,
  TodoistRelayTransportError,
  TodoistWorkspaceAuthorizationError,
  type TodoistRelayActions,
  type TodoistUserWorkspaceResolver,
} from "@/lib/runtime/todoist-task-ingress-service";

const now = new Date("2026-09-16T18:00:00.000Z");
const clock: Clock = { now: () => now };
const personalContext: RequestContext = {
  userId: "user:relay",
  workspaceId: "personal:relay-user",
  workspaceKey: "personal",
};

function relayTask(overrides: Partial<TodoistRelayTask> = {}): TodoistRelayTask {
  return {
    id: "6hWfF8h2gHrG9GH5",
    content: "Call the insurance company",
    description: [
      "source: chatgpt",
      "workspace: personal",
      "priority: HIGH",
      "estimatedDuration: 15m",
      "context: Ask about the renewal notice.",
    ].join("\n"),
    ...overrides,
  };
}

class MemoryHostedTaskRepository implements HostedTaskRepository {
  readonly tasks = new Map<string, HostedTask>();
  readonly events: string[] = [];
  failCreate: Error | null = null;

  async list() { return [...this.tasks.values()]; }
  async get(_context: RequestContext, taskId: string) {
    this.events.push("get");
    return this.tasks.get(taskId) ?? null;
  }
  async create(_context: RequestContext, task: HostedTask) {
    this.events.push("create");
    if (this.failCreate) throw this.failCreate;
    this.tasks.set(task.taskId, task);
    return task;
  }
  async update(_context: RequestContext, task: HostedTask) {
    this.tasks.set(task.taskId, task);
    return task;
  }
}

function resolver(overrides: Partial<TodoistUserWorkspaceResolver> = {}): TodoistUserWorkspaceResolver {
  return {
    async resolve(workspaceId: string) {
      if (workspaceId !== "personal") throw new TodoistWorkspaceAuthorizationError("Workspace access denied.");
      return personalContext;
    },
    ...overrides,
  };
}

function relayActions(events: string[] = []): TodoistRelayActions & {
  failures: string[];
  closed: string[];
} {
  return {
    failures: [],
    closed: [],
    async closeTask(taskId: string) {
      events.push("close");
      this.closed.push(taskId);
    },
    async markFailure(taskId: string, diagnostic: string) {
      events.push("mark-failure");
      this.failures.push(`${taskId}:${diagnostic}`);
    },
  };
}

test("successful ingress persists canonically before closing Todoist", async () => {
  const repository = new MemoryHostedTaskRepository();
  const events = repository.events;
  const relay = relayActions(events);
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(relayTask());

  assert.equal(outcome.status, "imported");
  assert.equal(outcome.requestId, "todoist:6hWfF8h2gHrG9GH5");
  assert.deepEqual(events, ["get", "create", "close"]);
  assert.deepEqual(relay.closed, ["6hWfF8h2gHrG9GH5"]);
  assert.equal(repository.tasks.size, 1);
  assert.equal([...repository.tasks.values()][0].primaryWorkspaceId, "personal");
});

test("identical replay uses canonical idempotency and still closes the relay", async () => {
  const repository = new MemoryHostedTaskRepository();
  const task = relayTask();
  const capture = parseTodoistRelayTask(task);
  repository.tasks.set(`capture:${capture.requestId}`, hostedTaskFromCapture(capture, now.toISOString()));
  const relay = relayActions(repository.events);
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(task);

  assert.equal(outcome.status, "already-imported");
  assert.deepEqual(repository.events, ["get", "close"]);
  assert.equal(repository.tasks.size, 1);
});

test("malformed relay becomes a visible permanent failure without DCC persistence", async () => {
  const repository = new MemoryHostedTaskRepository();
  const relay = relayActions();
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(relayTask({ description: "workspace: elsewhere" }));

  assert.equal(outcome.status, "permanent-failure");
  assert.match(outcome.diagnostic ?? "", /personal or indelitech/i);
  assert.equal(repository.tasks.size, 0);
  assert.equal(relay.closed.length, 0);
  assert.equal(relay.failures.length, 1);
});

test("authorization denial is permanent, sanitized, and never reaches DCC create", async () => {
  const repository = new MemoryHostedTaskRepository();
  const relay = relayActions();
  const workspaceResolver = resolver({
    async resolve() { throw new TodoistWorkspaceAuthorizationError("Workspace access denied: physical workspace personal:secret-row"); },
  });
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver, relay });

  const outcome = await service(relayTask());

  assert.equal(outcome.status, "permanent-failure");
  assert.equal(outcome.diagnostic, "DCC import failed: configured DCC user is not authorized for personal.");
  assert.doesNotMatch(relay.failures[0] ?? "", /secret-row/);
  assert.equal(repository.tasks.size, 0);
  assert.equal(relay.closed.length, 0);
});

test("workspace lookup infrastructure failure is transient and never marks the relay failed", async () => {
  const repository = new MemoryHostedTaskRepository();
  const relay = relayActions();
  const workspaceResolver = resolver({
    async resolve() { throw new Error("D1 temporarily unavailable: internal detail"); },
  });
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver, relay });

  const outcome = await service(relayTask());

  assert.equal(outcome.status, "transient-failure");
  assert.equal(outcome.requestId, "todoist:6hWfF8h2gHrG9GH5");
  assert.equal(relay.failures.length, 0);
  assert.equal(relay.closed.length, 0);
  assert.doesNotMatch(JSON.stringify(outcome), /internal detail/);
});

test("canonical capture conflict is permanent and does not overwrite or close", async () => {
  const repository = new MemoryHostedTaskRepository();
  const task = relayTask();
  const capture = parseTodoistRelayTask(task);
  const conflicting = hostedTaskFromCapture({ ...capture, title: "Different title" }, now.toISOString());
  repository.tasks.set(`capture:${capture.requestId}`, conflicting);
  const relay = relayActions();
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(task);

  assert.equal(outcome.status, "permanent-failure");
  assert.equal(outcome.diagnostic, "DCC import failed: relay identity conflicts with an existing DCC task.");
  assert.equal(repository.tasks.get(`capture:${capture.requestId}`)?.title, "Different title");
  assert.equal(relay.closed.length, 0);
});

test("transient DCC persistence failure stays pending and does not add a permanent diagnostic", async () => {
  const repository = new MemoryHostedTaskRepository();
  repository.failCreate = new Error("temporary D1 failure");
  const relay = relayActions();
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(relayTask());

  assert.equal(outcome.status, "transient-failure");
  assert.equal(relay.failures.length, 0);
  assert.equal(relay.closed.length, 0);
});

test("Todoist close failure after persistence is transient and replays safely next poll", async () => {
  const repository = new MemoryHostedTaskRepository();
  let closeAttempts = 0;
  const relay = relayActions(repository.events);
  relay.closeTask = async () => {
    repository.events.push("close");
    closeAttempts += 1;
    if (closeAttempts === 1) throw new TodoistRelayTransportError("Todoist unavailable", { transient: true });
  };
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const first = await service(relayTask());
  const second = await service(relayTask());

  assert.equal(first.status, "transient-failure");
  assert.equal(second.status, "already-imported");
  assert.equal(repository.tasks.size, 1);
  assert.deepEqual(repository.events, ["get", "create", "close", "get", "close"]);
});

test("failure-marker transport errors are classified without leaking provider details", async () => {
  const repository = new MemoryHostedTaskRepository();
  const relay = relayActions();
  relay.markFailure = async () => {
    throw new TodoistRelayTransportError("Authorization: Bearer should-not-leak", { transient: true, retryAfterSeconds: 30 });
  };
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });

  const outcome = await service(relayTask({ description: "workspace: elsewhere" }));

  assert.equal(outcome.status, "transient-failure");
  assert.equal(outcome.retryAfterSeconds, 30);
  assert.doesNotMatch(JSON.stringify(outcome), /should-not-leak/);
});


test("normal Todoist fallback persists mapped Personal task before closing relay", async () => {
  const repository = new MemoryHostedTaskRepository();
  const relay = relayActions(repository.events);
  const service = createTodoistTaskIngressService({ repository, clock, workspaceResolver: resolver(), relay });
  const context = "Check updated injury news. Current plan: keep the insurance option until status is clear.";

  const outcome = await service(relayTask({
    content: "Monitor TE decision",
    description: context,
    priority: 4,
    due: {
      date: "2026-09-20T11:00:00",
      timezone: "America/New_York",
      isRecurring: false,
    },
  }));

  assert.equal(outcome.status, "imported");
  assert.deepEqual(repository.events, ["get", "create", "close"]);
  const saved = [...repository.tasks.values()][0];
  assert.equal(saved.primaryWorkspaceId, "personal");
  assert.equal(saved.context, context);
  assert.equal(saved.priority, "HIGH");
  assert.equal(saved.type, "DEADLINE");
  assert.equal(saved.dueAt, "2026-09-20");
  assert.equal(saved.dueIsDateOnly, true);
  assert.equal(saved.remindAt, "2026-09-20T15:00:00.000Z");
});
