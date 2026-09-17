import {
  DAILY_INTAKE_SOURCE_KEYS,
  validateScanStatusInput,
  type DailyIntakeSourceKey,
  type ScanStatusInput,
} from "@/lib/runtime/daily-intake";
import type { D1Database } from "@/lib/runtime/d1";
import type {
  SourceFreshness,
  SourceFreshnessRepository,
} from "@/lib/runtime/source-freshness-repository";

const rowColumns = "source_key, state, last_attempt_at, last_successful_at, diagnostic, scan_run_id";

type Row = Readonly<{
  source_key: string;
  state: "SUCCESS" | "FAILED";
  last_attempt_at: string;
  last_successful_at: string | null;
  diagnostic: string | null;
  scan_run_id: string;
}>;

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId.trim().length < 3 || userId.length > 160) {
    throw new Error("DCC user ID is invalid.");
  }
}

function unknown(sourceKey: DailyIntakeSourceKey): SourceFreshness {
  return {
    sourceKey,
    state: "UNKNOWN",
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    diagnostic: null,
    scanRunId: null,
  };
}

function fromRow(row: Row): SourceFreshness {
  return {
    sourceKey: row.source_key as DailyIntakeSourceKey,
    state: row.state,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessfulAt: row.last_successful_at,
    diagnostic: row.diagnostic,
    scanRunId: row.scan_run_id,
  };
}

export class D1SourceFreshnessRepository implements SourceFreshnessRepository {
  constructor(private readonly database: D1Database) {}

  private async requireActiveUser(userId: string): Promise<void> {
    assertUserId(userId);
    const row = await this.database.prepare("SELECT user_id FROM users WHERE user_id=? AND status='ACTIVE'")
      .bind(userId).first<{ user_id: string }>();
    if (!row) throw new Error("DCC user access denied.");
  }

  async record(userId: string, input: ScanStatusInput): Promise<void> {
    await this.requireActiveUser(userId);
    validateScanStatusInput(input);

    const statements = input.sources.map((source) => this.database.prepare(`INSERT INTO daily_intake_source_status (
      user_id, source_key, state, last_attempt_at, last_successful_at, diagnostic, scan_run_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_key) DO UPDATE SET
      state=excluded.state,
      last_attempt_at=excluded.last_attempt_at,
      last_successful_at=CASE
        WHEN excluded.state='SUCCESS' THEN excluded.last_successful_at
        ELSE daily_intake_source_status.last_successful_at
      END,
      diagnostic=excluded.diagnostic,
      scan_run_id=excluded.scan_run_id,
      updated_at=excluded.updated_at`)
      .bind(
        userId,
        source.sourceKey,
        source.state,
        source.attemptedAt,
        source.state === "SUCCESS" ? source.completedAt! : null,
        source.state === "FAILED" ? source.diagnostic! : null,
        input.scanRunId,
        source.state === "SUCCESS" ? source.completedAt! : source.attemptedAt,
      ));

    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("Source freshness persistence failed.");
  }

  async get(userId: string, sourceKey: DailyIntakeSourceKey): Promise<SourceFreshness> {
    await this.requireActiveUser(userId);
    if (!DAILY_INTAKE_SOURCE_KEYS.includes(sourceKey)) throw new Error("Daily Intake source is not supported.");
    const row = await this.database.prepare(`SELECT ${rowColumns} FROM daily_intake_source_status
      WHERE user_id=? AND source_key=?`).bind(userId, sourceKey).first<Row>();
    return row ? fromRow(row) : unknown(sourceKey);
  }

  async list(userId: string): Promise<SourceFreshness[]> {
    await this.requireActiveUser(userId);
    const result = await this.database.prepare(`SELECT ${rowColumns} FROM daily_intake_source_status WHERE user_id=?`)
      .bind(userId).all<Row>();
    if (!result.success) throw new Error("Source freshness read failed.");
    const byKey = new Map((result.results ?? []).map((row) => [row.source_key, fromRow(row)] as const));
    return DAILY_INTAKE_SOURCE_KEYS.map((sourceKey) => byKey.get(sourceKey) ?? unknown(sourceKey));
  }
}
