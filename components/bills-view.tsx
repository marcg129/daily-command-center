"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SkipForward,
  WalletCards,
  X,
} from "lucide-react";
import {
  browserRuntimeMode,
  fetchHostedWithSessionRefresh,
  loadHostedApplicationSession,
  selectAuthorizedWorkspace,
} from "@/lib/runtime/browser-runtime";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { BillDefinitionCore, BillRecurrenceDayMode, BillRecurrenceUnit } from "@/lib/runtime/bills";
import {
  validateHostedBillDefinition,
  type BillOccurrenceResolutionAction,
  type HostedBill,
  type HostedBillOccurrence,
} from "@/lib/runtime/hosted-bills";
import {
  addDateOnlyDays,
  billAmountPresentation,
  billOccurrenceDisplayState,
  billOccurrenceShapeChanged,
  daysBetweenDateOnly,
  dollarsInputToMinor,
  formatMinorCurrency,
  minorToDollarsInput,
  recurrenceLabel,
  summarizeOpenOccurrences,
} from "@/lib/bill-ui";
import { WORKSPACES, WORKSPACE_OPTIONS } from "@/lib/workspace-ui";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import styles from "./bills-view.module.css";

type BillsSummary = Readonly<{
  bills: HostedBill[];
  occurrences: HostedBillOccurrence[];
}>;

type BillDraft = {
  name: string;
  payee: string;
  category: string;
  amountMode: "FIXED" | "VARIABLE";
  amount: string;
  autopay: boolean;
  paymentUrl: string;
  notes: string;
  scheduleStartDate: string;
  recurrenceUnit: BillRecurrenceUnit;
  recurrenceInterval: string;
  recurrenceDayMode: BillRecurrenceDayMode;
  reminderDaysBefore: string;
};

type ResolutionDraft = {
  occurrence: HostedBillOccurrence;
  action: BillOccurrenceResolutionAction;
  paidOn: string;
  paidAmount: string;
  note: string;
};

function productToday(now = new Date()): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: year === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function blankDraft(today: string): BillDraft {
  return {
    name: "",
    payee: "",
    category: "",
    amountMode: "FIXED",
    amount: "",
    autopay: false,
    paymentUrl: "",
    notes: "",
    scheduleStartDate: today,
    recurrenceUnit: "NONE",
    recurrenceInterval: "1",
    recurrenceDayMode: "ANCHOR_DATE",
    reminderDaysBefore: "3",
  };
}

function draftFromBill(bill: HostedBill): BillDraft {
  return {
    name: bill.name,
    payee: bill.payee ?? "",
    category: bill.category ?? "",
    amountMode: bill.amountMode,
    amount: minorToDollarsInput(bill.defaultAmountMinor),
    autopay: bill.autopay,
    paymentUrl: bill.paymentUrl ?? "",
    notes: bill.notes ?? "",
    scheduleStartDate: bill.scheduleStartDate,
    recurrenceUnit: bill.recurrenceUnit,
    recurrenceInterval: String(bill.recurrenceInterval),
    recurrenceDayMode: bill.recurrenceDayMode ?? "ANCHOR_DATE",
    reminderDaysBefore: bill.reminderDaysBefore === null ? "" : String(bill.reminderDaysBefore),
  };
}

function coreFromBill(bill: HostedBill): BillDefinitionCore {
  return {
    name: bill.name,
    payee: bill.payee,
    category: bill.category,
    amountMode: bill.amountMode,
    defaultAmountMinor: bill.defaultAmountMinor,
    currency: bill.currency,
    autopay: bill.autopay,
    paymentUrl: bill.paymentUrl,
    notes: bill.notes,
    scheduleStartDate: bill.scheduleStartDate,
    recurrenceUnit: bill.recurrenceUnit,
    recurrenceInterval: bill.recurrenceInterval,
    recurrenceDayMode: bill.recurrenceDayMode,
    reminderDaysBefore: bill.reminderDaysBefore,
    status: bill.status,
  };
}

