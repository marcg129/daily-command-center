import type { JWTVerifyGetKey } from "jose";
import type { D1Database } from "@/lib/runtime/d1";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedTaskSurfaceHandler } from "@/lib/server/authorized-hosted-task-surface-handler";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

export type HostedTaskRouteBindings = Readonly<{
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
}>;

export function createHostedTaskRouteRuntime(
  bindings: HostedTaskRouteBindings,
  options: { clock?: Clock; accessKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedTaskSurfaceHandler(
    new CloudflareAccessSessionProvider({
      teamDomain: bindings.TEAM_DOMAIN,
      audience: bindings.POLICY_AUD,
      clock,
      keyResolver: options.accessKeyResolver,
    }),
    new D1WorkspaceResolver(bindings.DB),
    bindings.DB,
    clock,
  );
}
