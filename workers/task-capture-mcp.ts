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
    "Use personal for personal work and indelitech for Indelitech work.",
  ),
  title: z.string().trim().min(1).max(240),
  context: text(4_000).describe("Useful task description or optional context."),
  category: text(120),
  project: text(160),
  person: text(160),
  type: z.enum(["ONE_TIME", "DEADLINE", "FOLLOW_UP", "WAITING", "RECURRING", "BACKLOG"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe(
    "Concrete due date in YYYY-MM-DD form. Never pass relative language.",
  ),
  remindAt: z.string().max(64).nullable().optional().describe("ISO timestamp with timezone."),
  followUpAt: z.string().max(64).nullable().optional().describe("ISO timestamp with timezone."),
  estimatedDuration: z.enum(["5m", "15m", "30m", "1h", "2h+", "Project"]).optional(),
  recurrence: z.enum(["One-time", "Daily", "Weekly", "Monthly"]).optional(),
  dependency: text(240),
  sourceContext: text(500).describe("Short chat/thread reference, when available."),
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
    { name: "Daily Command Center Tasks", version: "1.0.0" },
    {
      instructions:
        "Always call preview_task first. Present every returned task field to the user and ask for explicit confirmation. Call create_task only after the user clearly confirms that exact proposal. If any field changes, preview again. Never invent a due date, reminder, recurrence, workspace, or duration.",
    },
  );

  server.registerTool(
    "preview_task",
    {
      title: "Preview a Daily Command Center task",
      description:
        "Validate and normalize a proposed task without saving it. Use this before asking the user to confirm workspace, title, context, due date, priority, recurrence, and estimated duration.",
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
            text: "Task proposal validated. Show every proposal field to the user and ask for explicit confirmation before calling create_task.",
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
      title: "Create a confirmed Daily Command Center task",
      description:
        "Create the exact canonical task returned by preview_task. Call only after the user explicitly confirms the displayed proposal in the current conversation. Set confirmedByUser to true only after that confirmation.",
      inputSchema: {
        requestId: z.string().regex(/^chat:[A-Za-z0-9._:-]{1,123}$/),
        confirmedByUser: z.literal(true).describe("Must reflect explicit confirmation in the current chat."),
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
