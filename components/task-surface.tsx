"use client";

import { useState, type FormEvent } from "react";
import { CalendarDays, Check, ListTodo, RefreshCw, Trash2 } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  createTaskItem,
  recurringTaskRequiresDue,
  sortTaskAttention,
  taskHorizon,
  taskIsOverdue,
  VISIBLE_HORIZON_GROUPS,
} from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";

const GROUP_LABELS = {
  OVERDUE: "Overdue", TODAY: "Today", NEXT_7_DAYS: "Next 7 days",
  DAYS_8_14: "8–14 days", DAYS_15_30: "15–30 days", DAYS_31_45: "31–45 days",
} as const;

function WorkspaceBadge({ task, viewing }: { task: TaskItem; viewing: ProductWorkspaceId }) {
  return task.primaryWorkspaceId === "indelitech" && viewing === "personal"
    ? <span className="workspace-task-badge">Indelitech</span> : null;
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
      <label><span>Priority</span><select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as "LOW" | "MEDIUM" | "HIGH")}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
      <button className="button button-primary"><ListTodo size={15} /> Add task</button>
    </div>
    <button type="button" className="text-button" onClick={() => setMore((value) => !value)}>{more ? "Fewer options" : "More options"}</button>
    {more && <div className="quick-task-more"><label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" /></label><label><span>Repeats</span><select value={recurrence} onChange={(event) => setRecurrence(event.target.value)}><option>One-time</option><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label></div>}
    {dueRequired && !due && <small id="recurring-due-help" role="alert">Choose a due date for a recurring task.</small>}
  </form>;
}

export function TaskAttentionPanel({ tasks, workspaceId, onOpen }: { tasks: TaskItem[]; workspaceId: ProductWorkspaceId; onOpen: () => void }) {
  const attention = sortTaskAttention(tasks).slice(0, 5);
  return <section className="panel task-attention-panel"><div className="panel-header"><div><p className="eyebrow">Task attention</p><h2>Highest priority</h2></div><b>{tasks.filter((task) => !task.done).length}</b></div>
    {attention.length ? <div className="attention-list">{attention.map((task) => <button key={task.id} onClick={onOpen}><span><b>{task.title}</b><small>{taskIsOverdue(task) ? "Overdue" : task.due || "No due date"} · {task.priority}</small></span><WorkspaceBadge task={task} viewing={workspaceId} /></button>)}</div> : <p className="inline-empty">No open tasks.</p>}
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

export function TaskRow({ task, workspaceId, onComplete, onDelete }: { task: TaskItem; workspaceId: ProductWorkspaceId; onComplete: () => void; onDelete: () => void }) {
  const overdue = taskIsOverdue(task);
  return <div className={`task-row ${overdue ? "is-overdue" : ""}`}>
    <button className="round-check" aria-label={`Complete ${task.title}`} onClick={onComplete}><Check size={14} /></button>
    <div className="task-copy"><div><b>{task.title}</b><WorkspaceBadge task={task} viewing={workspaceId} /></div>{task.description !== "No additional details." && <p>{task.description}</p>}<small>{overdue ? "Overdue · " : ""}{task.due || "No due date"} · {task.priority}</small></div>
    <span className="repeat-text"><RefreshCw size={13} />{task.recurrence}</span>
    <button className="more-button" aria-label={`Delete ${task.title}`} onClick={onDelete}><Trash2 size={15} /></button>
  </div>;
}
