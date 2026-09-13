import type { JWTVerifyGetKey } from "jose";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedIntelHandler } from "@/lib/server/authorized-hosted-intel-handler";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { D1CollectorSnapshotRepository } from "@/lib/server/d1-collector-snapshot-repository";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";
import type { HostedTaskRouteBindings } from "@/lib/server/hosted-task-route-runtime";

export function createHostedIntelRouteRuntime(
  bindings: HostedTaskRouteBindings,
  options: { clock?: Clock; accessKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");
  if (!bindings.TEAM_DOMAIN || !bindings.POLICY_AUD) {
    throw new Error("Cloudflare Access bindings are required.");
  }
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedIntelHandler(
    new CloudflareAccessSessionProvider({
      teamDomain: bindings.TEAM_DOMAIN,
      audience: bindings.POLICY_AUD,
      clock,
      keyResolver: options.accessKeyResolver,
    }),
    new D1WorkspaceResolver(bindings.DB),
    new D1CollectorSnapshotRepository(bindings.DB),
    clock,
  );
}
