import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import type {
  CashflowBaselineInput,
  IncomeOccurrenceResolutionInput,
} from "@/lib/runtime/hosted-income";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import { readRequestSessionIdentity } from "@/lib/server/request-session-identity";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { D1IncomeRepository } from "@/lib/server/d1-income-repository";

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
  if (error instanceof Error && (error.message === "Income source not found." || error.message === "Income occurrence not found.")) {
    return errorResponse("Income record was not found.", 404);
  }
  if (error instanceof Error && error.message === "Income occurrence is already resolved.") {
    return errorResponse("Income occurrence is already resolved.", 409);
  }
  if (error instanceof TypeError || (error instanceof Error &&
      !/failed|unavailable|lookup/i.test(error.message) &&
      /income|received|baseline|fromDate|throughDate|effectiveDate|calendar date|recurrence|currency|amount|pay date/i.test(error.message))) {
    return errorResponse("Income request is invalid.", 400);
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

export function createAuthorizedHostedIncomeHandler(
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
      repository: new D1IncomeRepository(database, authorization.context, clock, ids),
    };
  }

  return {
    income: {
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
          return mapError(error, "Income could not be read safely.");
        }
      },

      async POST(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || !isObject(body.incomeSource)) return errorResponse("An income source definition is required.", 400);
          return json(await result.repository.create(body.incomeSource as unknown as IncomeDefinitionCore), 201);
        } catch (error) {
          return mapError(error, "Income source could not be created safely.");
        }
      },

      async PATCH(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || typeof body.incomeSourceId !== "string" || !isObject(body.incomeSource)) {
            return errorResponse("incomeSourceId and income source definition are required.", 400);
          }
          const effectiveDate = body.effectiveDate === undefined || body.effectiveDate === null
            ? null
            : typeof body.effectiveDate === "string" ? body.effectiveDate : "__invalid__";
          return json({ incomeSource: await result.repository.update(
            body.incomeSourceId,
            body.incomeSource as unknown as IncomeDefinitionCore,
            effectiveDate,
          ) });
        } catch (error) {
          return mapError(error, "Income source could not be updated safely.");
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
            incomeSourceId: params.get("incomeSourceId"),
            fromDate: params.get("fromDate"),
            throughDate: params.get("throughDate"),
          }) });
        } catch (error) {
          return mapError(error, "Income occurrences could not be read safely.");
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
          const input: IncomeOccurrenceResolutionInput = {
            action: body.action as IncomeOccurrenceResolutionInput["action"],
            receivedOn: body.receivedOn as string | null | undefined,
            receivedAmountMinor: body.receivedAmountMinor as number | null | undefined,
            resolutionNote: body.resolutionNote as string | null | undefined,
          };
          return json({ occurrence: await result.repository.resolveOccurrence(body.occurrenceId, input) });
        } catch (error) {
          return mapError(error, "Income occurrence could not be resolved safely.");
        }
      },
    },

    baseline: {
      async GET(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          return json({ baseline: await result.repository.getBaseline() });
        } catch (error) {
          return mapError(error, "Cash-flow baseline could not be read safely.");
        }
      },

      async PUT(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          const body = await readJsonObject(request);
          if (!body || !isObject(body.baseline)) return errorResponse("A cash-flow baseline is required.", 400);
          const baseline = body.baseline as unknown as CashflowBaselineInput;
          return json({ baseline: await result.repository.saveBaseline(baseline) });
        } catch (error) {
          return mapError(error, "Cash-flow baseline could not be updated safely.");
        }
      },

      async DELETE(request: Request) {
        try {
          const result = await repositoryFor(request);
          if (!result.authorized) return result.response;
          await result.repository.clearBaseline();
          return json({ baseline: null });
        } catch (error) {
          return mapError(error, "Cash-flow baseline could not be cleared safely.");
        }
      },
    },
  };
}
