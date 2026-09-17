"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Inbox,
  RefreshCw,
  X,
} from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { IntakeEditablePatch } from "@/lib/runtime/daily-intake";
import type { HostedIntakeItem } from "@/lib/runtime/intake-repository";
import type { SourceFreshness } from "@/lib/runtime/source-freshness-repository";
import { WORKSPACES } from "@/lib/workspace-ui";
import { useIntake, type IntakeScope, type IntakeViewMode } from "./use-intake";
import styles from "./intake-view.module.css";

type EditDraft = {
  item: HostedIntakeItem;
  title: string;
  workspaceId: ProductWorkspaceId;
  dueDate: string;
  followUpAt: string;
  priority: "" | "LOW" | "MEDIUM" | "HIGH";
  amount: string;
  currency: string;
};

const SOURCE_LABELS: Record<HostedIntakeItem["sourceKey"], string> = {
  personal_gmail: "Personal Gmail",
  professional_gmail: "Professional Gmail",
  indelitech_gmail: "Indelitech Gmail",
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: year === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function amountInput(amountMinor: number | null): string {
  return amountMinor === null ? "" : (amountMinor / 100).toFixed(2);
}

function amountToMinor(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) throw new Error("Enter the amount with no more than two decimal places.");
  const amount = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Enter a valid non-negative amount.");
  return amount;
}

function localDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function exactInstant(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid date and time.");
  return date.toISOString();
}

function draftFor(item: HostedIntakeItem): EditDraft {
  return {
    item,
    title: item.title,
    workspaceId: item.workspaceKey,
    dueDate: item.dueDate ?? "",
    followUpAt: localDateTimeInput(item.followUpAt),
    priority: item.priority ?? "",
    amount: amountInput(item.amountMinor),
    currency: item.currency ?? "",
  };
}

function freshnessFor(item: HostedIntakeItem, sources: readonly SourceFreshness[]): SourceFreshness | undefined {
  return sources.find((source) => source.sourceKey === item.sourceKey);
}

function freshnessMessage(source: SourceFreshness | undefined): string | null {
  if (!source) return "Source freshness is unknown. Review the evidence before acting.";
  if (source.state === "FAILED") return source.diagnostic ? `Latest source scan failed: ${source.diagnostic}` : "Latest source scan failed. Review the evidence before acting.";
  if (source.state === "UNKNOWN") return "Source freshness is unknown. Review the evidence before acting.";
  return null;
}

function itemTypeLabel(item: HostedIntakeItem): string {
  if (item.intakeType === "FOLLOW_UP") return "Follow-up";
  if (item.intakeType === "BILL") return "Bill";
  if (item.intakeType === "AWARENESS") return "Awareness";
  return "Task";
}

function historyLabel(item: HostedIntakeItem): string {
  if (item.status === "APPROVED") return item.approvedTargetKind ? `Approved · ${item.approvedTargetKind}` : "Approved";
  if (item.status === "ARCHIVED") return "Archived";
  if (item.status === "DISMISSED") return "Dismissed";
  return item.status;
}

