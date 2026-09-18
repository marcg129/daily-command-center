import type { JWTVerifyGetKey } from "jose";
import type { D1Database } from "@/lib/runtime/d1";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedTaskCaptureHandler } from "@/lib/server/authorized-hosted-task-capture-handler";
import { createHostedAuthenticationSessionProvider, type HostedAuthenticationBindings } from "@/lib/server/hosted-authentication-runtime";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

export type HostedTaskCaptureBindings = Readonly<{
  DB: D1Database;
}> & HostedAuthenticationBindings;

export type HostedTaskCaptureRuntimeOptions = Readonly<{
  clock?: Clock;
  /** Test seam only. Production uses Cloudflare Access remote JWKS. */
  accessKeyResolver?: JWTVerifyGetKey;
  /** Test seam only. Production uses the configured WorkOS remote JWKS. */
  workosKeyResolver?: JWTVerifyGetKey;
}>;

/**
 * Composes the complete hosted structured-capture security/persistence stack
 * from runtime bindings without depending on a specific Worker framework API.
 */
export function createHostedTaskCaptureRuntime(
  bindings: HostedTaskCaptureBindings,
  options: HostedTaskCaptureRuntimeOptions = {},
) {
  if (!bindings?.DB) throw new Error("A D1 DB binding is required.");

  const clock = options.clock ?? systemClock;
  const sessionProvider = createHostedAuthenticationSessionProvider(
    bindings,
    clock,
    {
      accessKeyResolver: options.accessKeyResolver,
      workosKeyResolver: options.workosKeyResolver,
    },
  );
  const workspaceResolver = new D1WorkspaceResolver(bindings.DB);
  const taskRepository = new D1TaskRepository(bindings.DB);

  return createAuthorizedHostedTaskCaptureHandler(
    sessionProvider,
    workspaceResolver,
    taskRepository,
    clock,
  );
}
