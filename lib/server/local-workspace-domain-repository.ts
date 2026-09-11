import type { DatabaseSync } from "node:sqlite";
import { requireLegacyWorkspace, type RequestContext } from "@/lib/runtime/context";
import type { WorkspaceDomain, WorkspaceDomainRecord, WorkspaceDomainRepository } from "@/lib/runtime/workspace-domain-repository";

/** Local compatibility adapter; current specialized local stores remain the default route implementations. */
export class LocalWorkspaceDomainRepository implements WorkspaceDomainRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS local_workspace_domain_records (domain TEXT NOT NULL, record_key TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(domain, record_key))`);
  }
  async get<T>(context: RequestContext, domain: WorkspaceDomain, key: string) { requireLegacyWorkspace(context); const row = this.database.prepare("SELECT payload_json, updated_at FROM local_workspace_domain_records WHERE domain = ? AND record_key = ?").get(domain,key) as {payload_json:string;updated_at:string}|undefined; return row ? {key,value:JSON.parse(row.payload_json) as T,updatedAt:row.updated_at}:null; }
  async put<T>(context: RequestContext, domain: WorkspaceDomain, record: WorkspaceDomainRecord<T>) { requireLegacyWorkspace(context); this.database.prepare("INSERT INTO local_workspace_domain_records VALUES (?, ?, ?, ?) ON CONFLICT(domain, record_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at").run(domain,record.key,JSON.stringify(record.value),record.updatedAt); }
  async delete(context: RequestContext, domain: WorkspaceDomain, key: string) { requireLegacyWorkspace(context); this.database.prepare("DELETE FROM local_workspace_domain_records WHERE domain=? AND record_key=?").run(domain,key); }
  async list<T>(context: RequestContext, domain: WorkspaceDomain) { requireLegacyWorkspace(context); return (this.database.prepare("SELECT record_key,payload_json,updated_at FROM local_workspace_domain_records WHERE domain=? ORDER BY updated_at DESC,record_key").all(domain) as Array<{record_key:string;payload_json:string;updated_at:string}>).map(row=>({key:row.record_key,value:JSON.parse(row.payload_json) as T,updatedAt:row.updated_at})); }
}