export function IntakeView({
  workspaceId,
  authorizedWorkspaceIds,
  enabled,
}: {
  workspaceId: ProductWorkspaceId;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  enabled: boolean;
}) {
  const [viewMode, setViewMode] = useState<IntakeViewMode>("PENDING");
  const [scope, setScope] = useState<IntakeScope>(workspaceId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState("");
  const [deferItem, setDeferItem] = useState<HostedIntakeItem | null>(null);
  const [deferUntil, setDeferUntil] = useState("");
  const [deferError, setDeferError] = useState("");

  useEffect(() => {
    setScope(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setEditing(null);
    setDeferItem(null);
  }, [scope, viewMode]);

  const intake = useIntake({ scope, viewMode, authorizedWorkspaceIds, enabled });
  const canShowAll = authorizedWorkspaceIds.includes("personal") && authorizedWorkspaceIds.includes("indelitech");
  const selectedItems = useMemo(
    () => intake.items.filter((item) => selectedIds.has(item.intakeId)),
    [intake.items, selectedIds],
  );

  const toggleSelected = (item: HostedIntakeItem, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(item.intakeId);
      else next.delete(item.intakeId);
      return next;
    });
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setEditError("");
    try {
      const title = editing.title.trim();
      if (!title) throw new Error("Title is required.");
      const patch: IntakeEditablePatch = {
        workspaceId: editing.workspaceId,
        title,
      };
      if (editing.item.intakeType === "TASK" || editing.item.intakeType === "FOLLOW_UP") {
        Object.assign(patch, {
          dueDate: editing.dueDate || null,
          followUpAt: exactInstant(editing.followUpAt),
          priority: editing.priority || null,
        });
      }
      if (editing.item.intakeType === "BILL") {
        const amountMinor = amountToMinor(editing.amount);
        const currency = editing.currency.trim().toUpperCase();
        if ((amountMinor === null) !== (currency === "")) throw new Error("Bill amount and currency must both be filled in or both be blank.");
        Object.assign(patch, {
          dueDate: editing.dueDate || null,
          amountMinor,
          currency: currency || null,
        });
      }
      const ok = await intake.editAndApprove(editing.item, patch);
      if (ok) setEditing(null);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "Changes could not be prepared safely.");
    }
  };

  const submitDefer = async (event: FormEvent) => {
    event.preventDefault();
    if (!deferItem) return;
    setDeferError("");
    try {
      const until = exactInstant(deferUntil);
      if (!until) throw new Error("Choose when this item should return to Pending.");
      const ok = await intake.defer(deferItem, until);
      if (ok) {
        setDeferItem(null);
        setDeferUntil("");
      }
    } catch (caught) {
      setDeferError(caught instanceof Error ? caught.message : "The defer time could not be prepared safely.");
    }
  };

  if (!enabled) {
    return (
      <div className={styles.view}>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>{WORKSPACES[workspaceId].displayName} · Intake</p>
            <h1>Daily Intake</h1>
            <p>Review inferred work before it becomes a canonical Task or Bill.</p>
          </div>
        </div>
        <section className={styles.emptyState}>
          <Inbox size={28} />
          <h2>Daily Intake is hosted-only</h2>
          <p>Local mode does not expose authenticated Gmail or Calendar Intake records.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{WORKSPACES[workspaceId].displayName} · Review queue</p>
          <h1>Daily Intake</h1>
          <p>Review source-backed proposals before anything inferred becomes a Task or Bill.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={intake.refresh} disabled={intake.loading || intake.actionPending}>
          <RefreshCw size={15} className={intake.loading ? styles.spin : undefined} /> Refresh
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.modeTabs} aria-label="Intake review state">
          <button type="button" className={viewMode === "PENDING" ? styles.active : undefined} onClick={() => setViewMode("PENDING")}>Pending</button>
          <button type="button" className={viewMode === "DEFERRED" ? styles.active : undefined} onClick={() => setViewMode("DEFERRED")}>Deferred</button>
          <button type="button" className={viewMode === "AWARENESS" ? styles.active : undefined} onClick={() => setViewMode("AWARENESS")}>Awareness</button>
          <button type="button" className={viewMode === "HISTORY" ? styles.active : undefined} onClick={() => setViewMode("HISTORY")}>History</button>
        </div>
        <div className={styles.scopeTabs} aria-label="Intake workspace">
          {authorizedWorkspaceIds.includes("personal") && (
            <button type="button" className={scope === "personal" ? styles.active : undefined} onClick={() => setScope("personal")}>Personal</button>
          )}
          {authorizedWorkspaceIds.includes("indelitech") && (
            <button type="button" className={scope === "indelitech" ? styles.active : undefined} onClick={() => setScope("indelitech")}>Indelitech</button>
          )}
          {canShowAll && (
            <button type="button" className={scope === "all" ? styles.active : undefined} onClick={() => setScope("all")}>All</button>
          )}
        </div>
      </div>

      <p className={styles.liveRegion} aria-live="polite">
        {intake.actionMessage || (intake.loading ? "Refreshing Intake…" : `${intake.items.length} item${intake.items.length === 1 ? "" : "s"} in this view.`)}
      </p>
      {intake.error && <div className={styles.errorBanner} role="alert"><CircleAlert size={17} /> {intake.error}</div>}
      {intake.freshnessError && <div className={styles.warningBanner}><CircleAlert size={17} /> Source freshness could not be confirmed: {intake.freshnessError}</div>}

      {selectedItems.length > 0 && (
        <div className={styles.bulkBar}>
          <span>{selectedItems.length} selected</span>
          <button type="button" onClick={() => void intake.bulkApprove(selectedItems)} disabled={intake.actionPending}><Check size={14} /> Approve selected</button>
          <button type="button" onClick={() => void intake.bulkDismiss(selectedItems)} disabled={intake.actionPending}><X size={14} /> Dismiss selected</button>
          <button type="button" onClick={() => setSelectedIds(new Set())} disabled={intake.actionPending}>Clear</button>
        </div>
      )}

      <div className={styles.cardStack}>
        {intake.items.map((item) => {
          const workspaceLabel = WORKSPACES[item.workspaceKey].displayName;
          const sourceFreshness = freshnessFor(item, intake.sources);
          const staleMessage = freshnessMessage(sourceFreshness);
          const canReview = viewMode !== "HISTORY";
          const canBulkSelect = canReview && item.intakeType !== "AWARENESS" && item.intakeType !== "BILL";
          const billNeedsEdit = item.intakeType === "BILL" && (!item.dueDate || item.amountMinor === null || !item.currency);
          return (
            <article className={styles.card} key={item.intakeId}>
              <div className={styles.cardTop}>
                <div className={styles.chips}>
                  <span className={styles.typeChip}>{itemTypeLabel(item)}</span>
                  <span className={styles.workspaceChip}>{workspaceLabel}</span>
                  {viewMode === "HISTORY" && <span className={styles.statusChip}>{historyLabel(item)}</span>}
                </div>
                {canBulkSelect && (
                  <label className={styles.selectLabel}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.intakeId)}
                      onChange={(event) => toggleSelected(item, event.target.checked)}
                      disabled={intake.actionPending}
                    />
                    Select
                  </label>
                )}
              </div>

              <h2>{item.title}</h2>
              <div className={styles.sourceLine}>
                <span>{SOURCE_LABELS[item.sourceKey]} · {item.sourceKey}</span>
                <span><Clock3 size={12} /> {formatTimestamp(item.sourceTimestamp)}</span>
              </div>
              {(item.sourceSender || item.sourceSubject) && (
                <p className={styles.sourceIdentity}>{[item.sourceSender, item.sourceSubject].filter(Boolean).join(" · ")}</p>
              )}

              <div className={styles.evidenceGrid}>
                {item.dueDate && <div><span>Due</span><b>{formatDateOnly(item.dueDate)}</b></div>}
                {item.followUpAt && <div><span>Follow up</span><b>{formatTimestamp(item.followUpAt)}</b></div>}
                {item.amountMinor !== null && item.currency && <div><span>Amount</span><b>{formatAmount(item.amountMinor, item.currency)}</b></div>}
                {item.priority && <div><span>Priority</span><b>{item.priority}</b></div>}
                {item.deferUntil && viewMode === "DEFERRED" && <div><span>Returns</span><b>{formatTimestamp(item.deferUntil)}</b></div>}
              </div>

              <div className={styles.reasonBlock}>
                <b>Why this was suggested</b>
                <p>{item.classificationReason}</p>
              </div>
              <details className={styles.details}>
                <summary>Source evidence</summary>
                <p>{item.sourceSummary}</p>
                <small>Workspace: {item.workspaceKey} · Source observed {formatTimestamp(item.sourceTimestamp)}</small>
              </details>

              {staleMessage && <div className={styles.cardWarning}><CircleAlert size={15} /> {staleMessage}</div>}
              {billNeedsEdit && canReview && <div className={styles.cardWarning}>This Bill still needs a due date, amount, or currency before approval. Use Edit & Approve.</div>}

              <div className={styles.cardActions}>
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} /></a>}
                {canReview && item.intakeType !== "AWARENESS" && (
                  <>
                    <button type="button" onClick={() => void intake.approve(item)} disabled={intake.actionPending || billNeedsEdit}><Check size={14} /> Approve</button>
                    <button type="button" onClick={() => { setEditError(""); setEditing(draftFor(item)); }} disabled={intake.actionPending}>Edit & Approve</button>
                  </>
                )}
                {canReview && (
                  <button type="button" onClick={() => { setDeferError(""); setDeferUntil(""); setDeferItem(item); }} disabled={intake.actionPending}>Defer</button>
                )}
                {canReview && <button type="button" onClick={() => void intake.dismiss(item)} disabled={intake.actionPending}>Dismiss</button>}
                {canReview && item.intakeType === "AWARENESS" && <button type="button" onClick={() => void intake.archive(item)} disabled={intake.actionPending}><Archive size={14} /> Archive</button>}
              </div>
            </article>
          );
        })}
      </div>

      {!intake.loading && !intake.items.length && !intake.error && (
        <section className={styles.emptyState}>
          <Inbox size={28} />
          <h2>Nothing to review here</h2>
          <p>{viewMode === "PENDING" ? "No actionable proposals are waiting for approval." : viewMode === "AWARENESS" ? "No new awareness-only findings are waiting." : viewMode === "DEFERRED" ? "No items are currently deferred." : "No recent resolved Intake items are available."}</p>
        </section>
      )}

      {editing && (
        <div className={styles.modalBackdrop}>
          <form className={styles.modal} onSubmit={(event) => void submitEdit(event)}>
            <div className={styles.modalHeader}>
              <div><p className={styles.eyebrow}>Review before canonical write</p><h2>Edit & Approve</h2></div>
              <button type="button" className={styles.iconButton} aria-label="Close edit form" onClick={() => setEditing(null)}><X size={18} /></button>
            </div>
            <label>
              Title
              <input value={editing.title} onChange={(event) => setEditing((current) => current ? { ...current, title: event.target.value } : current)} required maxLength={300} />
            </label>
            <label>
              Workspace
              <select value={editing.workspaceId} onChange={(event) => setEditing((current) => current ? { ...current, workspaceId: event.target.value as ProductWorkspaceId } : current)}>
                {authorizedWorkspaceIds.includes("personal") && <option value="personal">Personal</option>}
                {authorizedWorkspaceIds.includes("indelitech") && <option value="indelitech">Indelitech</option>}
              </select>
            </label>
            {(editing.item.intakeType === "TASK" || editing.item.intakeType === "FOLLOW_UP") && (
              <div className={styles.formGrid}>
                <label>Due date<input type="date" value={editing.dueDate} onChange={(event) => setEditing((current) => current ? { ...current, dueDate: event.target.value } : current)} /></label>
                <label>Follow-up time<input type="datetime-local" value={editing.followUpAt} onChange={(event) => setEditing((current) => current ? { ...current, followUpAt: event.target.value } : current)} /></label>
                <label>Priority<select value={editing.priority} onChange={(event) => setEditing((current) => current ? { ...current, priority: event.target.value as EditDraft["priority"] } : current)}><option value="">Unspecified</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
              </div>
            )}
            {editing.item.intakeType === "BILL" && (
              <div className={styles.formGrid}>
                <label>Due date<input type="date" value={editing.dueDate} onChange={(event) => setEditing((current) => current ? { ...current, dueDate: event.target.value } : current)} /></label>
                <label>Amount<input inputMode="decimal" value={editing.amount} onChange={(event) => setEditing((current) => current ? { ...current, amount: event.target.value } : current)} placeholder="0.00" /></label>
                <label>Currency<input value={editing.currency} onChange={(event) => setEditing((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} maxLength={3} placeholder="USD" /></label>
              </div>
            )}
            <div className={styles.formEvidence}>
              <b>Source evidence remains visible</b>
              <p>{editing.item.sourceSummary}</p>
              <small>{editing.item.classificationReason}</small>
            </div>
            {editError && <p className={styles.formError} role="alert">{editError}</p>}
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setEditing(null)} disabled={intake.actionPending}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={intake.actionPending}>{intake.actionPending ? "Saving…" : "Save & approve"}</button>
            </div>
          </form>
        </div>
      )}

      {deferItem && (
        <div className={styles.modalBackdrop}>
          <form className={styles.modal} onSubmit={(event) => void submitDefer(event)}>
            <div className={styles.modalHeader}>
              <div><p className={styles.eyebrow}>Return it later</p><h2>Defer</h2></div>
              <button type="button" className={styles.iconButton} aria-label="Close defer form" onClick={() => setDeferItem(null)}><X size={18} /></button>
            </div>
            <p>{deferItem.title}</p>
            <label>
              Return to Pending at
              <input type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.target.value)} required />
            </label>
            {deferError && <p className={styles.formError} role="alert">{deferError}</p>}
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setDeferItem(null)} disabled={intake.actionPending}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={intake.actionPending}>{intake.actionPending ? "Saving…" : "Defer"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
