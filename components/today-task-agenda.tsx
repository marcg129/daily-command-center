"use client";

import { Bell, Clock3, ListTodo } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { taskCalendarEntriesForToday, type TaskCalendarEntry } from "@/lib/task-calendar";
import type { TaskItem } from "@/lib/types";
import styles from "./today-task-agenda.module.css";

const KIND_LABEL = { DUE: "Due", REMINDER: "Reminder", FOLLOW_UP: "Follow-up" } as const;

function entryTime(entry: TaskCalendarEntry) {
  if (!entry.timestamp) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(entry.timestamp));
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
  const entries = taskCalendarEntriesForToday(tasks, workspaceId);
  const visibleEntries = entries.slice(0, 6);

  return <div className={styles.agenda} aria-label="Today's task schedule">
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Today&apos;s schedule</p>
        <h3>Due dates, reminders &amp; follow-ups</h3>
      </div>
      <b aria-label={`${entries.length} scheduled task calendar entries today`}>{entries.length}</b>
    </div>
    {visibleEntries.length ? <div className={styles.list}>
      {visibleEntries.map((entry) => {
        const Icon = entry.kind === "DUE" ? ListTodo : entry.kind === "REMINDER" ? Bell : Clock3;
        const workspaceLabel = entry.task.primaryWorkspaceId === "indelitech" && workspaceId === "personal" ? " · Indelitech" : "";
        return <button
          type="button"
          key={entry.id}
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
    </div> : <p className="inline-empty">No due dates, reminders, or follow-ups scheduled for today.</p>}
    {entries.length > visibleEntries.length && <small className={styles.more}>+{entries.length - visibleEntries.length} more scheduled {entries.length - visibleEntries.length === 1 ? "entry" : "entries"} in Calendar.</small>}
  </div>;
}
