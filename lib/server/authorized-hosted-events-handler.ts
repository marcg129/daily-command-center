import { isDateOnly } from "@/lib/runtime/bills";
import {
  CALENDAR_OVERRIDE_SCOPES,
  CALENDAR_SOURCE_KEYS,
  type CalendarOverrideScope,
  type CalendarSourceKey,
} from "@/lib/runtime/calendar-projections";
import { isProductWorkspaceId } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { D1CalendarProjectionRepository } from "@/lib/server/d1-calendar-projection-repository";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type Principal = Parameters<WorkspaceResolver["resolve"]>[0];

type OwnedEventIdentity = Readonly<{
  series_id: string | null;
  occurrence_key: string | null;
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

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function principalFor(request: Request, sessionProvider: SessionProvider, clock: Clock): Promise<Principal | Response> {
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  if (!assertion) return errorResponse("Authentication required.", 403);
  try {
    const session = await sessionProvider.getSession(assertion);
    return requireAuthenticatedSession(session, clock.now());
  } catch {
    return errorResponse("Authentication required.", 403);
  }
}

function isResponse(value: Principal | Response): value is Response {
  return value instanceof Response;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

function validReadRange(fromDate: string | null, throughDate: string | null): boolean {
  if (!fromDate || !throughDate || !isDateOnly(fromDate) || !isDateOnly(throughDate)) return false;
  const span = Date.parse(`${throughDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`);
  return span >= 0 && span <= 45 * 24 * 60 * 60 * 1000;
}

function boundedFailure(error: unknown, fallback: string): Response {
  if (error instanceof Error && /Workspace access denied|DCC user access denied/i.test(error.message)) {
    return errorResponse("Workspace access denied.", 403);
  }
  if (error instanceof Error && /range|date|source|scope|identity|workspace|event/i.test(error.message) &&
      !/failed|read|persistence/i.test(error.message)) {
    return errorResponse("Events request is invalid.", 400);
  }
  return errorResponse(fallback, 500);
}

export function createAuthorizedHostedEventsHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  database: D1Database,
  clock: Clock,
  ids: IdGenerator,
) {
  const repository = new D1CalendarProjectionRepository(database, clock, ids);

  return {
    async GET(request: Request) {
      try {
        const principal = await principalFor(request, sessionProvider, clock);
        if (isResponse(principal)) return principal;
        const params = new URL(request.url).searchParams;
        const workspaceId = params.get("workspaceId");
        const fromDate = params.get("fromDate");
        const throughDate = params.get("throughDate");
        if (!isProductWorkspaceId(workspaceId) || !validReadRange(fromDate, throughDate)) {
          return errorResponse("A valid workspaceId and date range up to 45 days are required.", 400);
        }
        const context = await workspaceResolver.resolve(principal, workspaceId);
        if (!context.userId) return errorResponse("Workspace access denied.", 403);
        const events = await repository.list(context.userId, workspaceId, { fromDate: fromDate!, throughDate: throughDate! });
        return json({ events });
      } catch (error) {
        return boundedFailure(error, "Events could not be read safely.");
      }
    },

    async PATCH(request: Request) {
      try {
        const principal = await principalFor(request, sessionProvider, clock);
        if (isResponse(principal)) return principal;
        const body = await readBody(request);
        if (!body ||
            !includes(CALENDAR_SOURCE_KEYS, body.sourceKey) ||
            !includes(CALENDAR_OVERRIDE_SCOPES, body.scope) ||
            !validId(body.eventId) ||
            !isProductWorkspaceId(body.workspaceId) ||
            (body.clear !== undefined && typeof body.clear !== "boolean")) {
          return errorResponse("A valid event override request is required.", 400);
        }

        const sourceKey = body.sourceKey as CalendarSourceKey;
        const scope = body.scope as CalendarOverrideScope;
        const targetWorkspace = body.workspaceId;
        const targetContext = await workspaceResolver.resolve(principal, targetWorkspace);
        if (!targetContext.userId) return errorResponse("Workspace access denied.", 403);

        const owned = await database.prepare(`SELECT series_id, occurrence_key
          FROM projected_calendar_events
          WHERE user_id=? AND source_key=? AND google_event_id=? AND removed_at IS NULL`)
          .bind(targetContext.userId, sourceKey, body.eventId).first<OwnedEventIdentity>();
        if (!owned) return errorResponse("Calendar event was not found.", 404);

        const identityKey = scope === "SERIES" ? owned.series_id : owned.occurrence_key;
        if (!identityKey) return errorResponse("Calendar event does not support the requested override scope.", 400);

        if (body.clear === true) {
          await repository.clearWorkspaceOverride(targetContext.userId, sourceKey, scope, identityKey);
        } else {
          await repository.setWorkspaceOverride(targetContext.userId, {
            sourceKey,
            scope,
            identityKey,
            workspaceId: targetWorkspace,
          });
        }
        return json({ ok: true, sourceKey, eventId: body.eventId, scope, workspaceId: targetWorkspace, cleared: body.clear === true });
      } catch (error) {
        return boundedFailure(error, "Event workspace override could not be updated safely.");
      }
    },
  };
}
