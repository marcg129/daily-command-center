import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { BillDefinitionCore } from "@/lib/runtime/bills";
import type { BillOccurrenceResolutionInput } from "@/lib/runtime/hosted-bills";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import { readRequestSessionIdentity } from "@/lib/server/request-session-identity";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { D1BillRepository } from "@/lib/server/d1-bill-repository";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: NO_STORE_HEADERS });
}

function errorResponse(error: string, status: number) {
  return json({ error }, status);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const sessionIdentity = readRequestSessionIdentity(request);
  if (!sessionIdentity) return { authorized: false, response: errorResponse("Authentication required.", 403) };
  const session = await sessionProvider.getSession(sessionIdentity);
  const principal = requireAuthenticatedSession(session, clock.now());
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!isProductWorkspaceId(workspaceId)) {
    return { authorized: false, response: errorResponse("workspaceId must be personal or indelitech.", 400) };
  }
  return { authorized: true, context: await workspaceResolver.resolve(principal, workspaceId) };
}

function mapError(error: unknown, fallback: string): Response {
  if (error instanceof Error && error.message === "Authentication required.") {
    return errorResponse("Authentication required.", 403);
  }
  if (error instanceof Error && (error.message === "Workspace access denied." ||
      error.message === "An authenticated hosted workspace instance is required.")) {
    return errorResponse("Workspace access denied.", 403);
  }
  if (error instanceof Error && (error.message === "Bill not found." || error.message === "Bill occurrence not found.")) {
    return errorResponse("Bill record was not found.", 404);
  }
  if (error instanceof Error && error.message === "Bill occurrence is already resolved.") {
    return errorResponse("Bill occurrence is already resolved.", 409);
  }
  if (error instanceof TypeError || (error instanceof Error &&
      !/failed|unavailable|lookup/i.test(error.message) &&
      /bill|paid|skipped|cancelled|fromDate|throughDate|effectiveDate|calendar date|recurrence|currency|amount|URL/i.test(error.message))) {
    return errorResponse("Bill request is invalid.", 400);
  }
  return errorResponse(fallback, 500);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function createAuthorizedHostedBillsHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  database: D1Database,
  clock: Clock,
  ids: IdGenerator,
) {
  async function repositoryFor(request: Request) {
    const authorization = await authorize(request, sessionProvider, workspaceResolver, clock);
    if (!authorization.authorized) return authorization;
    return {
      authorized: true as const,
      repository: new D1BillRepository(database, authorization.context, clock, ids),
    };
  }

  return {
    bills: {
      async GET(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const raw = new URL(request.url).searchParams.get("includeArchived");
          if (raw !== null && !["0", "1", "false", "true"].includes(raw)) {
            return errorResponse("includeArchived must be true or false.", 400);
          }
          const includeArchived = raw === "1" || raw === "true";
          return json(await result.repository.listSummary(includeArchived));
        } catch (error) {
          return mapError(error, "Bills could not be read safely.");
        }
      },

      async POST(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || !isObject(body.bill)) return errorResponse("A bill definition is required.", 400);
          return json(await result.repository.create(body.bill as unknown as BillDefinitionCore), 201);
        } catch (error) {
          return mapError(error, "Bill could not be created safely.");
        }
      },

      async PATCH(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || typeof body.billId !== "string" || !isObject(body.bill)) {
            return errorResponse("billId and bill definition are required.", 400);
          }
          const effectiveDate = body.effectiveDate === undefined || body.effectiveDate === null
            ? null
            : typeof body.effectiveDate === "string" ? body.effectiveDate : "__invalid__";
          return json({ bill: await result.repository.update(
            body.billId,
            body.bill as unknown as BillDefinitionCore,
            effectiveDate,
          ) });
        } catch (error) {
          return mapError(error, "Bill could not be updated safely.");
        }
      },
    },

    occurrences: {
      async GET(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const params = new URL(request.url).searchParams;
          return json({ occurrences: await result.repository.listOccurrences({
            billId: params.get("billId"),
            fromDate: params.get("fromDate"),
            throughDate: params.get("throughDate"),
          }) });
        } catch (error) {
          return mapError(error, "Bill occurrences could not be read safely.");
        }
      },

      async POST(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || typeof body.occurrenceId !== "string" || typeof body.action !== "string") {
            return errorResponse("occurrenceId and resolution action are required.", 400);
          }
          const input: BillOccurrenceResolutionInput = {
            action: body.action as BillOccurrenceResolutionInput["action"],
            paidOn: body.paidOn as string | null | undefined,
            paidAmountMinor: body.paidAmountMinor as number | null | undefined,
            resolutionNote: body.resolutionNote as string | null | undefined,
          };
          return json({ occurrence: await result.repository.resolveOccurrence(body.occurrenceId, input) });
        } catch (error) {
          return mapError(error, "Bill occurrence could not be resolved safely.");
        }
      },
    },
  };
}
