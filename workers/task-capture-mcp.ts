import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createChatTaskCaptureService } from "../lib/runtime/chat-task-capture";
import type { D1Database } from "../lib/runtime/d1";
import { systemClock } from "../lib/runtime/primitives";
import { requireAuthenticatedSession } from "../lib/runtime/session";
import {
  TaskCaptureConflictError,
  TaskCaptureValidationError,
} from "../lib/runtime/task-capture";
import { CloudflareAccessSessionProvider } from "../lib/server/cloudflare-access-session-provider";
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

function toolError(error: unknown) {
  let message = "The task could not be processed safely.";
  if (
    error instanceof TaskCaptureValidationError ||
    error instanceof TaskCaptureConflictError ||
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
  const tasks = createChatTaskCaptureService(
    principal,
    new D1WorkspaceResolver(env.DB),
    new D1TaskRepository(env.DB),
    systemClock,
  );
  const server = new McpServer(
    { name: "Daily Command Center Tasks", version: "1.1.0" },
    {
      instructions: [
        "Treat an explicit user request to save or create a task as authorization to perform the write.",
        "The exact phrase SEND TO TASKS is the canonical explicit command. Direct requests such as add that to my tasks, put that on my list, or add that to Indelitech are also explicit authorization.",
        "When the user explicitly requests capture and the task is unambiguous from the current conversation, call create_task directly with the known details. Do not require preview_task first, do not ask the user to repeat known fields, and do not ask for a redundant second confirmation.",
        "If you merely infer a likely task from ordinary conversation, do not write it. Ask whether the user wants it added. A clear yes, do it, add it, or equivalent reply then authorizes create_task using the existing conversation context.",
        "Use preview_task only when the exact interpretation itself needs review before saving. If preview_task is used, show the material proposal and wait for confirmation before create_task.",
        "Clarify only a materially required ambiguity, especially workspace. Omit optional fields that are unknown. Never invent a due date, reminder, recurrence, workspace, duration, or other material detail.",
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
