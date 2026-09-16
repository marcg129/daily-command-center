import {
  parseStructuredTaskCapture,
  type StructuredTaskCapture,
} from "./task-capture";

export type TodoistRelayTask = Readonly<{
  id: string;
  content: string;
  description?: string | null;
}>;

const TODOIST_TASK_ID = /^[A-Za-z0-9_-]{1,96}$/;
const TRANSPORT_ONLY_KEYS = new Set(["source", "requestId"]);
const CAPTURE_METADATA_KEYS = new Map<string, keyof StructuredTaskCapture>([
  ["workspace", "workspaceId"],
  ["context", "context"],
  ["category", "category"],
  ["project", "project"],
  ["person", "person"],
  ["type", "type"],
  ["priority", "priority"],
  ["due", "due"],
  ["remindAt", "remindAt"],
  ["followUpAt", "followUpAt"],
  ["estimatedDuration", "estimatedDuration"],
  ["recurrence", "recurrence"],
  ["dependency", "dependency"],
  ["sourceContext", "sourceContext"],
]);

export class TodoistTaskIngressValidationError extends Error {}

function fail(message: string): never {
  throw new TodoistTaskIngressValidationError(message);
}

function relayMetadata(description: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) fail("Todoist relay metadata must use `key: value` lines.");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) fail("Todoist relay metadata must use `key: value` lines.");
    if (result.has(key)) fail(`Duplicate metadata field: ${key}.`);
    if (!TRANSPORT_ONLY_KEYS.has(key) && !CAPTURE_METADATA_KEYS.has(key)) {
      fail(`Unsupported metadata field: ${key}.`);
    }
    result.set(key, value);
  }
  return result;
}

/**
 * Converts one task from the dedicated Todoist relay project into the existing
 * canonical DCC structured-capture contract.
 *
 * Todoist's task ID is always authoritative for idempotency. A description may
 * contain the conversation's requestId for diagnostics, but it can never select
 * or overwrite the DCC requestId.
 */
export function parseTodoistRelayTask(task: TodoistRelayTask): StructuredTaskCapture {
  const id = task.id.trim();
  if (!TODOIST_TASK_ID.test(id)) fail("Todoist task id is invalid.");

  const title = task.content.trim();
  if (!title) fail("title is required.");

  const metadata = relayMetadata(task.description ?? "");
  const capture: Record<string, unknown> = {
    requestId: `todoist:${id}`,
    title,
  };

  for (const [transportKey, captureKey] of CAPTURE_METADATA_KEYS) {
    if (!metadata.has(transportKey)) continue;
    capture[captureKey] = metadata.get(transportKey);
  }

  const parsed = parseStructuredTaskCapture(capture);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  ) as StructuredTaskCapture;
}
