"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bell, CalendarDays, Check, ListTodo, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  createTaskItem,
  recurringTaskRequiresDue,
  tasksRequiringAttentionToday,
  taskBaseType,
  taskHorizon,
  taskIsOverdue,
  taskAttentionLabel,
  VISIBLE_HORIZON_GROUPS,
} from "@/lib/tasks";
import { taskOverdueBadgeLabel } from "@/lib/task-overdue-ui";
import {
  taskPlanningDueBucket,
  taskPlanningDurationBucket,
  type TaskPlanningDueFilter,
  type TaskPlanningDurationFilter,
  type TaskPlanningPriorityFilter,
} from "@/lib/task-planning";
import type { TaskItem } from "@/lib/types";
import { isoToProductWallClock, productWallClockToIso, reminderPresetIso } from "@/lib/product-time";
import { TodayTaskAgenda } from "@/components/today-task-agenda";

const GROUP_LABELS = {
  OVERDUE: "Overdue", TODAY: "Today", NEXT_7_DAYS: "Next 7 days",
  DAYS_8_14: "8–14 days", DAYS_15_30: "15–30 days", DAYS_31_45: "31–45 days",
} as const;
const TASK_DURATIONS = ["5m", "15m", "30m", "1h", "2h+", "Project"] as const;
type TaskDuration = NonNullable<TaskItem["estimatedDuration"]>;

function planningFilterValue(value: string) {
  return value.toLowerCase().replaceAll("_", "-");
}

function DurationSelect({ value, onChange, label }: { value: TaskDuration | ""; onChange: (value: TaskDuration | "") => void; label: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as TaskDuration | "")}>
    <option value="">Not estimated</option>
    {TASK_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration}</option>)}
  </select>;
}

function WorkspaceBadge({ task, viewing }: { task: TaskItem; viewing: ProductWorkspaceId }) {
  return task.primaryWorkspaceId === "indelitech" && viewing === "personal"
    ? <span className="workspace-task-badge">Indelitech</span> : null;
}

function PriorityBadge({ priority }: { priority: TaskItem["priority"] }) {
  const symbol = priority === "HIGH" ? "▲" : priority === "MEDIUM" ? "◆" : "—";
  return <span className={`priority-badge priority-${priority.toLowerCase()}`} aria-label={`${priority.toLowerCase()} priority`}>
    <span aria-hidden="true">{symbol}</span>{priority}
  </span>;
}

export function QuickTaskAdd({ workspaceId, onAdd }: { workspaceId: ProductWorkspaceId; onAdd: (task: TaskItem) => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState("");
  const [recurrence, setRecurrence] = useState("One-time");
  const [duration, setDuration] = useState<TaskDuration | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPlanningPriorityFilter>("ALL");
  const [dueFilter, setDueFilter] = useState<TaskPlanningDueFilter>("ALL");
  const [durationFilter, setDurationFilter] = useState<TaskPlanningDurationFilter>("ALL");
  const dueRequired = recurringTaskRequiresDue(recurrence);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (dueRequired && !due)) return;
    onAdd(createTaskItem({ title, due, priority, description, recurrence, estimatedDuration: duration || undefined }, workspaceId));
    setTitle(""); setDue(""); setPriority("MEDIUM"); setDescription(""); setRecurrence("One-time"); setDuration(""); setMore(false);
  };
  return <form
    className="quick-task-add reveal"
    onSubmit={submit}
    data-filter-priority={planningFilterValue(priorityFilter)}
    data-filter-due={planningFilterValue(dueFilter)}
    data-filter-duration={planningFilterValue(durationFilter)}
  >
    <div className="quick-task-main">
      <label><span>Quick add to {workspaceId === "personal" ? "Personal" : "Indelitech"}</span><input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to get done?" /></label>
      <label><span>Due {dueRequired ? "(required for repeats)" : "(optional)"}</span><input aria-label="Due date" type="date" value={due} required={dueRequired} aria-describedby={dueRequired && !due ? "recurring-due-help" : undefined} onChange={(event) => setDue(event.target.value)} /></label>
      <label><span>Priority</span><select className={`priority-select priority-${priority.toLowerCase()}`} aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as "LOW" | "MEDIUM" | "HIGH")}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
      <button className="button button-primary"><ListTodo size={15} /> Add task</button>
    </div>
    <button type="button" className="text-button" onClick={() => setMore((value) => !value)}>{more ? "Fewer options" : "More options"}</button>
    {more && <div className="quick-task-more"><label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" /></label><label><span>Repeats</span><select value={recurrence} onChange={(event) => setRecurrence(event.target.value)}><option>One-time</option><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label><span>Estimated time</span><DurationSelect label="Estimated duration" value={duration} onChange={setDuration} /></label></div>}
    {dueRequired && !due && <small id="recurring-due-help" role="alert">Choose a due date for a recurring task.</small>}
    <div className="task-planning-filters" aria-label="Task planning filters">
      <div className="task-planning-filter-heading"><strong>Plan this task list</strong><small>Filters only change the open rows shown below.</small></div>
      <div className="task-planning-filter-grid">
        <label><span>Priority</span><select aria-label="Filter tasks by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TaskPlanningPriorityFilter)}><option value="ALL">All priorities</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
        <label><span>Due</span><select aria-label="Filter tasks by due window" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as TaskPlanningDueFilter)}><option value="ALL">Any due window</option><option value="OVERDUE">Overdue</option><option value="TODAY">Today</option><option value="NEXT_7_DAYS">Next 7 days</option><option value="LATER">Later</option><option value="UNSCHEDULED">Unscheduled</option></select></label>
        <label><span>Estimated time</span><select aria-label="Filter tasks by estimated duration" value={durationFilter} onChange={(event) => setDurationFilter(event.target.value as TaskPlanningDurationFilter)}><option value="ALL">Any estimate</option><option value="QUICK">30 min or less</option><option value="ONE_HOUR">1 hour</option><option value="LONG">2h+ / Project</option><option value="UNESTIMATED">Not estimated</option></select></label>
      </div>
    </div>
  </form>;
}