function coreFromDraft(draft: BillDraft, status: HostedBill["status"]): BillDefinitionCore {
  const amount = dollarsInputToMinor(draft.amount);
  if (draft.amountMode === "FIXED" && amount === null) throw new Error("Enter the normal bill amount.");
  const recurrenceInterval = draft.recurrenceUnit === "NONE" ? 1 : Number(draft.recurrenceInterval);
  const reminderDaysBefore = draft.reminderDaysBefore.trim() === "" ? null : Number(draft.reminderDaysBefore);
  const core: BillDefinitionCore = {
    name: draft.name.trim(),
    payee: draft.payee.trim() || null,
    category: draft.category.trim() || null,
    amountMode: draft.amountMode,
    defaultAmountMinor: amount,
    currency: "USD",
    autopay: draft.autopay,
    paymentUrl: draft.paymentUrl.trim() || null,
    notes: draft.notes.trim() || null,
    scheduleStartDate: draft.scheduleStartDate,
    recurrenceUnit: draft.recurrenceUnit,
    recurrenceInterval,
    recurrenceDayMode: draft.recurrenceUnit === "MONTH" || draft.recurrenceUnit === "YEAR"
      ? draft.recurrenceDayMode
      : null,
    reminderDaysBefore,
    status,
  };
  validateHostedBillDefinition(core);
  return core;
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function dueStateLabel(occurrence: HostedBillOccurrence, today: string): string {
  const state = billOccurrenceDisplayState(occurrence, today);
  if (state === "OVERDUE") {
    const days = Math.max(1, daysBetweenDateOnly(occurrence.dueDate, today));
    return `OVERDUE · ${days} DAY${days === 1 ? "" : "S"}`;
  }
  if (state === "TODAY") return "DUE TODAY";
  return `DUE ${formatDateOnly(occurrence.dueDate).toUpperCase()}`;
}

function BillAmount({ bill, occurrence }: { bill: HostedBill; occurrence?: HostedBillOccurrence | null }) {
  const presentation = billAmountPresentation(bill, occurrence);
  return <span className={styles.amount}>
    <b>{presentation.label}</b>
    <small>{presentation.qualifier}</small>
  </span>;
}

export function BillsView({ initialWorkspaceId }: { initialWorkspaceId: ProductWorkspaceId }) {
  const today = productToday();
  const [workspaceId, setWorkspaceId] = useState<ProductWorkspaceId>(initialWorkspaceId);
  const [authorizedWorkspaceIds, setAuthorizedWorkspaceIds] = useState<ProductWorkspaceId[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");
  const [summary, setSummary] = useState<BillsSummary>({ bills: [], occurrences: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<"upcoming" | "all">("upcoming");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingBill, setEditingBill] = useState<HostedBill | null | undefined>(undefined);
  const [draft, setDraft] = useState<BillDraft>(() => blankDraft(today));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolution, setResolution] = useState<ResolutionDraft | null>(null);
  const [resolutionError, setResolutionError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [statusPending, setStatusPending] = useState("");

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (browserRuntimeMode(window.location.hostname) !== "hosted") {
        if (!cancelled) {
          setRuntimeError("Bills are available on the hosted Daily Command Center. Local mode does not expose financial records.");
          setInitializing(false);
        }
        return;
      }
      try {
        const session = await loadHostedApplicationSession(fetch);
        if (cancelled) return;
        const selected = selectAuthorizedWorkspace(session.workspaces, initialWorkspaceId);
        setAuthorizedWorkspaceIds(session.workspaces.map(({ workspaceId: id }) => id));
        setWorkspaceId(selected);
      } catch (caught) {
        if (!cancelled) setRuntimeError(caught instanceof Error ? caught.message : "Your Command Center identity could not be resolved.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [initialWorkspaceId]);

  useEffect(() => {
    if (initializing || runtimeError || !authorizedWorkspaceIds.includes(workspaceId)) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchHostedWithSessionRefresh(fetch, `/api/hosted/bills?workspaceId=${encodeURIComponent(workspaceId)}&includeArchived=${includeArchived ? "true" : "false"}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(responseError(payload, "Bills could not be loaded."));
        if (!controller.signal.aborted) setSummary(payload as BillsSummary);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Bills could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [authorizedWorkspaceIds, includeArchived, initializing, nonce, runtimeError, workspaceId]);

  const billById = useMemo(() => new Map(summary.bills.map((bill) => [bill.billId, bill] as const)), [summary.bills]);
  const openOccurrences = useMemo(() => [...summary.occurrences]
    .filter((occurrence) => occurrence.status === "OPEN" && billById.has(occurrence.billId))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.occurrenceId.localeCompare(right.occurrenceId)), [billById, summary.occurrences]);
  const sevenDaySummary = useMemo(() => summarizeOpenOccurrences(openOccurrences, summary.bills, today, addDateOnlyDays(today, 6)), [openOccurrences, summary.bills, today]);
  const overdueCount = useMemo(() => openOccurrences.filter((occurrence) => billOccurrenceDisplayState(occurrence, today) === "OVERDUE").length, [openOccurrences, today]);
  const activeBillCount = summary.bills.filter((bill) => bill.status === "ACTIVE").length;
  const autopayCount = summary.bills.filter((bill) => bill.status === "ACTIVE" && bill.autopay).length;
  const authorizedOptions = WORKSPACE_OPTIONS.filter(({ id }) => authorizedWorkspaceIds.includes(id));

  const selectWorkspace = (next: ProductWorkspaceId) => {
    if (!authorizedWorkspaceIds.includes(next)) return;
    setWorkspaceId(next);
    setView("upcoming");
    setEditingBill(undefined);
    setResolution(null);
    const url = new URL(window.location.href);
    url.searchParams.set("workspaceId", next);
    window.history.replaceState({}, "", url);
  };

  const openNewBill = () => {
    setDraft(blankDraft(today));
    setEffectiveDate(today);
    setFormError("");
    setEditingBill(null);
  };

  const openEditBill = (bill: HostedBill) => {
    setDraft(draftFromBill(bill));
    setEffectiveDate(today);
    setFormError("");
    setEditingBill(bill);
  };

  let shapeChanged = false;
  if (editingBill) {
    try {
      shapeChanged = billOccurrenceShapeChanged(editingBill, coreFromDraft(draft, editingBill.status));
    } catch {
      shapeChanged = false;
    }
  }

  const saveBill = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const core = coreFromDraft(draft, editingBill?.status ?? "ACTIVE");
      const changed = editingBill ? billOccurrenceShapeChanged(editingBill, core) : false;
      if (changed && !effectiveDate) throw new Error("Choose the date when schedule or amount changes should take effect.");
      const response = await fetchHostedWithSessionRefresh(fetch, `/api/hosted/bills?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: editingBill ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingBill
          ? { billId: editingBill.billId, bill: core, ...(changed ? { effectiveDate } : {}) }
          : { bill: core }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Bill could not be saved."));
      setEditingBill(undefined);
      setNonce((value) => value + 1);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Bill could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const changeBillStatus = async (bill: HostedBill, status: HostedBill["status"]) => {
    if (status === "ARCHIVED" && !window.confirm(`Archive ${bill.name}? Its history will be preserved.`)) return;
    setStatusPending(bill.billId);
    setError("");
    try {
      const response = await fetchHostedWithSessionRefresh(fetch, `/api/hosted/bills?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: bill.billId, bill: { ...coreFromBill(bill), status } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Bill status could not be changed."));
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bill status could not be changed.");
    } finally {
      setStatusPending("");
    }
  };

  const openResolution = (occurrence: HostedBillOccurrence, action: BillOccurrenceResolutionAction) => {
    setResolution({
      occurrence,
      action,
      paidOn: today,
      paidAmount: occurrence.expectedAmountMinor === null ? "" : minorToDollarsInput(occurrence.expectedAmountMinor),
      note: "",
    });
    setResolutionError("");
  };

  const saveResolution = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolution) return;
    setResolving(true);
    setResolutionError("");
    try {
      const paidAmountMinor = resolution.action === "PAID" ? dollarsInputToMinor(resolution.paidAmount) : null;
      const response = await fetchHostedWithSessionRefresh(fetch, `/api/hosted/bills/occurrences?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurrenceId: resolution.occurrence.occurrenceId,
          action: resolution.action,
          ...(resolution.action === "PAID" ? { paidOn: resolution.paidOn, paidAmountMinor } : {}),
          resolutionNote: resolution.note.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Bill occurrence could not be updated."));
      setResolution(null);
      setNonce((value) => value + 1);
    } catch (caught) {
      setResolutionError(caught instanceof Error ? caught.message : "Bill occurrence could not be updated.");
    } finally {
      setResolving(false);
    }
  };

  if (initializing) {
    return <div className="app-shell" data-workspace={workspaceId}><main><div className="view"><section className={`panel ${styles.centerState}`}><RefreshCw className={styles.spin} size={28} /><h1>Opening Bills</h1><p>Resolving your workspace securely…</p></section></div></main></div>;
  }

  if (runtimeError) {
    return <div className="app-shell" data-workspace={workspaceId}><main><div className="view"><section className={`panel ${styles.centerState}`}><CircleAlert size={30} /><h1>Bills are unavailable here</h1><p>{runtimeError}</p><Link className="button button-ghost" href="/"><ArrowLeft size={15} /> Back to dashboard</Link></section></div></main></div>;
  }

  return <div className="app-shell" data-workspace={workspaceId}>
    <header className="topbar">
      <Link className="brand-lockup" href="/" aria-label="Back to Daily Command Center">
        <span className="brand-mark"><Activity size={18} /></span>
        <span><b>DAILY COMMAND CENTER</b><small>BILLS & OBLIGATIONS</small></span>
      </Link>
      <WorkspaceSwitcher value={workspaceId} onChange={selectWorkspace} options={authorizedOptions} showBillsLink={false} />
      <span aria-hidden="true" />
      <Link className="button button-ghost" href="/"><ArrowLeft size={14} /> Dashboard</Link>
    </header>

    <main>
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{WORKSPACES[workspaceId].displayName} · Bills</p>
            <h1>Bills & obligations</h1>
            <p className="page-description">Track what is due, what is expected to cost, and what has actually been resolved without turning financial obligations into tasks.</p>
          </div>
          <button className="button button-primary" onClick={openNewBill}><Plus size={15} /> Add bill</button>
        </div>

        {error && <div className={styles.errorNotice} role="alert"><CircleAlert size={17} /><span>{error}</span><button type="button" onClick={() => setNonce((value) => value + 1)}>Retry</button></div>}

        <section className={styles.summaryGrid} aria-label="Bills summary">
          <article className={`panel ${styles.summaryCard}`}><small>Next 7 days</small><strong>{sevenDaySummary.count}</strong><span>{formatMinorCurrency(sevenDaySummary.knownTotalMinor)} known{sevenDaySummary.unknownCount ? ` + ${sevenDaySummary.unknownCount} unknown` : ""}</span>{sevenDaySummary.estimatedCount > 0 && <em>{sevenDaySummary.estimatedCount} estimated amount{sevenDaySummary.estimatedCount === 1 ? "" : "s"}</em>}</article>
          <article className={`panel ${styles.summaryCard} ${overdueCount ? styles.attentionCard : ""}`}><small>Overdue</small><strong>{overdueCount}</strong><span>{overdueCount ? "Needs attention" : "Nothing behind"}</span></article>
          <article className={`panel ${styles.summaryCard}`}><small>Active bills</small><strong>{activeBillCount}</strong><span>{summary.bills.length - activeBillCount} paused or archived</span></article>
          <article className={`panel ${styles.summaryCard}`}><small>AutoPay expected</small><strong>{autopayCount}</strong><span>AutoPay never means paid</span></article>
        </section>

        <div className={styles.toolbar}>
          <div className={styles.viewTabs} role="tablist" aria-label="Bills views">
            <button type="button" role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? styles.activeTab : ""} onClick={() => setView("upcoming")}><CalendarDays size={14} /> Upcoming</button>
            <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? styles.activeTab : ""} onClick={() => setView("all")}><WalletCards size={14} /> All bills</button>
          </div>
          <button className="button button-ghost" type="button" onClick={() => setNonce((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={14} /> Refresh</button>
        </div>

        {loading && summary.bills.length === 0 ? <section className={`panel ${styles.centerState}`}><RefreshCw className={styles.spin} size={24} /><h2>Loading bills</h2></section> : view === "upcoming" ? (
          <section className={`panel ${styles.listPanel}`}>
            <div className={styles.sectionHead}><div><p className="eyebrow">Open obligations</p><h2>Upcoming</h2></div><span>{openOccurrences.length} open</span></div>
            {openOccurrences.length === 0 ? <div className={styles.emptyState}><CheckCircle2 size={28} /><h3>No open bill occurrences</h3><p>Add a bill to start building your upcoming obligations.</p><button className="button button-primary" onClick={openNewBill}><Plus size={14} /> Add bill</button></div> : <div className={styles.occurrenceList}>
              {openOccurrences.map((occurrence) => {
                const bill = billById.get(occurrence.billId)!;
                const state = billOccurrenceDisplayState(occurrence, today);
                return <article key={occurrence.occurrenceId} className={`${styles.occurrenceRow} ${state === "OVERDUE" ? styles.overdue : state === "TODAY" ? styles.dueToday : ""}`}>
                  <div className={styles.dateBlock}><b>{formatDateOnly(occurrence.dueDate)}</b><span className={state === "OVERDUE" ? styles.overdueBadge : styles.dateBadge}>{dueStateLabel(occurrence, today)}</span></div>
                  <div className={styles.occurrenceCopy}><div className={styles.titleLine}><h3>{bill.name}</h3>{bill.autopay && <span className={styles.autopayBadge}>AutoPay</span>}{bill.amountMode === "VARIABLE" && <span className={styles.variableBadge}>Variable</span>}</div><p>{bill.payee || bill.category || recurrenceLabel(bill)}</p><small>{recurrenceLabel(bill)}{bill.category ? ` · ${bill.category}` : ""}</small></div>
                  <BillAmount bill={bill} occurrence={occurrence} />
                  <div className={styles.rowActions}>
                    {bill.paymentUrl && <a className={styles.actionLink} href={bill.paymentUrl} target="_blank" rel="noreferrer">Pay bill <ExternalLink size={13} /></a>}
                    <button className={styles.primaryAction} type="button" onClick={() => openResolution(occurrence, "PAID")}><Check size={13} /> Mark paid</button>
                    <button type="button" onClick={() => openResolution(occurrence, "SKIPPED")}><SkipForward size={13} /> Skip</button>
                    <button type="button" onClick={() => openResolution(occurrence, "CANCELLED")}><Ban size={13} /> Cancel</button>
                    <button type="button" onClick={() => openEditBill(bill)}><Pencil size={13} /> Edit bill</button>
                  </div>
                </article>;
              })}
            </div>}
          </section>
        ) : (
          <section className={`panel ${styles.listPanel}`}>
            <div className={styles.sectionHead}><div><p className="eyebrow">Definitions</p><h2>All bills</h2></div><label className={styles.archiveToggle}><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived</label></div>
            {summary.bills.length === 0 ? <div className={styles.emptyState}><WalletCards size={28} /><h3>No bills saved</h3><p>Create the first recurring or one-time obligation for this workspace.</p><button className="button button-primary" onClick={openNewBill}><Plus size={14} /> Add bill</button></div> : <div className={styles.billGrid}>
              {summary.bills.map((bill) => {
                const next = openOccurrences.find((occurrence) => occurrence.billId === bill.billId);
                return <article className={styles.billCard} key={bill.billId}>
                  <div className={styles.billCardHead}><div><div className={styles.titleLine}><h3>{bill.name}</h3>{bill.autopay && <span className={styles.autopayBadge}>AutoPay</span>}</div><p>{bill.payee || bill.category || "No payee"}</p></div><span className={`${styles.statusBadge} ${styles[`status${bill.status}`]}`}>{bill.status}</span></div>
                  <div className={styles.billCardFacts}><BillAmount bill={bill} /><span><b>{recurrenceLabel(bill)}</b><small>Starts {formatDateOnly(bill.scheduleStartDate)}</small></span><span><b>{next ? formatDateOnly(next.dueDate) : "No open date"}</b><small>Next occurrence</small></span></div>
                  {bill.notes && <p className={styles.billNotes}>{bill.notes}</p>}
                  <div className={styles.billCardActions}>
                    <button type="button" onClick={() => openEditBill(bill)}><Pencil size={13} /> Edit</button>
                    {bill.status === "PAUSED" ? <button type="button" disabled={statusPending === bill.billId} onClick={() => changeBillStatus(bill, "ACTIVE")}><Play size={13} /> Resume</button> : bill.status === "ACTIVE" ? <button type="button" disabled={statusPending === bill.billId} onClick={() => changeBillStatus(bill, "PAUSED")}><SkipForward size={13} /> Pause</button> : <button type="button" disabled={statusPending === bill.billId} onClick={() => changeBillStatus(bill, "ACTIVE")}><ArchiveRestore size={13} /> Restore</button>}
                    {bill.status !== "ARCHIVED" && <button type="button" disabled={statusPending === bill.billId} onClick={() => changeBillStatus(bill, "ARCHIVED")}><Archive size={13} /> Archive</button>}
                    {bill.paymentUrl && <a href={bill.paymentUrl} target="_blank" rel="noreferrer">Pay site <ExternalLink size={13} /></a>}
                  </div>
                </article>;
              })}
            </div>}
          </section>
        )}
      </div>
    </main>

    {editingBill !== undefined && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingBill(undefined); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="bill-form-title">
        <div className={styles.modalHead}><div><p className="eyebrow">{editingBill ? "Edit definition" : "New obligation"}</p><h2 id="bill-form-title">{editingBill ? editingBill.name : "Add bill"}</h2></div><button className={styles.closeButton} type="button" aria-label="Close bill form" disabled={saving} onClick={() => setEditingBill(undefined)}><X size={18} /></button></div>
        <form onSubmit={saveBill} className={styles.form}>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Name</span><input autoFocus required maxLength={200} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="Electric bill" /></label>
            <label><span>Payee</span><input maxLength={200} value={draft.payee} onChange={(event) => setDraft((value) => ({ ...value, payee: event.target.value }))} placeholder="FPL" /></label>
            <label><span>Category</span><input maxLength={100} value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))} placeholder="Utilities" /></label>
            <label><span>Amount type</span><select value={draft.amountMode} onChange={(event) => setDraft((value) => ({ ...value, amountMode: event.target.value as BillDraft["amountMode"] }))}><option value="FIXED">Fixed / expected exact</option><option value="VARIABLE">Variable / estimate</option></select></label>
            <label><span>{draft.amountMode === "FIXED" ? "Normal amount" : "Expected amount (optional)"}</span><div className={styles.moneyInput}><i>$</i><input inputMode="decimal" required={draft.amountMode === "FIXED"} value={draft.amount} onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} placeholder="0.00" /></div></label>
            <label><span>First / anchor due date</span><input required type="date" value={draft.scheduleStartDate} onChange={(event) => setDraft((value) => ({ ...value, scheduleStartDate: event.target.value }))} /></label>
            <label><span>Repeats</span><select value={draft.recurrenceUnit} onChange={(event) => setDraft((value) => ({ ...value, recurrenceUnit: event.target.value as BillRecurrenceUnit, recurrenceInterval: event.target.value === "NONE" ? "1" : value.recurrenceInterval }))}><option value="NONE">One-time</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option><option value="YEAR">Years</option></select></label>
            {draft.recurrenceUnit !== "NONE" && <label><span>Every</span><input required min={1} max={120} type="number" value={draft.recurrenceInterval} onChange={(event) => setDraft((value) => ({ ...value, recurrenceInterval: event.target.value }))} /></label>}
            {(draft.recurrenceUnit === "MONTH" || draft.recurrenceUnit === "YEAR") && <label><span>Due-date rule</span><select value={draft.recurrenceDayMode} onChange={(event) => setDraft((value) => ({ ...value, recurrenceDayMode: event.target.value as BillRecurrenceDayMode }))}><option value="ANCHOR_DATE">Anchor date (clamp short months)</option><option value="LAST_DAY">Always last day</option></select></label>}
            <label><span>Reminder lead time</span><div className={styles.suffixInput}><input type="number" min={0} max={365} value={draft.reminderDaysBefore} onChange={(event) => setDraft((value) => ({ ...value, reminderDaysBefore: event.target.value }))} /><i>days</i></div></label>
            <label className={styles.checkboxLabel}><input type="checkbox" checked={draft.autopay} onChange={(event) => setDraft((value) => ({ ...value, autopay: event.target.checked }))} /><span><b>AutoPay expected</b><small>This never marks an occurrence paid automatically.</small></span></label>
            <label className={styles.wide}><span>Payment URL</span><input type="url" value={draft.paymentUrl} onChange={(event) => setDraft((value) => ({ ...value, paymentUrl: event.target.value }))} placeholder="https://..." /><small>HTTPS only. Credentials are never stored in the URL.</small></label>
            <label className={styles.wide}><span>Notes</span><textarea maxLength={10000} rows={3} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} placeholder="Account context without passwords or card numbers" /></label>
            {editingBill && shapeChanged && <label className={`${styles.wide} ${styles.effectiveDate}`}><span>Apply schedule / amount changes starting</span><input required type="date" min={today} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /><small>Resolved history and older open obligations are preserved. Future open occurrences on or after this date are regenerated.</small></label>}
          </div>
          {draft.recurrenceDayMode === "LAST_DAY" && (draft.recurrenceUnit === "MONTH" || draft.recurrenceUnit === "YEAR") && <p className={styles.formHint}>Last-day schedules require the anchor date itself to be the final calendar day of its month.</p>}
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <div className={styles.modalActions}><button className="button button-ghost" type="button" disabled={saving} onClick={() => setEditingBill(undefined)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <RefreshCw className={styles.spin} size={14} /> : <WalletCards size={14} />} {editingBill ? "Save bill" : "Create bill"}</button></div>
        </form>
      </section>
    </div>}

    {resolution && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resolving) setResolution(null); }}>
      <section className={`${styles.modal} ${styles.resolutionModal}`} role="dialog" aria-modal="true" aria-labelledby="resolution-title">
        <div className={styles.modalHead}><div><p className="eyebrow">Resolve occurrence</p><h2 id="resolution-title">{resolution.action === "PAID" ? "Mark paid" : resolution.action === "SKIPPED" ? "Skip occurrence" : "Cancel occurrence"}</h2></div><button className={styles.closeButton} type="button" aria-label="Close resolution form" disabled={resolving} onClick={() => setResolution(null)}><X size={18} /></button></div>
        <div className={styles.resolutionContext}><b>{billById.get(resolution.occurrence.billId)?.name ?? "Bill"}</b><span>Due {formatDateOnly(resolution.occurrence.dueDate)}</span></div>
        <form onSubmit={saveResolution} className={styles.form}>
          {resolution.action === "PAID" && <div className={styles.formGrid}><label><span>Paid on</span><input required type="date" value={resolution.paidOn} onChange={(event) => setResolution((value) => value ? { ...value, paidOn: event.target.value } : value)} /></label><label><span>Actual amount (optional)</span><div className={styles.moneyInput}><i>$</i><input inputMode="decimal" value={resolution.paidAmount} onChange={(event) => setResolution((value) => value ? { ...value, paidAmount: event.target.value } : value)} placeholder="0.00" /></div></label></div>}
          <label><span>Resolution note (optional)</span><textarea rows={3} maxLength={2000} value={resolution.note} onChange={(event) => setResolution((value) => value ? { ...value, note: event.target.value } : value)} placeholder={resolution.action === "PAID" ? "Confirmation or context" : "Why this occurrence is not payable"} /></label>
          {resolutionError && <p className={styles.formError} role="alert">{resolutionError}</p>}
          <div className={styles.modalActions}><button className="button button-ghost" type="button" disabled={resolving} onClick={() => setResolution(null)}>Back</button><button className="button button-primary" disabled={resolving}>{resolving ? <RefreshCw className={styles.spin} size={14} /> : resolution.action === "PAID" ? <Check size={14} /> : resolution.action === "SKIPPED" ? <SkipForward size={14} /> : <Ban size={14} />} Confirm {resolution.action.toLowerCase()}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}
