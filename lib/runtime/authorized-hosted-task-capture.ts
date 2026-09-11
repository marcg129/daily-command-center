import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import {
  createHostedStructuredTaskCaptureService,
  type HostedTaskCaptureResult,
} from "@/lib/runtime/hosted-task-capture";
import type { Clock } from "@/lib/runtime/primitives";
import {
  requireAuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

export type AuthorizedHostedTaskCaptureRequest = Readonly<{
  /** Opaque identity supplied by a future trusted transport/auth adapter. */
  sessionIdentity: string | null | undefined;
  requestedWorkspaceId: string;
  capture: unknown;
}>;

/**
 * Transport-neutral authorization composition for hosted structured capture.
 *
 * This service deliberately does not inspect HTTP headers, cookies, JWTs, or
 * Cloudflare Access assertions. A future trusted adapter must derive the opaque
 * session identity before calling this boundary.
 */
export function createAuthorizedHostedTaskCaptureService(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  repository: HostedTaskRepository,
  clock: Clock,
) {
  const capture = createHostedStructuredTaskCaptureService(repository, clock);

  return async function authorizedCapture(
    request: AuthorizedHostedTaskCaptureRequest,
  ): Promise<HostedTaskCaptureResult> {
    const session = await sessionProvider.getSession(request.sessionIdentity);
    const principal = requireAuthenticatedSession(session, clock.now());
    const context = await workspaceResolver.resolve(
      principal,
      request.requestedWorkspaceId,
    );
    return capture(context, request.capture);
  };
}
