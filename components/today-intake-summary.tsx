"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Inbox } from "lucide-react";
import { loadHostedApplicationSession } from "@/lib/runtime/browser-runtime";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { useIntake } from "./use-intake";
import styles from "./today-intake-summary.module.css";

export function TodayIntakeSummary({
  workspaceId,
  enabled,
  onOpenIntake,
}: {
  workspaceId: ProductWorkspaceId;
  enabled: boolean;
  onOpenIntake: () => void;
}) {
  const [authorizedWorkspaceIds, setAuthorizedWorkspaceIds] = useState<ProductWorkspaceId[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const session = await loadHostedApplicationSession(fetch);
        if (cancelled) return;
        setAuthorizedWorkspaceIds(session.workspaces.map(({ workspaceId: authorized }) => authorized));
        setSessionReady(true);
        setSessionError("");
      } catch (caught) {
        if (cancelled) return;
        setSessionReady(true);
        setSessionError(caught instanceof Error ? caught.message : "Intake authorization could not be loaded.");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled]);

  const intake = useIntake({
    scope: workspaceId,
    viewMode: "PENDING",
    authorizedWorkspaceIds,
    enabled: enabled && sessionReady && !sessionError,
  });
  const sourceWarnings = intake.sources.filter((source) => source.state === "FAILED" || source.state === "UNKNOWN");
  const workspaceLabel = workspaceId === "indelitech" ? "Indelitech" : "Personal";
  const combinedError = sessionError || intake.freshnessError || intake.error;

  if (!enabled) return null;

  return <section className={styles.panel} aria-label={`${workspaceLabel} Intake summary`}>
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Daily Intake</p>
        <h2>Needs review</h2>
      </div>
      <button type="button" className={styles.openButton} onClick={onOpenIntake}>
        <Inbox size={14} aria-hidden="true" /> Open Intake
      </button>
    </div>

    <div className={styles.countRow}>
      <strong>{intake.loading && !sessionReady ? "—" : intake.items.length}</strong>
      <div><span>Pending {workspaceLabel} item{intake.items.length === 1 ? "" : "s"}</span><small>Inferred work stays a proposal until you review it.</small></div>
    </div>

    {sourceWarnings.length > 0 && <div className={styles.warning} role="status">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{sourceWarnings.length} Intake source{sourceWarnings.length === 1 ? "" : "s"} need attention: {sourceWarnings.map(({ sourceKey }) => sourceKey.replaceAll("_", " ")).join(", ")}.</span>
    </div>}
    {combinedError && <div className={styles.warning} role="status"><CircleAlert size={15} aria-hidden="true" /><span>{combinedError}</span></div>}
  </section>;
}
