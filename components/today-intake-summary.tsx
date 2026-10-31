"use client";

import { CircleAlert, Inbox } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { SourceFreshness } from "@/lib/runtime/source-freshness-repository";
import { useIntake } from "@/components/use-intake";
import styles from "./today-intake-summary.module.css";

const SOURCE_LABELS: Record<SourceFreshness["sourceKey"], string> = {
  personal_gmail: "Personal Gmail",
  professional_gmail: "Professional Gmail",
  indelitech_gmail: "Indelitech Gmail",
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
};

function freshnessWarnings(sources: readonly SourceFreshness[]): SourceFreshness[] {
  const bySource = new Map<SourceFreshness["sourceKey"], SourceFreshness>();
  for (const source of sources) {
    const current = bySource.get(source.sourceKey);
    if (!current || current.state === "SUCCESS" || source.state === "FAILED") bySource.set(source.sourceKey, source);
  }
  return [...bySource.values()].filter((source) => source.state === "FAILED" || source.state === "UNKNOWN");
}

export function TodayIntakeSummary({
  workspaceId,
  authorizedWorkspaceIds,
  enabled,
  onOpenIntake,
}: {
  workspaceId: ProductWorkspaceId;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  enabled: boolean;
  onOpenIntake: () => void;
}) {
  const canShowAll = authorizedWorkspaceIds.includes("personal") && authorizedWorkspaceIds.includes("indelitech");
  const scope = workspaceId === "personal" && canShowAll ? "all" : workspaceId;
  const intake = useIntake({ scope, viewMode: "PENDING", authorizedWorkspaceIds, enabled });
  const personalCount = intake.items.filter((item) => item.workspaceKey === "personal").length;
  const indelitechCount = intake.items.filter((item) => item.workspaceKey === "indelitech").length;
  const staleSources = freshnessWarnings(intake.sources);

  if (!enabled) return null;

  return <section className={styles.panel} aria-label={`${workspaceId === "personal" ? "Personal and Indelitech" : "Indelitech"} Intake review summary`}>
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Daily Intake</p>
        <h2>Needs review</h2>
      </div>
      <button type="button" onClick={onOpenIntake}><Inbox size={14} /> Open Intake</button>
    </div>

    <div className={styles.summary}>
      <strong aria-label={`${intake.items.length} Intake items require review`}>{intake.loading ? "…" : intake.items.length}</strong>
      <div>
        <span>Pending proposals</span>
        <small>Nothing inferred becomes a Task or Bill until it is approved.</small>
      </div>
    </div>

    <div className={styles.breakdown} aria-label="Intake workspace breakdown">
      {authorizedWorkspaceIds.includes("personal") && <span><b>{personalCount}</b> Personal</span>}
      {authorizedWorkspaceIds.includes("indelitech") && <span><b>{indelitechCount}</b> Indelitech</span>}
    </div>

    {intake.error && <div className={styles.error} role="alert"><CircleAlert size={15} /> {intake.error}</div>}
    {intake.freshnessError && <div className={styles.warning}><CircleAlert size={15} /> Source freshness could not be confirmed: {intake.freshnessError}</div>}
    {staleSources.length > 0 && <div className={styles.warning}>
      <CircleAlert size={15} />
      <span>
        {staleSources.map((source) => `${SOURCE_LABELS[source.sourceKey]}: ${source.state === "FAILED" ? "latest scan failed" : "freshness unknown"}`).join(" · ")}
      </span>
    </div>}
  </section>;
}
