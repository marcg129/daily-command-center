import {
  DAILY_INTAKE_SOURCE_KEYS,
  INTAKE_STATUSES,
  INTAKE_TYPES,
  type IntakeEditablePatch,
  type IntakeStatus,
  type IntakeType,
} from "@/lib/runtime/daily-intake";
import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import {
  IntakeApprovalConflictError,
  IntakeApprovalValidationError,
} from "@/lib/runtime/intake-approval";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { D1BillRepository } from "@/lib/server/d1-bill-repository";
import { D1IntakeRepository } from "@/lib/server/d1-intake-repository";
import { D1SourceFreshnessRepository } from "@/lib/server/d1-source-freshness-repository";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { createIntakeApprovalService } from "@/lib/server/intake-approval-service";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MAX_BULK_ITEMS = 100;

type Principal = Parameters<WorkspaceResolver["resolve"]>[0];

type Authorization = Readonly<{
  principal: Principal;
  context: RequestContext;
}>;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: NO_STORE_HEADERS });
}

function errorResponse(message: string, status: number) {
  return json({ error: message }, status);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function includes(values: readonly string[], value: unknown): value is string {
  return typeof value === "string" && values.includes(value);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function authorize(
  request: Request,
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  clock: Clock,
): Promise<Authorization | Response> {
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  if (!assertion) return errorResponse("Authentication required.", 403);
  const session = await sessionProvider.getSession(assertion);
  const principal = requireAuthenticatedSession(session, clock.now());
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!isProductWorkspaceId(workspaceId)) {
    return errorResponse("workspaceId must be personal or indelitech.", 400);
  }
  return {
    principal,
    context: await workspaceResolver.resolve(principal, workspaceId),
  };
}

function isResponse(value: Authorization | Response): value is Response {
  return value instanceof Response;
}

function validIdList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_BULK_ITEMS &&
    value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 1024) &&
    new Set(value).size === value.length;
}

function mapError(error: unknown, fallback: string): Response {
  if (error instanceof IntakeApprovalConflictError ||
      (error instanceof Error && /terminal state|already approved|already resolved|state conflict/i.test(error.message))) {
    return errorResponse("Intake item state conflicts with this action.", 409);
  }
  if (error instanceof IntakeApprovalValidationError) {
    if (/not found/i.test(error.message)) return errorResponse("Intake item was not found.", 404);
    if (/workspace access/i.test(error.message)) return errorResponse("Workspace access denied.", 403);
    return errorResponse("Intake request is invalid.", 400);
  }
  if (error instanceof Error && /Intake item not found/i.test(error.message)) {
    return errorResponse("Intake item was not found.", 404);
  }
  if (error instanceof Error &&
      (/Workspace access denied/i.test(error.message) || /authenticated hosted workspace/i.test(error.message))) {
    return errorResponse("Workspace access denied.", 403);
  }
  if (error instanceof Error && /Authentication required/i.test(error.message)) {
    return errorResponse("Authentication required.", 403);
  }
  if (error instanceof TypeError || (error instanceof Error &&
      /Intake|workspace|defer|date|timestamp|priority|currency|amount|recurrence|Awareness|target/i.test(error.message) &&
      !/failed|unavailable|lookup|persistence|read/i.test(error.message))) {
    return errorResponse("Intake request is invalid.", 400);
  }
  return errorResponse(fallback, 500);
}

