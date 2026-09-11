import type { RequestContext, ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";

export interface HostedTaskRepository {
  list(context: RequestContext): Promise<HostedTask[]>;
  get(context: RequestContext, taskId: string): Promise<HostedTask | null>;
  create(context: RequestContext, task: HostedTask, visibleIn: readonly ProductWorkspaceId[]): Promise<HostedTask>;
  update(context: RequestContext, task: HostedTask): Promise<HostedTask>;
}
