import "server-only";

import { CollectorService } from "@/lib/runtime/collector-dispatch";
import { requireLegacyWorkspace } from "@/lib/runtime/context";

function localRequest(path: string) {
  return new Request(`http://127.0.0.1${path}`);
}

export const localCollectorService = new CollectorService({
  industry: async (context) => {
    requireLegacyWorkspace(context);
    const { GET } = await import("@/app/api/live/industry/route");
    return GET(localRequest("/api/live/industry?refresh=1"));
  },
  mentions: async (context) => {
    requireLegacyWorkspace(context);
    const { GET } = await import("@/app/api/live/mentions/route");
    return GET(localRequest("/api/live/mentions?refresh=1"));
  },
  audience: async (context) => {
    requireLegacyWorkspace(context);
    const { GET } = await import("@/app/api/live/audience/route");
    return GET(localRequest("/api/live/audience?refresh=1"));
  },
  newsletters: async (context) => {
    requireLegacyWorkspace(context);
    const { GET } = await import("@/app/api/live/newsletters/route");
    return GET(localRequest("/api/live/newsletters?refresh=1"));
  },
});
