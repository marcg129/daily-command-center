import type { D1Database } from "@/lib/runtime/d1";
import type {
  TodoistIngressControlState,
  TodoistIngressControlStore,
  TodoistIngressControlWriteMetadata,
} from "@/lib/runtime/todoist-ingress-runner";

const INTEGRATION_KEY = "todoist-task-ingress:v1";

type ControlRow = Readonly<{
  cursor_added_at: string | null;
  cursor_task_id: string | null;
  cooldown_until_ms: number | null;
}>;

export class D1TodoistIngressControlStore implements TodoistIngressControlStore {
  constructor(private readonly database: D1Database) {}

  async load(): Promise<TodoistIngressControlState> {
    const row = await this.database.prepare(
      `SELECT cursor_added_at, cursor_task_id, cooldown_until_ms
       FROM todoist_ingress_control
       WHERE integration_key = ?
       LIMIT 1`,
    ).bind(INTEGRATION_KEY).first<ControlRow>();

    if (!row) {
      return { cursorAddedAt: null, cursorTaskId: null, cooldownUntilMs: null };
    }

    return {
      cursorAddedAt: row.cursor_added_at,
      cursorTaskId: row.cursor_task_id,
      cooldownUntilMs: row.cooldown_until_ms,
    };
  }

  async save(state: TodoistIngressControlState, metadata: TodoistIngressControlWriteMetadata): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO todoist_ingress_control (
         integration_key,
         cursor_added_at,
         cursor_task_id,
         cursor_run_started_ms,
         cooldown_until_ms,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(integration_key) DO UPDATE SET
         cursor_added_at = CASE
           WHEN excluded.cursor_run_started_ms >= todoist_ingress_control.cursor_run_started_ms
             THEN excluded.cursor_added_at
           ELSE todoist_ingress_control.cursor_added_at
         END,
         cursor_task_id = CASE
           WHEN excluded.cursor_run_started_ms >= todoist_ingress_control.cursor_run_started_ms
             THEN excluded.cursor_task_id
           ELSE todoist_ingress_control.cursor_task_id
         END,
         cursor_run_started_ms = MAX(
           todoist_ingress_control.cursor_run_started_ms,
           excluded.cursor_run_started_ms
         ),
         cooldown_until_ms = CASE
           WHEN excluded.cooldown_until_ms IS NOT NULL THEN
             CASE
               WHEN todoist_ingress_control.cooldown_until_ms IS NULL
                 OR excluded.cooldown_until_ms > todoist_ingress_control.cooldown_until_ms
                 THEN excluded.cooldown_until_ms
               ELSE todoist_ingress_control.cooldown_until_ms
             END
           WHEN todoist_ingress_control.cooldown_until_ms IS NOT NULL
             AND todoist_ingress_control.cooldown_until_ms > ?
             THEN todoist_ingress_control.cooldown_until_ms
           ELSE NULL
         END,
         updated_at = excluded.updated_at`,
    ).bind(
      INTEGRATION_KEY,
      state.cursorAddedAt,
      state.cursorTaskId,
      metadata.runStartedAtMs,
      state.cooldownUntilMs,
      new Date(metadata.observedAtMs).toISOString(),
      metadata.observedAtMs,
    ).run();

    if (!result.success) throw new Error("Todoist ingress control state write failed.");
  }
}
