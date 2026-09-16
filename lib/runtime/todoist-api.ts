import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import { TodoistRelayTransportError } from "@/lib/runtime/todoist-task-ingress-service";

const TODOIST_API_ORIGIN = "https://api.todoist.com";
const PAGE_LIMIT = 200;
const MAX_PAGES = 20;
const FAILURE_LABEL = "dcc-failed";

export type TodoistApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ClientOptions = Readonly<{
  token: string;
  projectId: string;
  fetcher?: TodoistApiFetch;
}>;

type TodoistTaskPayload = Readonly<{
  id: string;
  content?: string;
  description?: string | null;
  labels?: unknown;
}>;

type TodoistCommentPayload = Readonly<{
  id?: string;
  content?: string | null;
}>;

type Page<T> = Readonly<{
  results: T[];
  next_cursor: string | null;
}>;

export class TodoistApiError extends TodoistRelayTransportError {
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      transient: boolean;
      status?: number | null;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message, {
      transient: options.transient,
      retryAfterSeconds: options.retryAfterSeconds,
    });
    this.name = "TodoistApiError";
    this.status = options.status ?? null;
  }
}

function required(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function boundedRetryAfter(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(86_400, Math.ceil(parsed));
}

async function errorRetryAfter(response: Response): Promise<number | null> {
  let bodyRetry: number | null = null;
  try {
    const payload = await response.clone().json() as {
      error_extra?: { retry_after?: unknown } | null;
    };
    bodyRetry = boundedRetryAfter(payload?.error_extra?.retry_after);
  } catch {
    // Error bodies are provider-controlled and never surfaced directly.
  }
  return bodyRetry ?? boundedRetryAfter(response.headers.get("retry-after"));
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function apiUrl(pathname: string, search?: URLSearchParams): string {
  const url = new URL(pathname, TODOIST_API_ORIGIN);
  if (search) url.search = search.toString();
  return url.toString();
}

function taskFromPayload(value: unknown): TodoistRelayTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TodoistApiError("Todoist returned an invalid task payload.", { transient: true });
  }
  const task = value as TodoistTaskPayload;
  if (typeof task.id !== "string" || typeof task.content !== "string") {
    throw new TodoistApiError("Todoist returned an invalid task payload.", { transient: true });
  }
  return {
    id: task.id,
    content: task.content,
    description: typeof task.description === "string" ? task.description : "",
  };
}

function labelsFromPayload(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TodoistApiError("Todoist returned an invalid task payload.", { transient: true });
  }
  const labels = (value as TodoistTaskPayload).labels;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) {
    throw new TodoistApiError("Todoist returned an invalid task label payload.", { transient: true });
  }
  return labels as string[];
}

function pageFromPayload<T>(value: unknown, itemParser: (item: unknown) => T): Page<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TodoistApiError("Todoist returned an invalid paginated response.", { transient: true });
  }
  const payload = value as { results?: unknown; next_cursor?: unknown };
  if (!Array.isArray(payload.results)) {
    throw new TodoistApiError("Todoist returned an invalid paginated response.", { transient: true });
  }
  if (payload.next_cursor !== null && payload.next_cursor !== undefined && typeof payload.next_cursor !== "string") {
    throw new TodoistApiError("Todoist returned an invalid pagination cursor.", { transient: true });
  }
  return {
    results: payload.results.map(itemParser),
    next_cursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

export function createTodoistApiClient(options: ClientOptions) {
  const token = required(options.token, "Todoist token is required.");
  const projectId = required(options.projectId, "Todoist project ID is required.");
  const fetcher = options.fetcher ?? fetch;

  async function request(pathname: string, init: RequestInit = {}, search?: URLSearchParams): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await fetcher(apiUrl(pathname, search), {
        ...init,
        headers,
        redirect: "error",
      });
    } catch {
      throw new TodoistApiError("Todoist request failed before a response was received.", {
        transient: true,
      });
    }

    if (!response.ok) {
      const retryAfterSeconds = await errorRetryAfter(response);
      const status = response.status;
      throw new TodoistApiError(
        status === 401 || status === 403
          ? "Todoist authorization failed."
          : `Todoist request failed with HTTP ${status}.`,
        {
          transient: transientStatus(status),
          status,
          retryAfterSeconds,
        },
      );
    }
    return response;
  }

  async function json(pathname: string, init: RequestInit = {}, search?: URLSearchParams): Promise<unknown> {
    const response = await request(pathname, init, search);
    try {
      return await response.json();
    } catch {
      throw new TodoistApiError("Todoist returned an invalid JSON response.", { transient: true, status: response.status });
    }
  }

  async function paginated<T>(
    pathname: string,
    baseParams: Readonly<Record<string, string>>,
    itemParser: (item: unknown) => T,
  ): Promise<T[]> {
    const results: T[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const search = new URLSearchParams(baseParams);
      search.set("limit", String(PAGE_LIMIT));
      if (cursor !== null) search.set("cursor", cursor);

      const page = pageFromPayload(await json(pathname, {}, search), itemParser);
      results.push(...page.results);
      if (page.next_cursor === null) return results;
      if (seenCursors.has(page.next_cursor)) {
        throw new TodoistApiError("Todoist pagination cursor repeated.", { transient: true });
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }

    throw new TodoistApiError("Todoist pagination exceeded the configured page bound.", { transient: true });
  }

  async function listRelayTasks(): Promise<TodoistRelayTask[]> {
    return paginated("/api/v1/tasks", { project_id: projectId }, taskFromPayload);
  }

  async function closeTask(taskId: string): Promise<void> {
    const id = required(taskId, "Todoist task ID is required.");
    await request(`/api/v1/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
  }

  async function getTaskLabels(taskId: string): Promise<string[]> {
    const id = required(taskId, "Todoist task ID is required.");
    const payload = await json(`/api/v1/tasks/${encodeURIComponent(id)}`);
    return labelsFromPayload(payload);
  }

  async function existingCommentContents(taskId: string): Promise<Set<string>> {
    const comments = await paginated(
      "/api/v1/comments",
      { task_id: taskId },
      (value): string => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TodoistApiError("Todoist returned an invalid comment payload.", { transient: true });
        }
        const content = (value as TodoistCommentPayload).content;
        if (typeof content !== "string") {
          throw new TodoistApiError("Todoist returned an invalid comment payload.", { transient: true });
        }
        return content;
      },
    );
    return new Set(comments);
  }

  async function markFailure(taskId: string, diagnostic: string): Promise<void> {
    const id = required(taskId, "Todoist task ID is required.");
    const message = required(diagnostic, "Todoist failure diagnostic is required.");
    const labels = await getTaskLabels(id);
    if (!labels.includes(FAILURE_LABEL)) {
      await json(`/api/v1/tasks/${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify({ labels: [...labels, FAILURE_LABEL] }),
      });
    }

    const comments = await existingCommentContents(id);
    if (!comments.has(message)) {
      await json("/api/v1/comments", {
        method: "POST",
        body: JSON.stringify({ task_id: id, content: message }),
      });
    }
  }

  return {
    listRelayTasks,
    closeTask,
    markFailure,
  };
}
