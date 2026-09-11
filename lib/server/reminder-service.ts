import type { DatabaseSync } from "node:sqlite";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import type { ReminderItem } from "@/lib/types";
import { readWorkspaceState } from "@/lib/workspace-store";

function cleanReminders(value: unknown, ids: IdGenerator): ReminderItem[] {
  if (!Array.isArray(value)) throw new Error("Reminders must be a list.");
  if (value.length > 10_000) throw new Error("The reminder list is too large.");
  return value.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Partial<ReminderItem>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) return [];
    return [{ id: typeof item.id === "string" || typeof item.id === "number" ? item.id : ids.generate(), title,
      type: typeof item.type === "string" ? item.type : "Saved", source: typeof item.source === "string" ? item.source : "Manual",
      note: typeof item.note === "string" ? item.note : "Saved for later.", accent: typeof item.accent === "string" ? item.accent : "teal",
      url: typeof item.url === "string" ? item.url : undefined, createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
      archivedAt: typeof item.archivedAt === "string" ? item.archivedAt : undefined, added: typeof item.added === "string" ? item.added : undefined }];
  });
}

export function createReminderHandler(database: () => DatabaseSync, clock: Clock, ids: IdGenerator) {
  return async function PUT(request: Request) {
    try {
      const body = await request.json() as { reminders?: unknown };
      const reminders = cleanReminders(body.reminders, ids);
      const db = database();
      readWorkspaceState(db); // Fail closed if either canonical row is missing/corrupt.
      db.prepare("UPDATE workspace_state SET payload_json = ?, updated_at = ? WHERE state_key = 'reminders'")
        .run(JSON.stringify(reminders), clock.now().toISOString());
      return Response.json({ reminders });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Reminders could not be saved." }, { status: 400 });
    }
  };
}
