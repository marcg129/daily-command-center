import type { CollectorCacheKey } from "@/lib/collector-cache";
import type { RequestContext } from "@/lib/runtime/context";

export type CollectorSnapshot<T> = { scope: string; checkedAt: string; payload: T };

export interface CollectorSnapshotRepository {
  read<T>(context: RequestContext, collector: CollectorCacheKey, scope?: string): Promise<CollectorSnapshot<T> | null>;
  write<T>(context: RequestContext, collector: CollectorCacheKey, scope: string, payload: T, checkedAt: string): Promise<T>;
  updateArchive(context: RequestContext, collector: CollectorCacheKey, id: string, archived: boolean, now: string): Promise<boolean>;
}
