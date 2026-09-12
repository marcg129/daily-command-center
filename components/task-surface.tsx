"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bell, CalendarDays, Check, ListTodo, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  createTaskItem,
  recurringTaskRequiresDue,
  sortTaskAttention,
  taskBaseType,
  taskHorizon,
  taskIsActive,
  taskIsOverdue,
  taskAttentionLabel,
  VISIBLE_HORIZON_GROUPS,
} from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";
import { isoToProductWallClock, productWallClockToIso, reminderPresetIso } from "@/lib/product-time";

const GROUP_LABELS = {
  OVERDUE: "Overdue", TODAY: "Today", NEXT_7_DAYS: "Next 7 days",
  DAYS_8_14: "8–14 days", DAYS_15_30: "15–30 days", DAYS_31_45: "31–45 days",
} as const;

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
  const dueRequired = recurringTaskRequiresDue(recurrence);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (dueRequired && !due)) return;
    onAdd(createTaskItem({ title, due, priority, description, recurrence }, workspaceId));
    setTitle(""); setDue(""); setPriority("MEDIUM"); setDescription(""); setRecurrence("One-time"); setMore(false);
  };
  return <form className="quick-task-add reveal" onSubmit={submit}>
    <div className="quick-task-main">
      <label><span>Quick add to {workspaceId === "personal" ? "Personal" : "Indelitech"}</span><input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to get done?" /></label>
      <label><span>Due {dueRequired ? "(required for repeats)" : "(optional)"}</span><input aria-label="Due date" type="date" value={due} required={dueRequired} aria-describedby={dueRequired && !due ? "recurring-due-help" : undefined} onChange={(event) => setDue(event.target.value)} /></label>
      <label><span>Priority</span><select className={`priority-select priority-${priority.toLowerCase()}`} aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as "LOW" | "MEDIUM" | "HIGH")}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
      <button className="button button-primary"><ListTodo size={15} /> Add task</button>
    </div>
    <button type="button" className="text-button" onClick={() => setMore((value) => !value)}>{more ? "Fewer options" : "More options"}</button>
    {more && <div className="quick-task-more"><label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" /></label><label><span>Repeats</span><select value={recurrence} onChange={(event) => setRecurrence(event.target.value)}><option>One-time</option><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label></div>}
    {dueRequired && !due && <small id="recurring-due-help" role="alert">Choose a due date for a recurring task.</small>}
  </form>;
}

export function TaskAttentionPanel({ tasks, workspaceId, onOpen }: { tasks: TaskItem[]; workspaceId: ProductWorkspaceId; onOpen: () => void }) {
  const attention = sortTaskAttention(tasks).slice(0, 5);
  return <section className="panel task-attention-panel"><div className="panel-header"><div><p className="eyebrow">Task attention</p><h2>Highest priority</h2></div><b>{tasks.filter(taskIsActive).length}</b></div>
    {attention.length ? <div className="attention-list">{attention.map((task) => <button key={task.id} onClick={onOpen}><span><b>{task.title}</b><small className="attention-meta"><span>{taskAttentionLabel(task)}</span><PriorityBadge priority={task.priority} /></small></span><WorkspaceBadge task={task} viewing={workspaceId} /></button>)}</div> : <p className="inline-empty">No active tasks.</p>}
    <button className="text-button" onClick={onOpen}>Open task list</button>
  </section>;
}

export function TaskHorizon({ tasks, onOpen }: { tasks: TaskItem[]; onOpen: () => void }) {
  const horizon = taskHorizon(tasks);
  const populated = VISIBLE_HORIZON_GROUPS.filter((group) => horizon.get(group)!.length);
  return <section className="panel task-horizon"><div className="panel-header"><div><p className="eyebrow">45-day horizon</p><h2>What’s ahead</h2></div><CalendarDays size={20} /></div>
    {populated.length ? <div className="horizon-groups">{populated.map((group) => <button key={group} onClick={onOpen}><span>{GROUP_LABELS[group as keyof typeof GROUP_LABELS]}</span><b>{horizon.get(group)!.length}</b><small>{horizon.get(group)!.slice(0, 2).map((task) => task.title).join(" · ")}</small></button>)}</div> : <p className="inline-empty">Nothing due in the next 45 days.</p>}
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
  return <div ref={rowRef} tabIndex={-1} className={`task-row ${overdue ? "is-overdue" : ""} ${focused ? "is-calendar-focus" : ""}`} data-priority={task.priority.toLowerCase()}>
    <button className="round-check" aria-label={`Complete ${task.title}`} onClick={onComplete}><Check size={14} /></button>
    <div className="task-copy"><div><b>{task.title}</b><WorkspaceBadge task={task} viewing={workspaceId} /></div>{task.description !== "No additional details." && <p>{task.description}</p>}<small className="task-meta"><span>{overdue ? "Overdue · " : ""}{task.due || "No due date"}</span><PriorityBadge priority={task.priority} /><span>· {status}{task.remindAt ? ` · Reminder ${new Date(task.remindAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}{status === "WAITING" ? ` · Waiting for ${task.person} · Follow up ${new Date(task.followUpAt!).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}</span></small></div>
    <span className="repeat-text"><RefreshCw size={13} />{task.recurrence}</span>
    <details ref={actionsRef} className="task-actions"><summary className="more-button" aria-label={`Actions for ${task.title}`}><MoreHorizontal size={15} /></summary><div className="task-action-panel">
      <strong>Task actions</strong>
      {status === "WAITING" ? <button onClick={() => onChange({ status: "OPEN", type: taskBaseType(task), followUpAt: undefined })}>Resume</button> : <fieldset><legend>Mark waiting</legend><input aria-label="Waiting for person" placeholder="Waiting for" value={person} onChange={(event) => setPerson(event.target.value)} /><input aria-label="Follow-up date and time" type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /><button disabled={!person.trim() || !followUp} onClick={() => { const iso = convert(followUp); if (iso) onChange({ status: "WAITING", type: "WAITING", done: false, person: person.trim(), followUpAt: iso }); }}>Mark waiting</button></fieldset>}
      <fieldset><legend><Bell size={12} /> Reminder timing</legend><input aria-label="Reminder date and time" type="datetime-local" value={reminder} onChange={(event) => setReminder(event.target.value)} /><button disabled={!reminder} onClick={() => { const iso = convert(reminder); if (iso) onChange({ remindAt: iso }); }}>Set / change reminder</button><div className="task-presets"><button onClick={() => setPreset("LATER_TODAY")}>Later today</button><button onClick={() => setPreset("TOMORROW_MORNING")}>Tomorrow morning</button><button onClick={() => setPreset("NEXT_BUSINESS_DAY")}>Next business day</button></div></fieldset>
      <fieldset><legend>Edit details</legend><input aria-label="Edit task title" value={title} onChange={(event) => setTitle(event.target.value)} /><textarea aria-label="Edit task description" value={description} onChange={(event) => setDescription(event.target.value)} /><label>Due date<input aria-label="Change due date" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label><button onClick={() => onChange({ title: title.trim() || task.title, description, due })}>Save details</button></fieldset>
      {error && <small role="alert">{error}</small>}
      <button onClick={() => onChange({ status: "CANCELLED", done: false })}>Cancel task</button>
      <hr /><button className="danger-action" onClick={onDelete}><Trash2 size={13} /> Delete permanently</button>
    </div></details>
  </div>;
}
