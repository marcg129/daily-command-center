import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTodoistApiClient,
  TodoistApiError,
  type TodoistApiFetch,
} from "@/lib/runtime/todoist-api";

const testCredential = "fixture-value";
const projectId = "fixture-project";

test("uses manual redirect handling for Todoist requests", async () => {
  let redirectMode: RequestRedirect | undefined;
  const fetcher: TodoistApiFetch = async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response(JSON.stringify({ results: [], next_cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createTodoistApiClient({ token: testCredential, projectId, fetcher });
  await client.listRelayTasks();

  assert.equal(redirectMode, "manual");
});

test("a manual redirect response is rejected without a second request", async () => {
  let calls = 0;
  const fetcher: TodoistApiFetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://example.invalid/" } });
  };

  const client = createTodoistApiClient({ token: testCredential, projectId, fetcher });

  await assert.rejects(client.listRelayTasks(), (error: unknown) => {
    assert.ok(error instanceof TodoistApiError);
    assert.equal(error.status, 302);
    assert.equal(error.transient, false);
    return true;
  });
  assert.equal(calls, 1);
});
