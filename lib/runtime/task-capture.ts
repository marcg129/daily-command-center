import { isProductWorkspaceId, type ProductWorkspaceId } from "./context";
import type { Clock } from "./primitives";
import type { TaskMutationRepository } from "./task-mutations";
import type { TaskItem } from "../types";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const TYPES = ["ONE_TIME", "DEADLINE", "FOLLOW_UP", "WAITING", "RECURRING", "BACKLOG"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const RECURRENCES = ["One-time", "Daily", "Weekly", "Monthly"] as const;
const DURATIONS = ["5m", "15m", "30m", "1h", "2h+", "Project"] as const;
const ALLOWED_KEYS = new Set([
  "requestId", "workspaceId", "title", "context", "category", "project", "person", "type",
  "priority", "due", "remindAt", "followUpAt", "estimatedDuration", "recurrence",
  "dependency", "sourceContext",
]);

export type StructuredTaskCapture = {
  requestId: string;
  workspaceId: ProductWorkspaceId;
  title: string;
  context?: string;
  category?: string;
  project?: string;
  person?: string;
  type?: typeof TYPES[number];
  priority?: typeof PRIORITIES[number];
  due?: string | null;
  remindAt?: string | null;
  followUpAt?: string | null;
  estimatedDuration?: typeof DURATIONS[number];
  recurrence?: typeof RECURRENCES[number];
  dependency?: string;
  sourceContext?: string;
};

export type CaptureInterpretation = Pick<TaskItem, "type" | "priority" | "due" | "remindAt" | "followUpAt" | "recurrence"> & {
  workspaceId: ProductWorkspaceId;
};
export type TaskCaptureResult = { created: boolean; task: TaskItem; interpretation: CaptureInterpretation };

export class TaskCaptureValidationError extends Error {}
export class TaskCaptureConflictError extends Error {}

function fail(message: string): never { throw new TaskCaptureValidationError(message); }
function optionalText(value: unknown, name: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${name} must be a string.`);
  return value.trim() || undefined;
}
function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) fail(`${name} is invalid.`);
  return value as T;
}
function timestamp(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value)))
    fail(`${name} must be an ISO timestamp with a timezone.`);
  return new Date(value).toISOString();
}
function dueDate(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !DATE_ONLY.test(value)) fail("due must use YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day)
    fail("due must be a valid calendar date.");
  return value;
}

export function parseStructuredTaskCapture(value: unknown): StructuredTaskCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("A structured capture object is required.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) fail("The capture contains an unsupported field.");
  if (typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId)) fail("requestId is invalid.");
  if (!isProductWorkspaceId(input.workspaceId)) fail("workspaceId must be personal or indelitech.");
  const title = optionalText(input.title, "title");
  if (!title) fail("title is required.");
  const recurrence = enumValue(input.recurrence, RECURRENCES, "recurrence");
  const type = enumValue(input.type, TYPES, "type");
  const due = dueDate(input.due);
  const person = optionalText(input.person, "person");
  const followUpAt = timestamp(input.followUpAt, "followUpAt");
  if (type === "WAITING" && (!person || !followUpAt)) fail("WAITING requires person and followUpAt.");
  const repeats = recurrence !== undefined && recurrence !== "One-time";
  if (repeats && type !== undefined && type !== "RECURRING") fail("A repeating recurrence requires type RECURRING.");
  if (type === "RECURRING" && (!repeats || !due)) fail("RECURRING requires a repeating recurrence and due date.");
  if (repeats && !due) fail("A repeating recurrence requires a due date.");
  return {
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    title,
    context: optionalText(input.context, "context"),
    category: optionalText(input.category, "category"),
    project: optionalText(input.project, "project"),
    person,
    type,
    priority: enumValue(input.priority, PRIORITIES, "priority"),
    due: due || null,
    remindAt: timestamp(input.remindAt, "remindAt") || null,
    followUpAt: followUpAt || null,
    estimatedDuration: enumValue(input.estimatedDuration, DURATIONS, "estimatedDuration"),
    recurrence,
    dependency: optionalText(input.dependency, "dependency"),
    sourceContext: optionalText(input.sourceContext, "sourceContext"),
  };
}

function taskFromCapture(input: StructuredTaskCapture, now: string): TaskItem {
  const recurrence = input.recurrence ?? "One-time";
  const due = input.due ?? "";
  const recurring = recurrence !== "One-time";
  const type = recurring ? "RECURRING" : input.type ?? (due ? "DEADLINE" : "ONE_TIME");
  return {
    id: `capture:${input.requestId}`, title: input.title, description: input.context || "No additional details.",
    due, recurrence, priority: input.priority ?? "MEDIUM", primaryWorkspaceId: input.workspaceId,
    done: false, type, status: type === "WAITING" ? "WAITING" : "OPEN",
    remindAt: input.remindAt || undefined, followUpAt: input.followUpAt || undefined,
    person: input.person, category: input.category, project: input.project,
    estimatedDuration: input.estimatedDuration, dependency: input.dependency,
    source: "send-to-tasks", sourceContext: input.sourceContext, createdAt: now, updatedAt: now,
  };
}
function comparable(task: TaskItem) {
  return JSON.stringify({
    id: task.id, title: task.title, description: task.description, due: task.due,
    recurrence: task.recurrence, priority: task.priority, primaryWorkspaceId: task.primaryWorkspaceId,
    done: task.done, type: task.type, status: task.status, remindAt: task.remindAt,
    followUpAt: task.followUpAt, person: task.person, category: task.category, project: task.project,
    estimatedDuration: task.estimatedDuration, dependency: task.dependency, source: task.source,
    sourceContext: task.sourceContext,
  });
}
function interpretation(task: TaskItem): CaptureInterpretation {
  return { workspaceId: task.primaryWorkspaceId!, type: task.type!, priority: task.priority,
    due: task.due, remindAt: task.remindAt, followUpAt: task.followUpAt, recurrence: task.recurrence };
}

export function createStructuredTaskCaptureService(repository: TaskMutationRepository, clock: Clock) {
  return async (value: unknown): Promise<TaskCaptureResult> => {
    const input = parseStructuredTaskCapture(value);
    const existing = (await repository.read()).find((task) => task.id === `capture:${input.requestId}`);
    const now = clock.now().toISOString();
    const candidate = taskFromCapture(input, now);
    if (existing) {
      if (existing.source !== "send-to-tasks" || comparable(existing) !== comparable(candidate))
        throw new TaskCaptureConflictError("requestId is already associated with a different task capture.");
      return { created: false, task: existing, interpretation: interpretation(existing) };
    }
    try {
      const tasks = await repository.apply([{ kind: "CREATE", task: candidate }], now);
      const saved = tasks.find((task) => task.id === candidate.id) ?? candidate;
      return { created: true, task: saved, interpretation: interpretation(saved) };
    } catch (error) {
      // A concurrent identical delivery can win between read and atomic CREATE.
      const raced = (await repository.read()).find((task) => task.id === candidate.id);
      if (raced && raced.source === "send-to-tasks" && comparable(raced) === comparable(candidate))
        return { created: false, task: raced, interpretation: interpretation(raced) };
      if (raced) throw new TaskCaptureConflictError("requestId is already associated with a different task capture.");
      throw error;
    }
  };
}
