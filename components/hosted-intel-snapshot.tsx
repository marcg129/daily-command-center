"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { HostedIntelSnapshotResponse } from "@/lib/runtime/hosted-intel";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import styles from "./hosted-intel-snapshot.module.css";

type LoadState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: HostedIntelSnapshotResponse };

function formatInstant(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function storyDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function HostedIntelSnapshotView({ icon }: { icon: ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hosted/intel?workspaceId=indelitech", {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as HostedIntelSnapshotResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Hosted Intel could not be loaded.");
      setLoad({ state: "ready", data: body });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({ state: "error", message: error instanceof Error ? error.message : "Hosted Intel could not be loaded." });
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="view workspace-page-shell">
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Indelitech · Intel</p>
          <h1>Intel</h1>
          <p className="page-description">Read-only business intelligence from the protected Indelitech snapshot store.</p>
        </div>
      </div>
      <section className="panel reveal delay-1">
        {load.state === "loading" && (
          <div className={styles.emptyState} aria-live="polite">
            <span className="workspace-empty-icon">{icon}</span>
            <p className="eyebrow">Hosted Intel</p>
            <h2>Loading protected snapshot…</h2>
            <p>Checking the Indelitech workspace for the latest stored intelligence.</p>
          </div>
        )}
        {load.state === "error" && (
          <div className={styles.emptyState} role="status">
            <span className="workspace-empty-icon">{icon}</span>
            <p className="eyebrow">Hosted Intel unavailable</p>
            <h2>The snapshot could not be read safely</h2>
            <p>{load.message}</p>
          </div>
        )}
        {load.state === "ready" && load.data.status === "empty" && (
          <div className={styles.emptyState}>
            <span className="workspace-empty-icon">{icon}</span>
            <p className="eyebrow">Hosted Intel · Ready for data</p>
            <h2>No Indelitech snapshot has been published yet</h2>
            <p>The protected read path is active. A later collector milestone will populate this workspace; no local feed or placeholder results are substituted.</p>
          </div>
        )}
        {load.state === "ready" && load.data.status !== "empty" && (
          <>
            <div className={styles.statusRow}>
              <span className={`${styles.status} ${load.data.status === "current" ? styles.current : styles.stale}`}>
                {load.data.status === "current" ? "Current snapshot" : "Stale snapshot"}
              </span>
              <span className={styles.checkedAt}>Checked {load.data.checkedAt ? formatInstant(load.data.checkedAt) : "at an unknown time"}</span>
            </div>
            {load.data.items.length ? (
              <div className={styles.storyList}>
                {load.data.items.map((story) => (
                  <a className={styles.story} href={story.url} target="_blank" rel="noreferrer noopener" key={story.id}>
                    <div className={styles.storyMeta}>
                      <span>{story.source}</span>
                      <span>{storyDate(story.publishedAt)}</span>
                    </div>
                    <h3>{story.title}</h3>
                    {(story.aiSummary || story.summary) && <p>{story.aiSummary || story.summary}</p>}
                    {story.importanceReason && <p className={styles.reason}>{story.importanceReason}</p>}
                  </a>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <h2>No current items in this snapshot</h2>
                <p>The stored snapshot is valid, but it contains no displayable intelligence items.</p>
              </div>
            )}
            {load.data.errors.length > 0 && (
              <p className={styles.notice}>Collector note: {load.data.errors[0]}</p>
            )}
            {load.data.status === "stale" && (
              <p className={styles.notice}>This snapshot is older than its {load.data.freshnessHours}-hour freshness window. It is shown for continuity, not represented as current intelligence.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
