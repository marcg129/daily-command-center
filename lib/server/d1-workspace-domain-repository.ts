import type { D1Database } from "@/lib/runtime/d1";
import { requireHostedContext, type RequestContext } from "@/lib/runtime/context";
import type { WorkspaceDomain, WorkspaceDomainRecord, WorkspaceDomainRepository } from "@/lib/runtime/workspace-domain-repository";

export class D1WorkspaceDomainRepository implements WorkspaceDomainRepository {
  constructor(private readonly database: D1Database) {}
  async get<T>(context: RequestContext, domain: WorkspaceDomain, key: string) {
    requireHostedContext(context);
    const row = await this.database.prepare("SELECT record_key, payload_json, updated_at FROM workspace_domain_records WHERE workspace_id = ? AND domain = ? AND record_key = ?")
      .bind(context.workspaceId, domain, key).first<{record_key:string;payload_json:string;updated_at:string}>();
    return row ? { key: row.record_key, value: JSON.parse(row.payload_json) as T, updatedAt: row.updated_at } : null;
  }
  async put<T>(context: RequestContext, domain: WorkspaceDomain, record: WorkspaceDomainRecord<T>) {
    requireHostedContext(context);
    const result = await this.database.prepare(`INSERT INTO workspace_domain_records (workspace_id, domain, record_key, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, domain, record_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .bind(context.workspaceId, domain, record.key, JSON.stringify(record.value), record.updatedAt).run();
    if (!result.success) throw new Error("D1 workspace domain write failed.");
  }
  async delete(context: RequestContext, domain: WorkspaceDomain, key: string) {
    requireHostedContext(context);
    const result = await this.database.prepare("DELETE FROM workspace_domain_records WHERE workspace_id = ? AND domain = ? AND record_key = ?")
      .bind(context.workspaceId, domain, key).run();
    if (!result.success) throw new Error("D1 workspace domain delete failed.");
  }
  async list<T>(context: RequestContext, domain: WorkspaceDomain) {
    requireHostedContext(context);
    const result = await this.database.prepare("SELECT record_key, payload_json, updated_at FROM workspace_domain_records WHERE workspace_id = ? AND domain = ? ORDER BY updated_at DESC, record_key")
      .bind(context.workspaceId, domain).all<{record_key:string;payload_json:string;updated_at:string}>();
    if (!result.success) throw new Error("D1 workspace domain read failed.");
    return (result.results ?? []).map((row) => ({ key: row.record_key, value: JSON.parse(row.payload_json) as T, updatedAt: row.updated_at }));
  }
}
