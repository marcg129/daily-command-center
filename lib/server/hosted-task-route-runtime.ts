import type { JWTVerifyGetKey } from "jose";
import type { D1Database } from "@/lib/runtime/d1";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedTaskSurfaceHandler } from "@/lib/server/authorized-hosted-task-surface-handler";
import { createHostedAuthenticationSessionProvider, type HostedAuthenticationBindings } from "@/lib/server/hosted-authentication-runtime";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

export type HostedTaskRouteBindings = Readonly<{\n  DB: D1Database;\n}> & HostedAuthenticationBindings;

export function createHostedTaskRouteRuntime(
  bindings: HostedTaskRouteBindings,
  options: { clock?: Clock; accessKeyResolver?: JWTVerifyGetKey; workosKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedTaskSurfaceHandler(
    createHostedAuthenticationSessionProvider(bindings, clock, {
      accessKeyResolver: options.accessKeyResolver,
      workosKeyResolver: options.workosKeyResolver,
    }),
    new D1WorkspaceResolver(bindings.DB),
    bindings.DB,
    clock,
  );
}