export function TaskAttentionPanel({ tasks, workspaceId, onOpenTask, onOpenAll }: { tasks: TaskItem[]; workspaceId: ProductWorkspaceId; onOpenTask: (taskId: TaskItem["id"]) => void; onOpenAll: () => void }) {
  const attention = tasksRequiringAttentionToday(tasks);
  const overdueCount = attention.filter((task) => taskIsOverdue(task)).length;
  const visibleAttention = attention.slice(0, 5);
  return <section className="panel task-attention-panel"><div className="panel-header"><div><p className="eyebrow">Task attention</p><h2>Needs action today</h2></div><div className="task-attention-totals"><b className="task-attention-total" aria-label={`${attention.length} tasks need action today`}>{attention.length}</b>{overdueCount > 0 && <span className="overdue-count-badge" aria-label={`${overdueCount} ${overdueCount === 1 ? "task is" : "tasks are"} overdue`}>{overdueCount} overdue</span>}</div></div>
    {visibleAttention.length ? <div className="attention-list">{visibleAttention.map((task) => {
      const overdue = taskIsOverdue(task);
      return <button key={task.id} className={overdue ? "is-overdue" : undefined} onClick={() => onOpenTask(task.id)}><span><b>{task.title}</b><small className="attention-meta">{overdue ? <span className="overdue-badge">{taskOverdueBadgeLabel(task)}</span> : <span>{taskAttentionLabel(task)}</span>}<PriorityBadge priority={task.priority} /></small></span><WorkspaceBadge task={task} viewing={workspaceId} /></button>;
    })}</div> : <p className="inline-empty">Nothing requires action today.</p>}
    <TodayTaskAgenda tasks={tasks} workspaceId={workspaceId} onOpenTask={onOpenTask} />
    <button className="text-button" onClick={onOpenAll}>Open task list</button>
  </section>;
}

export function TaskHorizon({ tasks, onOpen }: { tasks: TaskItem[]; onOpen: () => void }) {
  const horizon = taskHorizon(tasks);
  const populated = VISIBLE_HORIZON_GROUPS.filter((group) => horizon.get(group)!.length);
  return <section className="panel task-horizon"><div className="panel-header"><div><p className="eyebrow">45-day horizon</p><h2>What’s ahead</h2></div><CalendarDays size={20} /></div>
    {populated.length ? <div className="horizon-groups">{populated.map((group) => <button key={group} className={group === "OVERDUE" ? "is-overdue" : undefined} data-horizon-group={group.toLowerCase().replaceAll("_", "-")} onClick={onOpen}><span>{GROUP_LABELS[group as keyof typeof GROUP_LABELS]}</span><b>{horizon.get(group)!.length}</b><small>{horizon.get(group)!.slice(0, 2).map((task) => task.title).join(" · ")}</small></button>)}</div> : <p className="inline-empty">Nothing due in the next 45 days.</p>}
  </section>;
}

