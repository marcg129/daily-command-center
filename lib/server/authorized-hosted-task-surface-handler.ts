import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { Clock } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import type { TaskMutation } from "@/lib/runtime/task-mutations";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import type { D1Database } from "@/lib/runtime/d1";
import { D1TaskMutationRepository } from "@/lib/server/d1-task-mutation-repository";
import { readHostedWorkspace } from "@/lib/server/hosted-workspace-read-adapter";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function isMutationValidationError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error &&
    /task|mutation|update|ownership|required|must|cannot|only|unknown|visible/i.test(error.message));
}

type AuthorizationResult =
  | { authorized: true; context: RequestContext }
  | { authorized: false; response: Response };

async function authorize(
  request: Request,
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  clock: Clock,
): Promise<AuthorizationResult> {
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  if (!assertion) return { authorized: false, response: errorResponse("Authentication required.", 403) };

  const session = await sessionProvider.getSession(assertion);
  const principal = requireAuthenticatedSession(session, clock.now());
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!isProductWorkspaceId(workspaceId)) {
    return { authorized: false, response: errorResponse("workspaceId must be personal or indelitech.", 400) };
  }
  const context = await workspaceResolver.resolve(principal, workspaceId);
  return { authorized: true, context };
}

/**
 * Composes authentication, the exact workspace grant, and D1 task access in
 * that order. The repository is deliberately not constructed until the grant
 * has resolved.
 */
export function createAuthorizedHostedTaskSurfaceHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  database: D1Database,
  clock: Clock,
) {
  return {
    async GET(request: Request) {
      try {
        const authorization = await authorize(request, sessionProvider, workspaceResolver, clock);
        if (!authorization.authorized) return authorization.response;
        return Response.json(await readHostedWorkspace(
          new D1TaskMutationRepository(database, authorization.context),
        ));
      } catch (error) {
        if (error instanceof Error && error.message === "Authentication required.") {
          return errorResponse("Authentication required.", 403);
        }
        if (error instanceof Error && error.message === "Workspace access denied.") {
          return errorResponse("Workspace access denied.", 403);
        }
        return errorResponse("Workspace could not be read safely.", 500);
      }
    },

    async POST(request: Request) {
      let authorization: AuthorizationResult;
      try {
        authorization = await authorize(request, sessionProvider, workspaceResolver, clock);
      } catch (error) {
        if (error instanceof Error && error.message === "Authentication required.") {
          return errorResponse("Authentication required.", 403);
        }
        if (error instanceof Error && error.message === "Workspace access denied.") {
          return errorResponse("Workspace access denied.", 403);
        }
        return errorResponse("Task mutations could not be saved safely.", 500);
      }
      if (!authorization.authorized) return authorization.response;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Request body must be valid JSON.", 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          !Array.isArray((body as { mutations?: unknown }).mutations) ||
          (body as { mutations: unknown[] }).mutations.length === 0) {
        return errorResponse("A non-empty mutation batch is required.", 400);
      }

      try {
        const repository = new D1TaskMutationRepository(database, authorization.context);
        const tasks = await repository.apply(
          (body as { mutations: TaskMutation[] }).mutations,
          clock.now().toISOString(),
        );
        return Response.json({ tasks });
      } catch (error) {
        if (error instanceof Error && error.message === "Authentication required.") {
          return errorResponse("Authentication required.", 403);
        }
        if (error instanceof Error && error.message === "Workspace access denied.") {
          return errorResponse("Workspace access denied.", 403);
        }
        if (isMutationValidationError(error)) return errorResponse("Task mutations are invalid.", 400);
        return errorResponse("Task mutations could not be saved safely.", 500);
      }
    },
  };
}
