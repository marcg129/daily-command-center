import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createChatTaskCaptureService } from "../lib/runtime/chat-task-capture";
import {
  createDirectDailyIntakeIngressService,
  DirectDailyIntakeValidationError,
} from "../lib/runtime/direct-daily-intake-ingress";
import type { D1Database } from "../lib/runtime/d1";
import { systemClock, webIdGenerator } from "../lib/runtime/primitives";
import { requireAuthenticatedSession } from "../lib/runtime/session";
import {
  TaskCaptureConflictError,
  TaskCaptureValidationError,
} from "../lib/runtime/task-capture";
import { CloudflareAccessSessionProvider } from "../lib/server/cloudflare-access-session-provider";
import { D1CalendarProjectionRepository } from "../lib/server/d1-calendar-projection-repository";
import { D1IntakeRepository } from "../lib/server/d1-intake-repository";
import { D1SourceFreshnessRepository } from "../lib/server/d1-source-freshness-repository";
import { D1TaskRepository } from "../lib/server/d1-task-repository";
import { D1WorkspaceResolver } from "../lib/server/d1-workspace-resolver";

type Env = Readonly<{
  DB: D1Database;
  TEAM_DOMAIN: string;
  MCP_POLICY_AUD: string;
}>;

const text = (maximum: number) => z.string().trim().min(1).max(maximum).optional();
const captureShape = {
  workspaceId: z.enum(["personal", "indelitech"]).describe(
    "Use personal for personal work and indelitech for Indelitech work. Infer only when the conversation makes the workspace unambiguous; otherwise ask one clarification before writing.",
  ),
  title: z.string().trim().min(1).max(240),
  context: text(4_000).describe(
    "Useful bounded task description or diagnostic/planning context already relevant to the action. Do not copy unrelated conversation content.",
  ),
  category: text(120),
  project: text(160),
  person: text(160),
  type: z.enum(["ONE_TIME", "DEADLINE", "FOLLOW_UP", "WAITING", "RECURRING", "BACKLOG"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe(
    "Concrete due date in YYYY-MM-DD form. Never pass relative language or invent a date.",
  ),
  remindAt: z.string().max(64).nullable().optional().describe("ISO timestamp with timezone. Omit when not clear."),
  followUpAt: z.string().max(64).nullable().optional().describe("ISO timestamp with timezone. Omit when not clear."),
  estimatedDuration: z.enum(["5m", "15m", "30m", "1h", "2h+", "Project"]).optional(),
  recurrence: z.enum(["One-time", "Daily", "Weekly", "Monthly"]).optional(),
  dependency: text(240),
  sourceContext: text(500).describe("Short chat/thread reference when useful; never paste unnecessary sensitive conversation text."),
};


const billRecurrenceShape = z.object({
  scheduleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurrenceUnit: z.enum(["NONE", "WEEK", "MONTH", "YEAR"]),
  recurrenceInterval: z.number().int().min(1).max(120),
  recurrenceDayMode: z.enum(["ANCHOR_DATE", "LAST_DAY"]).nullable(),
}).strict();

const intakeProposalShape = z.object({
  scanRunId: z.string().trim().min(1).max(200),
  workspaceId: z.enum(["personal", "indelitech"]),
  sourceKey: z.enum([
    "personal_gmail",
    "professional_gmail",
    "indelitech_gmail",
    "primary_calendar",
    "family_calendar",
    "chat_history",
  ]),
  sourceType: z.enum(["gmail", "calendar", "chat"]),
  messageId: z.string().max(1024).optional(),
  chatItemId: z.string().max(1024).optional(),
  chatThreadId: z.string().max(1024).optional(),
  threadId: z.string().max(1024).optional(),
  eventId: z.string().max(1024).optional(),
  seriesId: z.string().max(1024).optional(),
  proposalOrdinal: z.number().int().min(1).max(10_000),
  sourceTimestamp: z.string().max(64),
  sender: z.string().max(500).optional(),
  subject: z.string().max(1000).optional(),
  sourceUrl: z.string().max(2048).optional(),
  intakeType: z.enum(["TASK", "FOLLOW_UP", "BILL", "AWARENESS"]),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(4000),
  classificationReason: z.string().trim().min(1).max(3000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  followUpAt: z.string().max(64).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  recurrence: billRecurrenceShape.optional(),
}).strict();

const calendarEventShape = z.object({
  eventId: z.string().trim().min(1).max(1024),
  seriesId: z.string().max(1024).optional(),
  occurrenceId: z.string().max(1024).optional(),
  title: z.string().trim().min(1).max(500),
  start: z.string().max(64),
  end: z.string().max(64),
  allDay: z.boolean(),
  location: z.string().max(1000).optional(),
  sourceUrl: z.string().max(2048).optional(),
  automaticWorkspaceId: z.enum(["personal", "indelitech"]).optional(),
  cancelled: z.boolean(),
}).strict();

const calendarSyncShape = z.object({
  scanRunId: z.string().trim().min(1).max(200),
  sourceKey: z.enum(["primary_calendar", "family_calendar"]),
  windowStart: z.string().max(64),
  windowEnd: z.string().max(64),
  batchIndex: z.number().int().min(1).max(1000),
  batchCount: z.number().int().min(1).max(1000),
  events: z.array(calendarEventShape).max(500),
}).strict();

const scanSourceStatusShape = z.object({
  sourceKey: z.enum([
    "personal_gmail",
    "professional_gmail",
    "indelitech_gmail",
    "primary_calendar",
    "family_calendar",
  ]),
  state: z.enum(["SUCCESS", "FAILED"]),
  attemptedAt: z.string().max(64),
  completedAt: z.string().max(64).optional(),
  diagnostic: z.string().max(1000).optional(),
}).strict();

const scanStatusShape = z.object({
  scanRunId: z.string().trim().min(1).max(200),
  sources: z.array(scanSourceStatusShape).length(5),
}).strict();

function toolError(error: unknown) {
  let message = "The task could not be processed safely.";
  if (
    error instanceof TaskCaptureValidationError ||
    error instanceof TaskCaptureConflictError ||
    error instanceof DirectDailyIntakeValidationError ||
    (error instanceof Error && [
      "Authentication required.",
      "Workspace access denied.",
      "Explicit user confirmation is required before creating a task.",
    ].includes(error.message))
  ) {
    message = error.message;
  }
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function createServer(env: Env, principal: ReturnType<typeof requireAuthenticatedSession>) {
  const workspaceResolver = new D1WorkspaceResolver(env.DB);
  const tasks = createChatTaskCaptureService(
    principal,
    workspaceResolver,
    new D1TaskRepository(env.DB),
    systemClock,
  );
  const directIntake = createDirectDailyIntakeIngressService({
    principal,
    workspaceResolver,
    intakeRepository: new D1IntakeRepository(env.DB, systemClock, webIdGenerator),
    calendarRepository: new D1CalendarProjectionRepository(env.DB, systemClock, webIdGenerator),
    sourceFreshnessRepository: new D1SourceFreshnessRepository(env.DB),
  });
  const server = new McpServer(
    { name: "Daily Command Center Tasks", version: "1.2.0" },
    {
      instructions: [
        "Treat an explicit user request to save or create a task as authorization to perform the write.",
        "The exact phrase SEND TO TASKS is the canonical explicit command. Direct requests such as add that to my tasks, put that on my list, or add that to Indelitech are also explicit authorization.",
        "When the user explicitly requests capture and the task is unambiguous from the current conversation, call create_task directly with the known details. Do not require preview_task first, do not ask the user to repeat known fields, and do not ask for a redundant second confirmation.",
        "If you merely infer a likely task from ordinary conversation, do not write it. Ask whether the user wants it added. A clear yes, do it, add it, or equivalent reply then authorizes create_task using the existing conversation context.",
        "Use preview_task only when the exact interpretation itself needs review before saving. If preview_task is used, show the material proposal and wait for confirmation before create_task.",
        "Clarify only a materially required ambiguity, especially workspace. Omit optional fields that are unknown. Never invent a due date, reminder, recurrence, workspace, duration, or other material detail.",
        "For Daily Intake scans, use the direct Intake, Calendar, and scan-status tools instead of Todoist whenever these tools are available. These tools write only staging/projection/freshness data and never auto-approve a Task or Bill.",
      ].join(" "),
    },
  );

  server.registerTool(
    "preview_task",
    {
      title: "Preview a Daily Command Center task when review is needed",
      description:
        "Validate and normalize a proposed task without saving it. Use only when the exact interpretation needs user review or clarification before a write. It is not required for an unambiguous explicit capture request such as SEND TO TASKS.",
      inputSchema: captureShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const proposal = await tasks.preview(input);
        return {
          structuredContent: { proposal },
          content: [{
            type: "text",
            text: "Task proposal validated for review. Present the material proposal to the user and wait for explicit confirmation before calling create_task.",
          }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create an authorized Daily Command Center task",
      description:
        "Create a canonical Daily Command Center task when the user has explicitly requested capture or explicitly confirmed a capture suggestion/proposal. SEND TO TASKS is explicit authorization. When conversational context is complete and unambiguous, call this tool directly without preview_task and reuse the known details instead of asking the user to restate them. Never use it for a merely inferred task before the user says yes.",
      inputSchema: {
        requestId: z.string().regex(/^chat:[A-Za-z0-9._:-]{1,123}$/).describe(
          "Stable unique ID for this user-authorized capture. Reuse the same ID if the same tool call is retried.",
        ),
        confirmedByUser: z.literal(true).describe(
          "Set true only when the user explicitly requested capture (including SEND TO TASKS or an equivalent direct instruction) or explicitly confirmed a capture suggestion/proposal in the current conversation.",
        ),
        ...captureShape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await tasks.create(input);
        return {
          structuredContent: {
            created: result.created,
            taskId: result.task.taskId,
            interpretation: result.interpretation,
          },
          content: [{
            type: "text",
            text: result.created
              ? `Created task “${result.task.title}” in ${result.task.primaryWorkspaceId}.`
              : `Task “${result.task.title}” already exists; no duplicate was created.`,
          }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );


  server.registerTool(
    "submit_intake_proposal",
    {
      title: "Submit a Daily Command Center Intake proposal directly",
      description:
        "Persist one validated Intake proposal directly to Daily Command Center without Todoist. This only creates or reuses a confirmation-gated Intake item; it never approves the item or creates a canonical Task or Bill.",
      inputSchema: intakeProposalShape.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await directIntake.submitIntakeProposal(input);
        return {
          structuredContent: { result },
          content: [{
            type: "text",
            text: result.status === "created"
              ? "Stored the Intake proposal directly in Daily Command Center."
              : "The Intake proposal was already known; no duplicate was created.",
          }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "sync_calendar_batch",
    {
      title: "Sync a Daily Command Center Calendar batch directly",
      description:
        "Persist one validated Primary or Family Calendar snapshot batch directly to Daily Command Center without Todoist. Use this for DCC Intake scans. It updates calendar projections only.",
      inputSchema: calendarSyncShape.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await directIntake.syncCalendarBatch(input);
        return {
          structuredContent: { result },
          content: [{
            type: "text",
            text: result.complete
              ? `Calendar snapshot for ${result.sourceKey} is complete.`
              : `Accepted calendar batch ${result.batchIndex} of ${result.batchCount} for ${result.sourceKey}.`,
          }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "record_scan_status",
    {
      title: "Record Daily Command Center Intake scan health directly",
      description:
        "Record the five-source Daily Intake scan status directly in Daily Command Center without Todoist. This updates source freshness/health only.",
      inputSchema: scanStatusShape.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await directIntake.recordScanStatus(input);
        return {
          structuredContent: { result },
          content: [{
            type: "text",
            text: "Recorded Daily Command Center Intake scan health.",
          }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

async function authenticate(request: Request, env: Env) {
  const assertion = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (!assertion) return null;
  const provider = new CloudflareAccessSessionProvider({
    teamDomain: env.TEAM_DOMAIN,
    audience: env.MCP_POLICY_AUD,
    clock: systemClock,
  });
  return provider.getSession(assertion);
}

const taskCaptureMcpWorker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return Response.json({ error: "Not found." }, { status: 404 });

    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return Response.json({ error: "Cross-site requests are blocked." }, { status: 403 });
    }

    let session;
    try {
      session = await authenticate(request, env);
    } catch {
      return Response.json({ error: "MCP authentication is not configured." }, { status: 503 });
    }
    if (!session) return Response.json({ error: "Authentication required." }, { status: 403 });

    const principal = requireAuthenticatedSession(session, systemClock.now());
    const handler = createMcpHandler(() => createServer(env, principal));
    return handler.fetch(request, {
      authInfo: {
        token: session.sessionId,
        clientId: "cloudflare-access-managed-oauth",
        scopes: ["tasks:write"],
        expiresAt: Math.floor(Date.parse(session.expiresAt) / 1_000),
        resource: new URL("/mcp", request.url),
        extra: { principalId: principal.principalId },
      },
    });
  },
};

export default taskCaptureMcpWorker;