function parseEditPatch(value: unknown): IntakeEditablePatch | null {
  if (!isObject(value)) return null;
  const allowed = new Set(["workspaceId", "title", "dueDate", "followUpAt", "priority", "amountMinor", "currency", "recurrence"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  return value as IntakeEditablePatch;
}

export function createAuthorizedHostedIntakeHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  database: D1Database,
  clock: Clock,
  ids: IdGenerator,
) {
  const taskRepository = new D1TaskRepository(database);
  const freshnessRepository = new D1SourceFreshnessRepository(database);

  async function authorizedFor(request: Request) {
    return authorize(request, sessionProvider, workspaceResolver, clock);
  }

  function services() {
    const intakeRepository = new D1IntakeRepository(database, clock, ids);
    const approve = createIntakeApprovalService({
      intakeRepository,
      taskRepository,
      billRepositoryForContext: (targetContext) => new D1BillRepository(database, targetContext, clock, ids),
      clock,
    });
    return { intakeRepository, approve };
  }

  async function approveOne(context: RequestContext, intakeId: string) {
    const { approve } = services();
    const item = await approve(context, intakeId);
    return {
      intakeId,
      ok: true as const,
      targetKind: item.approvedTargetKind,
      targetId: item.approvedTargetId,
      item,
    };
  }

  return {
    intake: {
      async GET(request: Request) {
        try {
          const authorization = await authorizedFor(request);
          if (isResponse(authorization)) return authorization;
          const params = new URL(request.url).searchParams;
          const statusValue = params.get("status");
          const typeValue = params.get("type");
          const sourceKeyValue = params.get("sourceKey");
          if (statusValue !== null && !includes(INTAKE_STATUSES, statusValue)) {
            return errorResponse("status is invalid.", 400);
          }
          if (typeValue !== null && !includes(INTAKE_TYPES, typeValue)) {
            return errorResponse("type is invalid.", 400);
          }
          if (sourceKeyValue !== null && !includes(DAILY_INTAKE_SOURCE_KEYS, sourceKeyValue)) {
            return errorResponse("sourceKey is invalid.", 400);
          }
          const { intakeRepository } = services();
          const items = await intakeRepository.list(authorization.context, {
            status: (statusValue ?? undefined) as IntakeStatus | undefined,
            type: (typeValue ?? undefined) as IntakeType | undefined,
            sourceKey: (sourceKeyValue ?? undefined) as (typeof DAILY_INTAKE_SOURCE_KEYS)[number] | undefined,
          });
          return json({ items });
        } catch (error) {
          return mapError(error, "Intake could not be read safely.");
        }
      },

      async PATCH(request: Request) {
        try {
          const authorization = await authorizedFor(request);
          if (isResponse(authorization)) return authorization;
          const body = await readJsonObject(request);
          if (!body || typeof body.intakeId !== "string" || typeof body.action !== "string") {
            return errorResponse("intakeId and action are required.", 400);
          }
          const { intakeRepository } = services();

          if (body.action === "EDIT") {
            const patch = parseEditPatch(body.patch);
            if (!patch) return errorResponse("A valid Intake edit patch is required.", 400);
            let destinationContext: RequestContext | undefined;
            const destination = patch.workspaceId;
            const currentWorkspace = authorization.context.workspaceKey;
            if (destination !== undefined && destination !== currentWorkspace) {
              if (!isProductWorkspaceId(destination)) return errorResponse("Destination workspace is invalid.", 400);
              destinationContext = await workspaceResolver.resolve(authorization.principal, destination);
            }
            const item = await intakeRepository.edit(
              authorization.context,
              body.intakeId,
              patch,
              destinationContext,
            );
            return json({ item });
          }

          if (body.action === "DEFER") {
            if (typeof body.until !== "string") return errorResponse("A defer-until timestamp is required.", 400);
            return json({ item: await intakeRepository.defer(authorization.context, body.intakeId, body.until) });
          }
          if (body.action === "DISMISS") {
            return json({ item: await intakeRepository.dismiss(authorization.context, body.intakeId) });
          }
          if (body.action === "ARCHIVE") {
            return json({ item: await intakeRepository.archive(authorization.context, body.intakeId) });
          }
          return errorResponse("Intake action is invalid.", 400);
        } catch (error) {
          return mapError(error, "Intake could not be updated safely.");
        }
      },

      async POST(request: Request) {
        try {
          const authorization = await authorizedFor(request);
          if (isResponse(authorization)) return authorization;
          const body = await readJsonObject(request);
          if (!body || typeof body.action !== "string" || !validIdList(body.intakeIds)) {
            return errorResponse("A valid action and intakeIds list are required.", 400);
          }
          const intakeIds = body.intakeIds;
          const { intakeRepository } = services();

          if (body.action === "APPROVE") {
            if (intakeIds.length !== 1) return errorResponse("APPROVE requires exactly one Intake item.", 400);
            const result = await approveOne(authorization.context, intakeIds[0]);
            return json({ results: [result] });
          }

          if (body.action === "APPROVE_BULK") {
            const existing = await Promise.all(intakeIds.map((id) => intakeRepository.get(authorization.context, id)));
            if (existing.some((item) => item?.intakeType === "BILL")) {
              return errorResponse("Bill proposals cannot be bulk approved.", 400);
            }
            const results = [] as Array<Record<string, unknown>>;
            for (const intakeId of intakeIds) {
              try {
                results.push(await approveOne(authorization.context, intakeId));
              } catch (error) {
                results.push({ intakeId, ok: false, error: error instanceof Error ? error.message : "Approval failed." });
              }
            }
            return json({ results });
          }

          if (body.action === "DISMISS_BULK") {
            const results = [] as Array<Record<string, unknown>>;
            for (const intakeId of intakeIds) {
              try {
                const item = await intakeRepository.dismiss(authorization.context, intakeId);
                results.push({ intakeId, ok: true, item });
              } catch (error) {
                results.push({ intakeId, ok: false, error: error instanceof Error ? error.message : "Dismiss failed." });
              }
            }
            return json({ results });
          }

          return errorResponse("Intake bulk action is invalid.", 400);
        } catch (error) {
          return mapError(error, "Intake approval could not be completed safely.");
        }
      },
    },

    status: {
      async GET(request: Request) {
        try {
          const authorization = await authorizedFor(request);
          if (isResponse(authorization)) return authorization;
          const userId = authorization.context.userId;
          if (!userId) return errorResponse("Workspace access denied.", 403);
          return json({ sources: await freshnessRepository.list(userId) });
        } catch (error) {
          return mapError(error, "Intake source status could not be read safely.");
        }
      },
    },
  };
}
