import { isProductWorkspaceId } from "@/lib/runtime/context";
import {
  createAuthorizedHostedTaskCaptureService,
} from "@/lib/runtime/authorized-hosted-task-capture";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { Clock } from "@/lib/runtime/primitives";
import type { SessionProvider } from "@/lib/runtime/session";
import {
  TaskCaptureConflictError,
  TaskCaptureValidationError,
} from "@/lib/runtime/task-capture";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

/**
 * HTTP-shaped adapter for the already-authorized hosted structured-capture
 * service. This boundary trusts no request identity by itself: the raw Access
 * assertion is passed to SessionProvider for cryptographic verification before
 * WorkspaceResolver grants are consulted and before persistence is attempted.
 */
export function createAuthorizedHostedTaskCaptureHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  repository: HostedTaskRepository,
  clock: Clock,
) {
  const capture = createAuthorizedHostedTaskCaptureService(
    sessionProvider,
    workspaceResolver,
    repository,
    clock,
  );

  return async function POST(request: Request) {
    const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
    if (!assertion) return jsonError("Authentication required.", 403);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("A structured capture object is required.", 400);
    }

    const requestedWorkspaceId = (body as Record<string, unknown>).workspaceId;
    if (!isProductWorkspaceId(requestedWorkspaceId)) {
      return jsonError("workspaceId must be personal or indelitech.", 400);
    }

    try {
      const result = await capture({
        sessionIdentity: assertion,
        requestedWorkspaceId,
        capture: body,
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof TaskCaptureValidationError) {
        return jsonError(error.message, 400);
      }
      if (error instanceof TaskCaptureConflictError) {
        return jsonError(error.message, 409);
      }
      if (error instanceof Error && error.message === "Authentication required.") {
        return jsonError("Authentication required.", 403);
      }
      if (error instanceof Error && error.message === "Workspace access denied.") {
        return jsonError("Workspace access denied.", 403);
      }
      return jsonError("Task capture could not be saved safely.", 500);
    }
  };
}
