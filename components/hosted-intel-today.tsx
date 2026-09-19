"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Radio } from "lucide-react";
import type { HostedIntelSnapshotResponse } from "@/lib/runtime/hosted-intel";
import { fetchHostedWithSessionRefresh } from "@/lib/runtime/browser-runtime";
import styles from "./hosted-intel-today.module.css";

const TODAY_INTEL_LIMIT = 3;

type LoadState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; data: HostedIntelSnapshotResponse };

export function HostedIntelTodayPanel({ onOpenIntel }: { onOpenIntel: () => void }) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHostedWithSessionRefresh(fetch, "/api/hosted/intel?workspaceId=indelitech", {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as HostedIntelSnapshotResponse;
      if (!response.ok) throw new Error("Hosted Intel could not be loaded.");
      setLoad({ state: "ready", data: body });
    }).catch(() => {
      if (!controller.signal.aborted) setLoad({ state: "error" });
    });
    return () => controller.abort();
  }, []);

  if (load.state === "error") return null;

  const stories = load.state === "ready" && load.data.status !== "empty"
    ? load.data.items.slice(0, TODAY_INTEL_LIMIT)
    : [];

  return (
    <section className={styles.panel} aria-label="Indelitech Intel highlights">
      <div className={styles.header}>
        <div>
          <p className="eyebrow">Intel pulse</p>
          <h2>Worth knowing</h2>
        </div>
        <button type="button" onClick={onOpenIntel}>Open Intel</button>
      </div>
      {load.state === "loading" ? (
        <p className={styles.state}>Loading the latest protected Intel snapshot…</p>
      ) : stories.length ? (
        <div className={styles.list}>
          {stories.map((story) => (
            <a href={story.url} target="_blank" rel="noreferrer noopener" key={story.id} className={styles.story}>
              <Radio size={15} aria-hidden="true" />
              <span>
                <strong>{story.title}</strong>
                <small>{story.aiSummary || story.summary}</small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : (
        <p className={styles.state}>No current Intel highlights are available yet.</p>
      )}
      {load.state === "ready" && load.data.status === "stale" && (
        <p className={styles.stale}>Snapshot is stale; open Intel for freshness details.</p>
      )}
    </section>
  );
}
