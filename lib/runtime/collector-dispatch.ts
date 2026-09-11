import type { RequestContext } from "@/lib/runtime/context";

export const COLLECTOR_NAMES = ["industry", "mentions", "audience", "newsletters"] as const;
export type CollectorName = typeof COLLECTOR_NAMES[number];

export interface CollectorResult {
  name: CollectorName;
  ok: boolean;
  status: number;
}

export interface CollectorDispatch {
  dispatch(context: RequestContext, name: CollectorName): Promise<CollectorResult>;
  dispatchAll(context: RequestContext): Promise<CollectorResult[]>;
}

export type CollectorHandler = (context: RequestContext) => Promise<Response>;

export class CollectorService implements CollectorDispatch {
  constructor(private readonly handlers: Record<CollectorName, CollectorHandler>) {}

  async dispatch(context: RequestContext, name: CollectorName) {
    const response = await this.handlers[name](context);
    await response.body?.cancel().catch(() => undefined);
    return { name, ok: response.ok, status: response.status };
  }

  async dispatchAll(context: RequestContext) {
    const settled = await Promise.allSettled(COLLECTOR_NAMES.map((name) => this.dispatch(context, name)));
    return settled.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { name: COLLECTOR_NAMES[index], ok: false, status: 500 });
  }
}
