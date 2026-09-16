import type { D1Database } from "@/lib/runtime/d1";
import type {
  TodoistIngressControlState,
  TodoistIngressControlStore,
} from "@/lib/runtime/todoist-ingress-runner";

const INTEGRATION_KEY = "todoist-task-ingress:v1";

type ControlRow = Readonly<{
  rotation_offset: number;
  cooldown_until_ms: number | null;
}>;

export class D1TodoistIngressControlStore implements TodoistIngressControlStore {
  constructor(private readonly database: D1Database) {}

  async load(): Promise<TodoistIngressControlState> {
    const row = await this.database.prepare(
      `SELECT rotation_offset, cooldown_until_ms
       FROM todoist_ingress_control
       WHERE integration_key = ?
       LIMIT 1`,
    ).bind(INTEGRATION_KEY).first<ControlRow>();

    if (!row) {
      return { rotationOffset: 0, cooldownUntilMs: null };
    }

    return {
      rotationOffset: row.rotation_offset,
      cooldownUntilMs: row.cooldown_until_ms,
    };
  }

  async save(state: TodoistIngressControlState): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO todoist_ingress_control (
         integration_key,
         rotation_offset,
         cooldown_until_ms,
         updated_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(integration_key) DO UPDATE SET
         rotation_offset = excluded.rotation_offset,
         cooldown_until_ms = excluded.cooldown_until_ms,
         updated_at = excluded.updated_at`,
    ).bind(
      INTEGRATION_KEY,
      state.rotationOffset,
      state.cooldownUntilMs,
      new Date().toISOString(),
    ).run();

    if (!result.success) throw new Error("Todoist ingress control state write failed.");
  }
}
