import { INDELITECH_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, type ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import type { ReminderItem, TaskItem, WorkspaceState } from "@/lib/types";

export type LegacyDestinationPolicy = "personal" | "indelitech" | "review";
export type LegacyImportResult = { tasks: HostedTask[]; review: TaskItem[]; remindersForReview: ReminderItem[]; idMap: Readonly<Record<string, string>> };

function safeId(id: string) { return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id); }
function remapId(id: string) {
  let hash = 2166136261;
  for (const character of id) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function transformLegacyWorkspace(state: WorkspaceState, policy: LegacyDestinationPolicy, importedAt: string): LegacyImportResult {
  if (policy === "review") return { tasks: [], review: structuredClone(state.tasks), remindersForReview: structuredClone(state.reminders), idMap: {} };
  const destination: ProductWorkspaceId = policy === "personal" ? PERSONAL_WORKSPACE_ID : INDELITECH_WORKSPACE_ID;
  const used = new Set<string>();
  const idMap: Record<string, string> = {};
  const assignedIds = state.tasks.map((task) => {
    const original = String(task.id);
    let taskId = safeId(original) ? original : remapId(original);
    let suffix = 1;
    while (used.has(taskId)) taskId = `${remapId(original)}-${suffix++}`;
    used.add(taskId); idMap[original] = taskId;
    return taskId;
  });
  const tasks = state.tasks.map((task, index): HostedTask => {
    const original = String(task.id);
    const taskId = assignedIds[index];
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(task.due);
    return {
      taskId, primaryWorkspaceId: destination, title: task.title, context: task.description || null,
      category: null, project: null, person: null,
      type: task.recurrence ? "RECURRING" : task.due ? "DEADLINE" : "ONE_TIME",
      priority: task.priority.toLowerCase() === "high" ? "HIGH" : task.priority.toLowerCase() === "low" ? "LOW" : "MEDIUM",
      status: task.done ? "DONE" : "OPEN", dueAt: task.due || null, dueIsDateOnly: dateOnly,
      remindAt: null, followUpAt: null, estimatedDuration: null, estimatedDurationLabel: null,
      captureFingerprint: null, recurrence: task.recurrence || null,
      seriesId: task.seriesId == null ? null : (idMap[String(task.seriesId)] ?? String(task.seriesId)),
      recurrenceAnchorDay: task.recurrenceAnchorDay ?? null,
      dependency: null, createdAt: task.createdAt || importedAt,
      completedAt: task.completedAt || null, source: "legacy-local", sourceContext: JSON.stringify({
        originalId: original, seriesId: task.seriesId ?? null, recurrenceAnchorDay: task.recurrenceAnchorDay ?? null,
      }), lastNotifiedAt: null, updatedAt: importedAt,
    };
  });
  return { tasks, review: [], remindersForReview: structuredClone(state.reminders), idMap };
}
