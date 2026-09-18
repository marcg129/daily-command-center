import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTodoistApiClient,
  TodoistApiError,
  type TodoistApiFetch,
} from "@/lib/runtime/todoist-api";

const token = "secret-token-that-must-never-leak";
const projectId = "6XGgm6PHrGgMpCFX";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("lists only the configured project with stable cursor pagination and bearer auth", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: TodoistApiFetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (calls.length === 1) {
      return jsonResponse({
        results: [{
          id: "task-a",
          content: "A",
          description: "workspace: personal",
          labels: ["capture"],
          added_at: "2026-09-16T12:00:01.000Z",
        }],
        next_cursor: "opaque cursor/+==",
      });
    }
    return jsonResponse({
      results: [{
        id: "task-b",
        content: "B",
        description: "workspace: indelitech",
        labels: [],
        added_at: "2026-09-16T12:00:02.000Z",
      }],
      next_cursor: null,
    });
  };

  const client = createTodoistApiClient({ token, projectId, fetcher });
  const tasks = await client.listRelayTasks();

  assert.deepEqual(tasks.map((task) => task.id), ["task-a", "task-b"]);
  assert.deepEqual(tasks.map((task) => task.addedAt), [
    "2026-09-16T12:00:01.000Z",
    "2026-09-16T12:00:02.000Z",
  ]);
  assert.equal(calls.length, 2);
  const first = new URL(calls[0].url);
  const second = new URL(calls[1].url);
  assert.equal(first.origin, "https://api.todoist.com");
  assert.equal(first.pathname, "/api/v1/tasks");
  assert.equal(first.searchParams.get("project_id"), projectId);
  assert.equal(first.searchParams.get("limit"), "200");
  assert.equal(first.searchParams.has("cursor"), false);
  assert.equal(second.searchParams.get("project_id"), projectId);
  assert.equal(second.searchParams.get("limit"), "200");
  assert.equal(second.searchParams.get("cursor"), "opaque cursor/+==");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${token}`);
});

test("rejects task listings without stable added-at metadata", async () => {
  const client = createTodoistApiClient({
    token,
    projectId,
    fetcher: async () => jsonResponse({
      results: [{ id: "task-a", content: "A", description: "workspace: personal", labels: [] }],
      next_cursor: null,
    }),
  });
  await assert.rejects(client.listRelayTasks(), /invalid task payload/i);
});

test("closes a relay task with the Todoist v1 close endpoint", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createTodoistApiClient({
    token,
    projectId,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(null);
    },
  });

  await client.closeTask("6XGgmFVcrG5RRjVr");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.todoist.com/api/v1/tasks/6XGgmFVcrG5RRjVr/close");
  assert.equal(calls[0].init?.method, "POST");
});

test("marks a permanent failure without clobbering labels and suppresses identical diagnostic spam", async () => {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  const diagnostic = "DCC import failed: workspaceId must be personal or indelitech.";
  const fetcher: TodoistApiFetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });

    if (url.endsWith("/api/v1/tasks/task-a")) {
      if (init?.method === "POST") return jsonResponse({ id: "task-a", labels: ["capture", "dcc-failed"] });
      return jsonResponse({ id: "task-a", content: "A", description: "workspace: personal", labels: ["capture"] });
    }
    if (url.includes("/api/v1/comments?")) {
      return jsonResponse({
        results: [{ id: "comment-1", task_id: "task-a", content: diagnostic }],
        next_cursor: null,
      });
    }
    if (url.endsWith("/api/v1/comments")) return jsonResponse({ id: "comment-new", task_id: "task-a", content: diagnostic });
    throw new Error(`unexpected request ${url}`);
  };

  const client = createTodoistApiClient({ token, projectId, fetcher });
  await client.markFailure("task-a", diagnostic);

  const update = calls.find((call) => call.url.endsWith("/api/v1/tasks/task-a") && call.init?.method === "POST");
  assert.deepEqual(update?.body, { labels: ["capture", "dcc-failed"] });
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/comments") && call.init?.method === "POST").length, 0);
});

test("adds one diagnostic comment when the exact failure has not already been recorded", async () => {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  const diagnostic = "DCC import failed: due date is invalid.";
  const fetcher: TodoistApiFetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });

    if (url.endsWith("/api/v1/tasks/task-a") && (!init?.method || init.method === "GET")) {
      return jsonResponse({ id: "task-a", content: "A", description: "workspace: personal", labels: ["capture", "dcc-failed"] });
    }
    if (url.includes("/api/v1/comments?")) return jsonResponse({ results: [], next_cursor: null });
    if (url.endsWith("/api/v1/comments") && init?.method === "POST") {
      return jsonResponse({ id: "comment-new", task_id: "task-a", content: diagnostic });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const client = createTodoistApiClient({ token, projectId, fetcher });
  await client.markFailure("task-a", diagnostic);

  assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/tasks/task-a") && call.init?.method === "POST").length, 0);
  const comment = calls.find((call) => call.url.endsWith("/api/v1/comments") && call.init?.method === "POST");
  assert.deepEqual(comment?.body, { task_id: "task-a", content: diagnostic });
});

test("401 and 403 become permanent sanitized credential errors", async () => {
  for (const status of [401, 403]) {
    const client = createTodoistApiClient({
      token,
      projectId,
      fetcher: async () => jsonResponse({ error: `Bearer ${token}`, http_code: status }, status),
    });

    await assert.rejects(client.listRelayTasks(), (error: unknown) => {
      assert.ok(error instanceof TodoistApiError);
      assert.equal(error.transient, false);
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    });
  }
});

test("429 and server retry metadata become transient errors with bounded retryAfter", async () => {
  const client = createTodoistApiClient({
    token,
    projectId,
    fetcher: async () => jsonResponse({
      error: "rate limited",
      error_extra: { retry_after: 17 },
      http_code: 429,
    }, 429, { "retry-after": "9" }),
  });

  await assert.rejects(client.listRelayTasks(), (error: unknown) => {
    assert.ok(error instanceof TodoistApiError);
    assert.equal(error.transient, true);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 17);
    return true;
  });
});

test("5xx and network failures are transient, diagnostically useful, and never surface authorization material", async () => {
  const serverClient = createTodoistApiClient({
    token,
    projectId,
    fetcher: async () => jsonResponse({ error: token }, 503),
  });
  await assert.rejects(serverClient.listRelayTasks(), (error: unknown) => {
    assert.ok(error instanceof TodoistApiError);
    assert.equal(error.transient, true);
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });

  const networkClient = createTodoistApiClient({
    token,
    projectId,
    fetcher: async () => {
      throw new TypeError(`fetch failed while sending Authorization: Bearer ${token}`);
    },
  });
  await assert.rejects(networkClient.listRelayTasks(), (error: unknown) => {
    assert.ok(error instanceof TodoistApiError);
    assert.equal(error.transient, true);
    assert.equal(error.status, null);
    assert.match(error.message, /TypeError: fetch failed/i);
    assert.doesNotMatch(error.message, /secret-token|authorization/i);
    return true;
  });
});

test("constructor rejects blank token/project and pagination is bounded against cursor loops", async () => {
  assert.throws(() => createTodoistApiClient({ token: "", projectId }), /token is required/i);
  assert.throws(() => createTodoistApiClient({ token, projectId: "" }), /project ID is required/i);

  let calls = 0;
  const client = createTodoistApiClient({
    token,
    projectId,
    fetcher: async () => {
      calls += 1;
      return jsonResponse({ results: [], next_cursor: "same-cursor" });
    },
  });
  await assert.rejects(client.listRelayTasks(), /pagination cursor repeated/i);
  assert.equal(calls, 2);
});


test("normal relay tasks preserve Todoist priority/due data and resolve floating times with the user's Todoist timezone", async () => {
  const calls: string[] = [];
  const client = createTodoistApiClient({
    token,
    projectId,
    fetcher: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/v1/tasks?")) {
        return jsonResponse({
          results: [{
            id: "task-native",
            content: "Monitor TE decision",
            description: "Check status. Current plan: wait for the injury report.",
            labels: [],
            priority: 4,
            due: {
              date: "2026-09-20T11:00:00",
              timezone: null,
              string: "Sunday at 11 AM",
              lang: "en",
              is_recurring: false,
            },
            added_at: "2026-09-18T00:11:46.730Z",
          }],
          next_cursor: null,
        });
      }
      if (url === "https://api.todoist.com/api/v1/user") {
        return jsonResponse({
          id: "user-1",
          tz_info: { timezone: "America/New_York" },
        });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const tasks = await client.listRelayTasks();

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].priority, 4);
  assert.deepEqual(tasks[0].due, {
    date: "2026-09-20T11:00:00",
    timezone: "America/New_York",
    isRecurring: false,
  });
  assert.equal(calls.filter((url) => url === "https://api.todoist.com/api/v1/user").length, 1);
});
