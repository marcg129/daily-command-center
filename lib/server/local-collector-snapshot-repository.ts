import type { DatabaseSync } from "node:sqlite";
import { readCollectorSnapshot, updateCollectorSnapshotArchive, writeCollectorSnapshot } from "@/lib/collector-cache";
import { requireLegacyWorkspace, type RequestContext } from "@/lib/runtime/context";
import type { CollectorSnapshotRepository } from "@/lib/runtime/collector-snapshot-repository";

export class LocalCollectorSnapshotRepository implements CollectorSnapshotRepository {
  constructor(private readonly database: () => DatabaseSync) {}

  async read<T>(context: RequestContext, collector: Parameters<typeof readCollectorSnapshot>[1], scope?: string) {
    requireLegacyWorkspace(context);
    return readCollectorSnapshot<T>(this.database(), collector, scope);
  }

  async write<T>(context: RequestContext, collector: Parameters<typeof writeCollectorSnapshot>[1], scope: string, payload: T, checkedAt: string) {
    requireLegacyWorkspace(context);
    return writeCollectorSnapshot(this.database(), collector, scope, payload, checkedAt);
  }

  async updateArchive(context: RequestContext, collector: Parameters<typeof updateCollectorSnapshotArchive>[1], id: string, archived: boolean, now: string) {
    requireLegacyWorkspace(context);
    return updateCollectorSnapshotArchive(this.database(), collector, id, archived, now);
  }
}
