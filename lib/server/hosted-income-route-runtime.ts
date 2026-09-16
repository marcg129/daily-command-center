import type { JWTVerifyGetKey } from "jose";
import type { D1Database } from "@/lib/runtime/d1";
import { systemClock, webIdGenerator, type Clock, type IdGenerator } from "@/lib/runtime/primitives";
import { createAuthorizedHostedIncomeHandler } from "@/lib/server/authorized-hosted-income-handler";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

export type HostedIncomeRouteBindings = Readonly<{
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
}>;

export function createHostedIncomeRouteRuntime(
  bindings: HostedIncomeRouteBindings,
  options: { clock?: Clock; ids?: IdGenerator; accessKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedIncomeHandler(
    new CloudflareAccessSessionProvider({
      teamDomain: bindings.TEAM_DOMAIN,
      audience: bindings.POLICY_AUD,
      clock,
      keyResolver: options.accessKeyResolver,
    }),
    new D1WorkspaceResolver(bindings.DB),
    bindings.DB,
    clock,
    options.ids ?? webIdGenerator,
  );
}