export function TaskRow({ task, workspaceId, onComplete, onChange, onDelete, focused = false }: { task: TaskItem; workspaceId: ProductWorkspaceId; onComplete: () => void; onChange: (patch: Partial<TaskItem>) => void; onDelete: () => void; focused?: boolean }) {
  const overdue = taskIsOverdue(task);
  const [error, setError] = useState("");
  const status = task.status ?? (task.done ? "DONE" : "OPEN");
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [due, setDue] = useState(task.due);
  const [reminder, setReminder] = useState(task.remindAt ? isoToProductWallClock(task.remindAt) : "");
  const [person, setPerson] = useState(task.person || "");
  const [followUp, setFollowUp] = useState(task.followUpAt ? isoToProductWallClock(task.followUpAt) : "");
  const [duration, setDuration] = useState<TaskDuration | "">(task.estimatedDuration || "");
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const actions = actionsRef.current;
      if (!actions?.open) return;
      if (event.target instanceof Node && !actions.contains(event.target)) actions.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const actions = actionsRef.current;
      if (event.key !== "Escape" || !actions?.open) return;
      actions.open = false;
      actions.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const convert = (value: string) => { try { setError(""); return productWallClockToIso(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Invalid time"); } };
  const setPreset = (preset: "LATER_TODAY" | "TOMORROW_MORNING" | "NEXT_BUSINESS_DAY") => {
    const iso = reminderPresetIso(preset); setReminder(isoToProductWallClock(iso)); onChange({ remindAt: iso });
  };
  return <div
    ref={rowRef}
    tabIndex={-1}
    className={`task-row ${overdue ? "is-overdue" : ""} ${focused ? "is-calendar-focus" : ""}`}
    data-priority={task.priority.toLowerCase()}
    data-planning-due={planningFilterValue(taskPlanningDueBucket(task))}
    data-planning-duration={planningFilterValue(taskPlanningDurationBucket(task))}
  >
    <button className="round-check" aria-label={`Complete ${task.title}`} onClick={onComplete}><Check size={14} /></button>
    <div className="task-copy"><div><b>{task.title}</b><WorkspaceBadge task={task} viewing={workspaceId} /></div>{task.description !== "No additional details." && <p>{task.description}</p>}<small className="task-meta">{overdue ? <><span className="overdue-badge">{taskOverdueBadgeLabel(task)}</span><span>Due {task.due}</span></> : <span>{task.due || "No due date"}</span>}<PriorityBadge priority={task.priority} /><span>· {status}{task.estimatedDuration ? ` · Estimated ${task.estimatedDuration}` : ""}{task.remindAt ? ` · Reminder ${new Date(task.remindAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}{status === "WAITING" ? ` · Waiting for ${task.person} · Follow up ${new Date(task.followUpAt!).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}</span></small></div>
    <span className="repeat-text"><RefreshCw size={13} />{task.recurrence}</span>
    <details ref={actionsRef} className="task-actions"><summary className="more-button" aria-label={`Actions for ${task.title}`}><MoreHorizontal size={15} /></summary><div className="task-action-panel">
      <strong>Task actions</strong>
      {status === "WAITING" ? <button onClick={() => onChange({ status: "OPEN", type: taskBaseType(task), followUpAt: undefined })}>Resume</button> : <fieldset><legend>Mark waiting</legend><input aria-label="Waiting for person" placeholder="Waiting for" value={person} onChange={(event) => setPerson(event.target.value)} /><input aria-label="Follow-up date and time" type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /><button disabled={!person.trim() || !followUp} onClick={() => { const iso = convert(followUp); if (iso) onChange({ status: "WAITING", type: "WAITING", done: false, person: person.trim(), followUpAt: iso }); }}>Mark waiting</button></fieldset>}
      <fieldset><legend><Bell size={12} /> Reminder timing</legend><input aria-label="Reminder date and time" type="datetime-local" value={reminder} onChange={(event) => setReminder(event.target.value)} /><button disabled={!reminder} onClick={() => { const iso = convert(reminder); if (iso) onChange({ remindAt: iso }); }}>Set / change reminder</button><div className="task-presets"><button onClick={() => setPreset("LATER_TODAY")}>Later today</button><button onClick={() => setPreset("TOMORROW_MORNING")}>Tomorrow morning</button><button onClick={() => setPreset("NEXT_BUSINESS_DAY")}>Next business day</button></div></fieldset>
      <fieldset><legend>Edit details</legend><input aria-label="Edit task title" value={title} onChange={(event) => setTitle(event.target.value)} /><textarea aria-label="Edit task description" value={description} onChange={(event) => setDescription(event.target.value)} /><label>Due date<input aria-label="Change due date" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label><label>Estimated time<DurationSelect label="Change estimated duration" value={duration} onChange={setDuration} /></label><button onClick={() => onChange({ title: title.trim() || task.title, description, due, estimatedDuration: duration || undefined })}>Save details</button></fieldset>
      {error && <small role="alert">{error}</small>}
      <button onClick={() => onChange({ status: "CANCELLED", done: false })}>Cancel task</button>
      <hr /><button className="danger-action" onClick={onDelete}><Trash2 size={13} /> Delete permanently</button>
    </div></details>
  </div>;
}
