import type { DailyIntakeSourceKey, ScanStatusInput, ScanStatusState } from "./daily-intake";

export type SourceFreshnessState = ScanStatusState | "UNKNOWN";

export type SourceFreshness = Readonly<{
  sourceKey: DailyIntakeSourceKey;
  state: SourceFreshnessState;
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  diagnostic: string | null;
  scanRunId: string | null;
}>;

export interface SourceFreshnessRepository {
  record(userId: string, input: ScanStatusInput): Promise<void>;
  get(userId: string, sourceKey: DailyIntakeSourceKey): Promise<SourceFreshness>;
  list(userId: string): Promise<SourceFreshness[]>;
}
