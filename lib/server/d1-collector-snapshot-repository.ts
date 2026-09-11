import type { CollectorCacheKey } from "@/lib/collector-cache";
import { isProductWorkspaceId, requireRequestContext, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { CollectorSnapshot, CollectorSnapshotRepository } from "@/lib/runtime/collector-snapshot-repository";
import { applyArchiveToPayload, type CachedFeedPayload } from "@/lib/live-response";

export class D1CollectorSnapshotRepository implements CollectorSnapshotRepository {
  constructor(private readonly database: D1Database) {}
  private workspace(context: RequestContext) {
    requireRequestContext(context);
    if (!isProductWorkspaceId(context.workspaceId)) throw new Error("A hosted product workspace context is required.");
    return context.workspaceId;
  }
  async read<T>(context: RequestContext, collector: CollectorCacheKey, scope?: string): Promise<CollectorSnapshot<T> | null> {
    const workspace = this.workspace(context);
    const row = await this.database.prepare(`SELECT scope, checked_at, payload_json FROM collector_snapshots
      WHERE workspace_id=? AND collector=?${scope === undefined ? "" : " AND scope=?"} ORDER BY checked_at DESC LIMIT 1`)
      .bind(...(scope === undefined ? [workspace, collector] : [workspace, collector, scope])).first<{ scope: string; checked_at: string; payload_json: string }>();
    return row ? { scope: row.scope, checkedAt: row.checked_at, payload: JSON.parse(row.payload_json) as T } : null;
  }
  async write<T>(context: RequestContext, collector: CollectorCacheKey, scope: string, payload: T, checkedAt: string): Promise<T> {
    const workspace = this.workspace(context);
    const result = await this.database.prepare(`INSERT INTO collector_snapshots (workspace_id, collector, scope, payload_json, checked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, collector, scope) DO UPDATE SET payload_json=excluded.payload_json,
      checked_at=excluded.checked_at, updated_at=excluded.updated_at`).bind(workspace, collector, scope, JSON.stringify(payload), checkedAt, checkedAt).run();
    if (!result.success) throw new Error("D1 collector snapshot write failed.");
    return payload;
  }
  async updateArchive(context: RequestContext, collector: CollectorCacheKey, id: string, archived: boolean, now: string) {
    const snapshot = await this.read<Record<string, unknown>>(context, collector);
    if (!snapshot) return false;
    const payload = snapshot.payload as Partial<CachedFeedPayload>;
    if (!Array.isArray(payload.items)) return false;
    const candidates = [...payload.items, ...(Array.isArray(payload.archivedItems) ? payload.archivedItems : [])];
    if (!candidates.some((item) => item.id === id)) return false;
    const updated = applyArchiveToPayload(payload as CachedFeedPayload, id, archived, now);
    await this.write(context, collector, snapshot.scope, updated, snapshot.checkedAt);
    return true;
  }
}
