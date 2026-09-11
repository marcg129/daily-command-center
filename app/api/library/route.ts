import { getDatabase, setContentArchived, type ContentCategory } from "@/lib/server/database";
import { legacyRequestContext } from "@/lib/runtime/context";
import { LocalCollectorSnapshotRepository } from "@/lib/server/local-collector-snapshot-repository";

export const runtime = "nodejs";

const categories = new Set<ContentCategory>(["industry", "mentions", "newsletters"]);

export async function PATCH(request: Request) {
  const database = getDatabase();
  const snapshots = new LocalCollectorSnapshotRepository(() => database);
  let transactionOpen = false;
  try {
    const body = await request.json() as { category?: ContentCategory; id?: string; archived?: boolean };
    if (!body.category || !categories.has(body.category) || !body.id || typeof body.archived !== "boolean") {
      return Response.json({ error: "Category, item ID, and archived state are required." }, { status: 400 });
    }
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const updated = setContentArchived(
      database,
      body.category,
      body.id,
      body.archived,
      now,
    );
    if (!updated) {
      database.exec("ROLLBACK");
      transactionOpen = false;
      return Response.json({ error: "Saved item was not found." }, { status: 404 });
    }
    await snapshots.updateArchive(
      legacyRequestContext(),
      body.category,
      body.id,
      body.archived,
      now,
    );
    database.exec("COMMIT");
    transactionOpen = false;
    return Response.json({ ok: true });
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original archive error.
      }
    }
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the archive." }, { status: 400 });
  }
}
