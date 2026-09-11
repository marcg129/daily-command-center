import type { RequestContext } from "@/lib/runtime/context";

export interface SnapshotRepository<T> {
  read(context: RequestContext): Promise<T>;
  write(context: RequestContext, value: T): Promise<void>;
}
