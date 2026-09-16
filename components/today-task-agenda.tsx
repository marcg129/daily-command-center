"use client";

import { useRouter } from "next/navigation";
import { Bell, Clock3, ListTodo, WalletCards } from "lucide-react";
import { billAmountPresentation } from "@/lib/bill-ui";
import {
  billOccurrenceIsOverdue,
  billOccurrencesNeedingAttentionToday,
  billProjectionToday,
  type ProjectedBillOccurrence,
} from "@/lib/bill-projections";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { taskCalendarEntriesForToday, type TaskCalendarEntry } from "@/lib/task-calendar";
import type { TaskItem } from "@/lib/types";
import { useProjectedBills } from "@/components/use-projected-bills";
import styles from "./today-task-agenda.module.css";

const KIND_LABEL = { DUE: "Due", REMINDER: "Reminder", FOLLOW_UP: "Follow-up" } as const;

type AgendaEntry =
  | Readonly<{ source: "TASK"; id: string; entry: TaskCalendarEntry }>
  | Readonly<{ source: "BILL"; id: string; entry: ProjectedBillOccurrence }>;

function entryTime(entry: TaskCalendarEntry) {
  if (!entry.timestamp) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(entry.timestamp));
}

function billDueLabel(entry: ProjectedBillOccurrence, today: string) {
  if (billOccurrenceIsOverdue(entry, today)) return `Overdue · due ${entry.occurrence.dueDate}`;
  return "Due today";
}

export function TodayTaskAgenda({
  tasks,
  workspaceId,
  onOpenTask,
}: {
  tasks: TaskItem[];
  workspaceId: ProductWorkspaceId;
  onOpenTask: (taskId: TaskItem["id"]) => void;
}) {
  const router = useRouter();
  const today = billProjectionToday();
  const projectedBills = useProjectedBills(workspaceId);
  const taskEntries = taskCalendarEntriesForToday(tasks, workspaceId);
  const billEntries = billOccurrencesNeedingAttentionToday(projectedBills.occurrences, today);
  const entries: AgendaEntry[] = [
    ...billEntries.map((entry) => ({ source: "BILL" as const, id: `bill:${entry.workspaceId}:${entry.occurrence.occurrenceId}`, entry })),
    ...taskEntries.map((entry) => ({ source: "TASK" as const, id: `task:${entry.id}`, entry })),
  ];
  const visibleEntries = entries.slice(0, 6);

  return <div className={styles.agenda} aria-label="Today's task and bill schedule">
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Today&apos;s schedule</p>
        <h3>Tasks &amp; bill obligations</h3>
      </div>
      <b aria-label={`${entries.length} scheduled task and bill entries needing attention today`}>{entries.length}</b>
    </div>
    {visibleEntries.length ? <div className={styles.list}>
      {visibleEntries.map((item) => {
        if (item.source === "BILL") {
          const entry = item.entry;
          const amount = billAmountPresentation(entry.bill, entry.occurrence);
          const overdue = billOccurrenceIsOverdue(entry, today);
          const workspaceLabel = entry.workspaceId === "indelitech" && workspaceId === "personal" ? " · Indelitech" : "";
          return <button
            type="button"
            key={item.id}
            className={`${styles.item} ${overdue ? styles.overdue : ""}`}
            onClick={() => router.push(`/bills?workspaceId=${encodeURIComponent(entry.workspaceId)}`)}
            aria-label={`${entry.bill.name}, bill ${billDueLabel(entry, today)}, ${amount.label}${workspaceLabel}`}
          >
            <WalletCards size={15} aria-hidden="true" />
            <span className={styles.copy}>
              <b>{entry.bill.name}</b>
              <small>{billDueLabel(entry, today)} · {amount.label}{entry.bill.autopay ? " · AutoPay expected" : ""}{workspaceLabel}</small>
            </span>
          </button>;
        }

        const entry = item.entry;
        const Icon = entry.kind === "DUE" ? ListTodo : entry.kind === "REMINDER" ? Bell : Clock3;
        const workspaceLabel = entry.task.primaryWorkspaceId === "indelitech" && workspaceId === "personal" ? " · Indelitech" : "";
        return <button
          type="button"
          key={item.id}
          className={`${styles.item} ${entry.overdue ? styles.overdue : ""}`}
          data-priority={entry.priority.toLowerCase()}
          onClick={() => onOpenTask(entry.taskId)}
          aria-label={`${entry.task.title}, ${KIND_LABEL[entry.kind]} ${entryTime(entry)}${entry.overdue ? ", overdue" : ""}${workspaceLabel}`}
        >
          <Icon size={15} aria-hidden="true" />
          <span className={styles.copy}>
            <b>{entry.task.title}</b>
            <small>{entry.overdue ? "Overdue · " : ""}{KIND_LABEL[entry.kind]} · {entryTime(entry)}{workspaceLabel}</small>
          </span>
        </button>;
      })}
    </div> : <p className="inline-empty">No task dates, reminders, follow-ups, or bill obligations need attention today.</p>}
    {projectedBills.error && <small className={styles.more}>Bills could not be included right now: {projectedBills.error}</small>}
    {projectedBills.loading && <small className={styles.more}>Checking bill obligations…</small>}
    {entries.length > visibleEntries.length && <small className={styles.more}>+{entries.length - visibleEntries.length} more scheduled {entries.length - visibleEntries.length === 1 ? "entry" : "entries"} in Calendar.</small>}
  </div>;
}
