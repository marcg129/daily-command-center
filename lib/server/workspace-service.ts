import type { ReminderItem, WorkspaceState } from "@/lib/types";
import { cleanTaskItems } from "@/lib/tasks";
import type { RequestContext } from "@/lib/runtime/context";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import type { WorkspaceRepository } from "@/lib/runtime/workspace-repository";


type WorkspaceRouteDependencies = {
  repository: WorkspaceRepository;
  context: () => RequestContext;
  clock: Clock;
  ids: IdGenerator;
  legacyImportAllowed: () => boolean;
};

function cleanId(value: unknown, ids: IdGenerator) {
  return typeof value === "string" || typeof value === "number" ? value : ids.generate();
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanReminders(value: unknown, ids: IdGenerator): ReminderItem[] {
  if (!Array.isArray(value)) throw new Error("Reminders must be a list.");
  if (value.length > 10_000) throw new Error("The reminder list is too large.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ReminderItem>;
    const title = cleanText(candidate.title).trim();
    if (!title) return [];
    return [{
      id: cleanId(candidate.id, ids),
      type: cleanText(candidate.type, candidate.url ? "Link" : "Saved"),
      title,
      source: cleanText(candidate.source, "Manual"),
      note: cleanText(candidate.note, "Saved for later."),
      accent: cleanText(candidate.accent, "teal"),
      url: cleanText(candidate.url) || undefined,
      createdAt: cleanText(candidate.createdAt) || undefined,
      archivedAt: cleanText(candidate.archivedAt) || undefined,
      added: cleanText(candidate.added) || undefined,
    }];
  });
}

export function createWorkspaceHandlers(dependencies: WorkspaceRouteDependencies) {
  return {
    async GET() {
      try {
        const context = dependencies.context();
        return Response.json({
          ...await dependencies.repository.read(context),
          initialized: await dependencies.repository.isInitialized(context),
          legacyBrowserImportAllowed: dependencies.legacyImportAllowed(),
        });
      } catch {
        return Response.json(
          { error: "Tasks and reminders could not be read safely. Restore the local database from a backup before making changes." },
          { status: 500 },
        );
      }
    },
    async PUT(request: Request) {
      try {
        const body = await request.json() as Partial<WorkspaceState>;
        const state: WorkspaceState = {
          reminders: cleanReminders(body.reminders, dependencies.ids),
          tasks: cleanTaskItems(body.tasks),
        };
        return Response.json(await dependencies.repository.write(
          dependencies.context(),
          state,
          dependencies.clock.now().toISOString(),
        ));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not save the local workspace." }, { status: 400 });
      }
    },
  };
}

