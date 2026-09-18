import type { JWTVerifyGetKey } from "jose";
import type { D1Database } from "@/lib/runtime/d1";
import { systemClock, webIdGenerator, type Clock, type IdGenerator } from "@/lib/runtime/primitives";
import { createAuthorizedHostedIncomeHandler } from "@/lib/server/authorized-hosted-income-handler";
import { createHostedAuthenticationSessionProvider, type HostedAuthenticationBindings } from "@/lib/server/hosted-authentication-runtime";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

export type HostedIncomeRouteBindings = Readonly<{
  DB: D1Database;
}> & HostedAuthenticationBindings;

export function createHostedIncomeRouteRuntime(
  bindings: HostedIncomeRouteBindings,
  options: { clock?: Clock; ids?: IdGenerator; accessKeyResolver?: JWTVerifyGetKey; workosKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedIncomeHandler(
    createHostedAuthenticationSessionProvider(bindings, clock, {
      accessKeyResolver: options.accessKeyResolver,
      workosKeyResolver: options.workosKeyResolver,
    }),
    new D1WorkspaceResolver(bindings.DB),
    bindings.DB,
    clock,
    options.ids ?? webIdGenerator,
  );
}
