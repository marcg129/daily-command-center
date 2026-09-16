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
  CircleAlert,
  Info,
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
  loadHostedApplicationSession,
  selectAuthorizedWorkspace,
} from "@/lib/runtime/browser-runtime";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";
import type {
  IncomeDefinitionCore,
  IncomeRecurrenceDayMode,
  IncomeRecurrenceUnit,
} from "@/lib/runtime/income";
import {
  validateHostedIncomeDefinition,
  type HostedCashflowBaseline,
  type HostedIncomeOccurrence,
  type HostedIncomeSource,
  type IncomeOccurrenceResolutionAction,
} from "@/lib/runtime/hosted-income";
import { buildPaydayForecast, type ForecastAmountSummary } from "@/lib/runtime/cashflow-forecast";
import { dollarsInputToMinor, minorToDollarsInput } from "@/lib/bill-ui";
import {
  formatIncomeAmount,
  incomeOccurrenceShapeChanged,
  incomeRecurrenceLabel,
} from "@/lib/income-ui";
import { WORKSPACES, WORKSPACE_OPTIONS } from "@/lib/workspace-ui";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import styles from "./cash-flow-view.module.css";

type IncomeSummary = Readonly<{
  incomeSources: HostedIncomeSource[];
  occurrences: HostedIncomeOccurrence[];
}>;

type BillsSummary = Readonly<{
  bills: HostedBill[];
  occurrences: HostedBillOccurrence[];
}>;

type IncomeDraft = {
  name: string;
  payer: string;
  amountMode: "FIXED" | "VARIABLE";
  amount: string;
  scheduleStartDate: string;
  recurrenceUnit: IncomeRecurrenceUnit;
  recurrenceInterval: string;
  recurrenceDayMode: IncomeRecurrenceDayMode;
  semimonthDayOne: string;
  semimonthDayTwo: string;
};

type ResolutionDraft = {
  occurrence: HostedIncomeOccurrence;
  action: IncomeOccurrenceResolutionAction;
  receivedOn: string;
  receivedAmount: string;
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

function formatSignedMinorCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function signedMinorToDollars(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function signedDollarsToMinor(value: string): number {
  const normalized = value.trim();
  const match = /^(-)?(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Cash position must be a dollar value with at most two decimal places.");
  const whole = Number(match[2]);
  const cents = Number((match[3] ?? "").padEnd(2, "0"));
  const amount = whole * 100 + cents;
  const result = match[1] ? -amount : amount;
  if (!Number.isSafeInteger(result)) throw new Error("Cash position is too large.");
  return result;
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function blankIncomeDraft(today: string): IncomeDraft {
  return {
    name: "",
    payer: "",
    amountMode: "FIXED",
    amount: "",
    scheduleStartDate: today,
    recurrenceUnit: "WEEK",
    recurrenceInterval: "2",
    recurrenceDayMode: "ANCHOR_DATE",
    semimonthDayOne: "15",
    semimonthDayTwo: "31",
  };
}

function draftFromIncome(source: HostedIncomeSource): IncomeDraft {
  return {
    name: source.name,
    payer: source.payer ?? "",
    amountMode: source.amountMode,
    amount: source.defaultNetAmountMinor === null ? "" : minorToDollarsInput(source.defaultNetAmountMinor),
    scheduleStartDate: source.scheduleStartDate,
    recurrenceUnit: source.recurrenceUnit,
    recurrenceInterval: String(source.recurrenceInterval),
    recurrenceDayMode: source.recurrenceDayMode ?? "ANCHOR_DATE",
    semimonthDayOne: source.semimonthDayOne === null ? "15" : String(source.semimonthDayOne),
    semimonthDayTwo: source.semimonthDayTwo === null ? "31" : String(source.semimonthDayTwo),
  };
}

function coreFromSource(source: HostedIncomeSource): IncomeDefinitionCore {
  return {
    name: source.name,
    payer: source.payer,
    amountMode: source.amountMode,
    defaultNetAmountMinor: source.defaultNetAmountMinor,
    currency: source.currency,
    scheduleStartDate: source.scheduleStartDate,
    recurrenceUnit: source.recurrenceUnit,
    recurrenceInterval: source.recurrenceInterval,
    recurrenceDayMode: source.recurrenceDayMode,
    semimonthDayOne: source.semimonthDayOne,
    semimonthDayTwo: source.semimonthDayTwo,
    status: source.status,
  };
}

function coreFromDraft(draft: IncomeDraft, status: HostedIncomeSource["status"]): IncomeDefinitionCore {
  const amount = dollarsInputToMinor(draft.amount);
  if (draft.amountMode === "FIXED" && amount === null) throw new Error("Enter the normal net income amount.");
  const recurrenceInterval = draft.recurrenceUnit === "NONE" || draft.recurrenceUnit === "SEMIMONTH"
    ? 1
    : Number(draft.recurrenceInterval);
  const core: IncomeDefinitionCore = {
    name: draft.name.trim(),
    payer: draft.payer.trim() || null,
    amountMode: draft.amountMode,
    defaultNetAmountMinor: amount,
    currency: "USD",
    scheduleStartDate: draft.scheduleStartDate,
    recurrenceUnit: draft.recurrenceUnit,
    recurrenceInterval,
    recurrenceDayMode: draft.recurrenceUnit === "MONTH" || draft.recurrenceUnit === "YEAR"
      ? draft.recurrenceDayMode
      : null,
    semimonthDayOne: draft.recurrenceUnit === "SEMIMONTH" ? Number(draft.semimonthDayOne) : null,
    semimonthDayTwo: draft.recurrenceUnit === "SEMIMONTH" ? Number(draft.semimonthDayTwo) : null,
    status,
  };
  validateHostedIncomeDefinition(core);
  return core;
}

function summaryAmount(summary: ForecastAmountSummary): string {
  const known = formatSignedMinorCurrency(summary.knownTotalMinor);
  if (summary.unknownAmountCount === 0) return known;
  return `${known} + ${summary.unknownAmountCount} unknown`;
}

function summaryQualifier(summary: ForecastAmountSummary): string {
  const parts: string[] = [];
  if (summary.exactKnownMinor) parts.push(`${formatSignedMinorCurrency(summary.exactKnownMinor)} exact`);
  if (summary.estimatedKnownMinor) parts.push(`${formatSignedMinorCurrency(summary.estimatedKnownMinor)} estimated`);
  if (summary.unknownAmountCount) parts.push(`${summary.unknownAmountCount} unknown`);
  return parts.join(" · ") || "No known amount";
}

export function CashFlowView({ initialWorkspaceId }: { initialWorkspaceId: ProductWorkspaceId }) {
  const today = productToday();
  const [workspaceId, setWorkspaceId] = useState<ProductWorkspaceId>(initialWorkspaceId);
  const [authorizedWorkspaceIds, setAuthorizedWorkspaceIds] = useState<ProductWorkspaceId[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");
  const [income, setIncome] = useState<IncomeSummary>({ incomeSources: [], occurrences: [] });
  const [bills, setBills] = useState<BillsSummary>({ bills: [], occurrences: [] });
  const [baseline, setBaseline] = useState<HostedCashflowBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingIncome, setEditingIncome] = useState<HostedIncomeSource | null | undefined>(undefined);
  const [draft, setDraft] = useState<IncomeDraft>(() => blankIncomeDraft(today));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusPending, setStatusPending] = useState("");
  const [resolution, setResolution] = useState<ResolutionDraft | null>(null);
  const [resolutionError, setResolutionError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [baselineAmount, setBaselineAmount] = useState("");
  const [baselineDate, setBaselineDate] = useState(today);
  const [baselineError, setBaselineError] = useState("");
  const [baselineSaving, setBaselineSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (browserRuntimeMode(window.location.hostname) !== "hosted") {
        if (!cancelled) {
          setRuntimeError("Cash Flow is available on the hosted Daily Command Center. Local mode does not expose financial records.");
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
        const [incomeResponse, billsResponse, baselineResponse] = await Promise.all([
          fetch(`/api/hosted/income?workspaceId=${encodeURIComponent(workspaceId)}&includeArchived=${includeArchived ? "true" : "false"}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/hosted/bills?workspaceId=${encodeURIComponent(workspaceId)}&includeArchived=false`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/hosted/cashflow/baseline?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal }),
        ]);
        const [incomePayload, billsPayload, baselinePayload] = await Promise.all([
          incomeResponse.json(), billsResponse.json(), baselineResponse.json(),
        ]);
        if (!incomeResponse.ok) throw new Error(responseError(incomePayload, "Income could not be loaded."));
        if (!billsResponse.ok) throw new Error(responseError(billsPayload, "Bills could not be loaded."));
        if (!baselineResponse.ok) throw new Error(responseError(baselinePayload, "Cash baseline could not be loaded."));
        if (!controller.signal.aborted) {
          const loadedBaseline = (baselinePayload as { baseline: HostedCashflowBaseline | null }).baseline;
          setIncome(incomePayload as IncomeSummary);
          setBills(billsPayload as BillsSummary);
          setBaseline(loadedBaseline);
          setBaselineAmount(loadedBaseline ? signedMinorToDollars(loadedBaseline.amountMinor) : "");
          setBaselineDate(loadedBaseline?.asOfDate ?? today);
          setBaselineError("");
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Cash Flow could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [authorizedWorkspaceIds, includeArchived, initializing, nonce, runtimeError, today, workspaceId]);

  const incomeById = useMemo(() => new Map(income.incomeSources.map((source) => [source.incomeSourceId, source] as const)), [income.incomeSources]);
  const billById = useMemo(() => new Map(bills.bills.map((bill) => [bill.billId, bill] as const)), [bills.bills]);

  const nonUsdCount = useMemo(() =>
    income.occurrences.filter((item) => item.currency !== "USD").length +
    bills.occurrences.filter((item) => item.currency !== "USD").length +
    (baseline && baseline.currency !== "USD" ? 1 : 0),
  [baseline, bills.occurrences, income.occurrences]);

  const forecast = useMemo(() => buildPaydayForecast({
    today,
    currency: "USD",
    incomeOccurrences: income.occurrences.flatMap((occurrence) => {
      const source = incomeById.get(occurrence.incomeSourceId);
      if (!source || occurrence.currency !== "USD") return [];
      return [{
        occurrenceId: occurrence.occurrenceId,
        payDate: occurrence.payDate,
        expectedAmountMinor: occurrence.expectedAmountMinor,
        amountMode: source.amountMode,
        currency: occurrence.currency,
        status: occurrence.status,
      }];
    }),
    billOccurrences: bills.occurrences.flatMap((occurrence) => {
      const bill = billById.get(occurrence.billId);
      if (!bill || occurrence.currency !== "USD") return [];
      return [{
        occurrenceId: occurrence.occurrenceId,
        dueDate: occurrence.dueDate,
        expectedAmountMinor: occurrence.expectedAmountMinor,
        amountMode: bill.amountMode,
        currency: occurrence.currency,
        status: occurrence.status,
      }];
    }),
    baseline: baseline?.currency === "USD" ? {
      amountMinor: baseline.amountMinor,
      currency: baseline.currency,
      asOfDate: baseline.asOfDate,
    } : null,
  }), [baseline, billById, bills.occurrences, income.occurrences, incomeById, today]);

  const payday = forecast.nextPayday?.date ?? null;
  const paydayIncome = useMemo(() => payday ? income.occurrences.filter((item) => item.status === "EXPECTED" && item.payDate === payday && item.currency === "USD") : [], [income.occurrences, payday]);
  const billsBefore = useMemo(() => payday ? bills.occurrences.filter((item) => item.status === "OPEN" && item.dueDate < payday && item.currency === "USD") : [], [bills.occurrences, payday]);
  const billsOn = useMemo(() => payday ? bills.occurrences.filter((item) => item.status === "OPEN" && item.dueDate === payday && item.currency === "USD") : [], [bills.occurrences, payday]);
  const authorizedOptions = WORKSPACE_OPTIONS.filter(({ id }) => authorizedWorkspaceIds.includes(id));

  const selectWorkspace = (next: ProductWorkspaceId) => {
    if (!authorizedWorkspaceIds.includes(next)) return;
    setWorkspaceId(next);
    setEditingIncome(undefined);
    setResolution(null);
    const url = new URL(window.location.href);
    url.searchParams.set("workspaceId", next);
    window.history.replaceState({}, "", url);
  };

  const openNewIncome = () => {
    setDraft(blankIncomeDraft(today));
    setEffectiveDate(today);
    setFormError("");
    setEditingIncome(null);
  };

  const openEditIncome = (source: HostedIncomeSource) => {
    setDraft(draftFromIncome(source));
    setEffectiveDate(today);
    setFormError("");
    setEditingIncome(source);
  };

  let shapeChanged = false;
  if (editingIncome) {
    try {
      shapeChanged = incomeOccurrenceShapeChanged(editingIncome, coreFromDraft(draft, editingIncome.status));
    } catch {
      shapeChanged = false;
    }
  }

  const saveIncome = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const core = coreFromDraft(draft, editingIncome?.status ?? "ACTIVE");
      const changed = editingIncome ? incomeOccurrenceShapeChanged(editingIncome, core) : false;
      if (changed && !effectiveDate) throw new Error("Choose when schedule or amount changes should take effect.");
      const response = await fetch(`/api/hosted/income?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: editingIncome ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingIncome
          ? { incomeSourceId: editingIncome.incomeSourceId, incomeSource: core, ...(changed ? { effectiveDate } : {}) }
          : { incomeSource: core }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Income source could not be saved."));
      setEditingIncome(undefined);
      setNonce((value) => value + 1);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Income source could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const changeIncomeStatus = async (source: HostedIncomeSource, status: HostedIncomeSource["status"]) => {
    if (status === "ARCHIVED" && !window.confirm(`Archive ${source.name}? Its occurrence history will be preserved.`)) return;
    setStatusPending(source.incomeSourceId);
    setError("");
    try {
      const response = await fetch(`/api/hosted/income?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incomeSourceId: source.incomeSourceId, incomeSource: { ...coreFromSource(source), status } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Income source status could not be changed."));
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Income source status could not be changed.");
    } finally {
      setStatusPending("");
    }
  };

  const openResolution = (occurrence: HostedIncomeOccurrence, action: IncomeOccurrenceResolutionAction) => {
    setResolution({
      occurrence,
      action,
      receivedOn: today,
      receivedAmount: occurrence.expectedAmountMinor === null ? "" : minorToDollarsInput(occurrence.expectedAmountMinor),
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
      const receivedAmountMinor = resolution.action === "RECEIVED" ? dollarsInputToMinor(resolution.receivedAmount) : null;
      const response = await fetch(`/api/hosted/income/occurrences?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurrenceId: resolution.occurrence.occurrenceId,
          action: resolution.action,
          ...(resolution.action === "RECEIVED" ? { receivedOn: resolution.receivedOn, receivedAmountMinor } : {}),
          resolutionNote: resolution.note.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Income occurrence could not be updated."));
      setResolution(null);
      setNonce((value) => value + 1);
    } catch (caught) {
      setResolutionError(caught instanceof Error ? caught.message : "Income occurrence could not be updated.");
    } finally {
      setResolving(false);
    }
  };

  const saveBaseline = async (event: FormEvent) => {
    event.preventDefault();
    setBaselineSaving(true);
    setBaselineError("");
    try {
      const amountMinor = signedDollarsToMinor(baselineAmount);
      const response = await fetch(`/api/hosted/cashflow/baseline?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseline: { amountMinor, currency: "USD", asOfDate: baselineDate } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Manual cash position could not be saved."));
      const saved = (payload as { baseline: HostedCashflowBaseline }).baseline;
      setBaseline(saved);
      setBaselineAmount(signedMinorToDollars(saved.amountMinor));
      setBaselineDate(saved.asOfDate);
    } catch (caught) {
      setBaselineError(caught instanceof Error ? caught.message : "Manual cash position could not be saved.");
    } finally {
      setBaselineSaving(false);
    }
  };

  const clearBaseline = async () => {
    if (!baseline || !window.confirm("Clear this manual cash position? Income and bill records will not be changed.")) return;
    setBaselineSaving(true);
    setBaselineError("");
    try {
      const response = await fetch(`/api/hosted/cashflow/baseline?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Manual cash position could not be cleared."));
      setBaseline(null);
      setBaselineAmount("");
      setBaselineDate(today);
    } catch (caught) {
      setBaselineError(caught instanceof Error ? caught.message : "Manual cash position could not be cleared.");
    } finally {
      setBaselineSaving(false);
    }
  };

  if (initializing) {
    return <div className="app-shell" data-workspace={workspaceId}><main><div className="view"><section className={`panel ${styles.centerState}`}><RefreshCw className={styles.spin} size={28} /><h1>Opening Cash Flow</h1><p>Resolving your financial workspace securely…</p></section></div></main></div>;
  }

  if (runtimeError) {
    return <div className="app-shell" data-workspace={workspaceId}><main><div className="view"><section className={`panel ${styles.centerState}`}><CircleAlert size={30} /><h1>Cash Flow is unavailable here</h1><p>{runtimeError}</p><Link className="button button-ghost" href="/"><ArrowLeft size={15} /> Back to dashboard</Link></section></div></main></div>;
  }

  const next = forecast.nextPayday;

  return <div className="app-shell" data-workspace={workspaceId}>
    <header className="topbar">
      <Link className="brand-lockup" href="/" aria-label="Back to Daily Command Center">
        <span className="brand-mark"><Activity size={18} /></span>
        <span><b>DAILY COMMAND CENTER</b><small>PAYDAY & CASH FLOW</small></span>
      </Link>
      <WorkspaceSwitcher value={workspaceId} onChange={selectWorkspace} options={authorizedOptions} showCashFlowLink={false} />
      <span aria-hidden="true" />
      <Link className="button button-ghost" href="/"><ArrowLeft size={14} /> Dashboard</Link>
    </header>

    <main>
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{WORKSPACES[workspaceId].displayName} · Cash Flow</p>
            <h1>Payday & cash flow</h1>
            <p className="page-description">See the next expected payday, obligations due before it, and a known-amount projection using only the records in this workspace.</p>
          </div>
          <button className="button button-primary" onClick={openNewIncome}><Plus size={15} /> Add income</button>
        </div>

        {error && <div className={styles.errorNotice} role="alert"><CircleAlert size={17} /><span>{error}</span><button type="button" onClick={() => setNonce((value) => value + 1)}>Retry</button></div>}

        <section className={styles.summaryGrid} aria-label="Cash-flow forecast summary">
          <article className={`panel ${styles.summaryCard}`}><small>Next payday</small><strong>{next ? formatDateOnly(next.date) : "Not set"}</strong><span>{next ? `${next.income.itemCount} expected income occurrence${next.income.itemCount === 1 ? "" : "s"}` : "Add an active income source to forecast a payday"}</span></article>
          <article className={`panel ${styles.summaryCard}`}><small>Expected income</small><strong>{next ? summaryAmount(next.income) : "—"}</strong><span>{next ? summaryQualifier(next.income) : "No upcoming payday"}</span></article>
          <article className={`panel ${styles.summaryCard} ${next && (next.billsBeforePayday.unknownAmountCount || next.billsBeforePayday.estimatedKnownMinor) ? styles.attentionCard : ""}`}><small>Due before payday</small><strong>{next ? summaryAmount(next.billsBeforePayday) : "—"}</strong><span>{next ? summaryQualifier(next.billsBeforePayday) : "Waiting for an income schedule"}</span></article>
          <article className={`panel ${styles.summaryCard} ${next?.afterProjectionHasUncertainty ? styles.attentionCard : ""}`}><small>Projected known after payday</small><strong>{next?.projectedKnownAfterPaydayMinor === null || next?.projectedKnownAfterPaydayMinor === undefined ? "No baseline" : formatSignedMinorCurrency(next.projectedKnownAfterPaydayMinor)}</strong><span>{!baseline ? "Add a manual cash position to calculate this" : next?.afterProjectionHasUncertainty ? "Known-amount projection · estimates or unknowns remain" : "Known-amount projection"}</span></article>
        </section>

        <div className={styles.disclosure}><Info size={15} /><span>This is a planning forecast, not a bank balance or spending recommendation. Personal and Indelitech cash are calculated separately. Variable and unknown amounts stay visibly uncertain; same-day bills are shown separately because deposit and charge timing is not assumed.{nonUsdCount ? ` ${nonUsdCount} non-USD record${nonUsdCount === 1 ? " is" : "s are"} excluded from this USD-only view.` : ""}</span></div>

        <div className={styles.layoutGrid}>
          <div className={styles.stack}>
            {!next ? <section className={`panel ${styles.emptyState}`}><CalendarDays size={28} /><h3>No upcoming payday yet</h3><p>Add an active income source with a future expected date. Cash Flow will then group open bills around that payday without changing the Bills ledger.</p><button className="button button-primary" onClick={openNewIncome}><Plus size={14} /> Add income source</button></section> : <>
              <section className={`panel ${styles.panelPad}`}>
                <div className={styles.sectionHead}><div><p className="eyebrow">Expected deposits</p><h2>On {formatDateOnly(next.date)}</h2></div><span>{paydayIncome.length} expected</span></div>
                <div className={styles.forecastList}>
                  {paydayIncome.map((occurrence) => {
                    const source = incomeById.get(occurrence.incomeSourceId);
                    if (!source) return null;
                    const amount = formatIncomeAmount(source, occurrence.expectedAmountMinor);
                    return <article className={styles.forecastRow} key={occurrence.occurrenceId}>
                      <div className={styles.dateBlock}><b>{formatDateOnly(occurrence.payDate)}</b><small>Expected payday</small></div>
                      <div className={styles.rowCopy}><h3>{source.name}</h3><p>{source.payer || incomeRecurrenceLabel(source)}</p><div className={styles.badges}>{source.amountMode === "VARIABLE" && <span className={styles.estimatedBadge}>Variable</span>}</div></div>
                      <div className={styles.amountBlock}><b>{amount.label}</b><small>{amount.qualifier}</small></div>
                      <div className={styles.rowActions}><button className={styles.primaryAction} type="button" onClick={() => openResolution(occurrence, "RECEIVED")}><Check size={13} /> Received</button><button type="button" onClick={() => openResolution(occurrence, "SKIPPED")}><SkipForward size={13} /> Skip</button><button type="button" onClick={() => openResolution(occurrence, "CANCELLED")}><Ban size={13} /> Cancel</button></div>
                    </article>;
                  })}
                </div>
              </section>

              <section className={`panel ${styles.panelPad}`}>
                <div className={styles.sectionHead}><div><p className="eyebrow">Open obligations</p><h2>Due before payday</h2></div><span>{billsBefore.length} bill{billsBefore.length === 1 ? "" : "s"}</span></div>
                {billsBefore.length === 0 ? <div className={styles.emptyState}><Check size={25} /><h3>Nothing open before payday</h3><p>No open Bill occurrence currently falls before {formatDateOnly(next.date)}.</p></div> : <div className={styles.forecastList}>{billsBefore.map((occurrence) => {
                  const bill = billById.get(occurrence.billId);
                  if (!bill) return null;
                  return <BillForecastRow key={occurrence.occurrenceId} bill={bill} occurrence={occurrence} today={today} workspaceId={workspaceId} />;
                })}</div>}
              </section>

              <section className={`panel ${styles.panelPad}`}>
                <div className={styles.sectionHead}><div><p className="eyebrow">Timing kept separate</p><h2>Due on payday</h2></div><span>{billsOn.length} bill{billsOn.length === 1 ? "" : "s"}</span></div>
                {billsOn.length === 0 ? <div className={styles.emptyState}><Check size={25} /><h3>No same-day obligations</h3><p>Nothing open is due on the same date as this payday.</p></div> : <div className={styles.forecastList}>{billsOn.map((occurrence) => {
                  const bill = billById.get(occurrence.billId);
                  if (!bill) return null;
                  return <BillForecastRow key={occurrence.occurrenceId} bill={bill} occurrence={occurrence} today={today} workspaceId={workspaceId} />;
                })}</div>}
              </section>
            </>}
          </div>

          <aside className={styles.stack}>
            <section className={`panel ${styles.panelPad}`}>
              <div className={styles.sectionHead}><div><p className="eyebrow">User-entered position</p><h2>Manual cash baseline</h2></div>{baseline && <span>As of {formatDateOnly(baseline.asOfDate)}</span>}</div>
              <div className={styles.baselineCard}>
                {baseline && <div className={styles.baselineValue}><strong>{formatSignedMinorCurrency(baseline.amountMinor)}</strong><span>Manual · not bank verified<br />Last saved {formatDateOnly(baseline.asOfDate)}</span></div>}
                <form className={styles.baselineForm} onSubmit={saveBaseline}>
                  <label><span>Available cash position</span><input inputMode="decimal" value={baselineAmount} onChange={(event) => setBaselineAmount(event.target.value)} placeholder="2500.00 or -150.00" required /></label>
                  <label><span>As-of date</span><input type="date" value={baselineDate} max={today} onChange={(event) => setBaselineDate(event.target.value)} required /></label>
                  {baselineError && <p className={styles.formError} role="alert">{baselineError}</p>}
                  <div className={styles.baselineActions}><button className="button button-primary" type="submit" disabled={baselineSaving}>{baselineSaving ? "Saving…" : baseline ? "Update baseline" : "Save baseline"}</button>{baseline && <button className="button button-ghost" type="button" onClick={clearBaseline} disabled={baselineSaving}>Clear</button>}</div>
                </form>
              </div>
            </section>

            <section className={`panel ${styles.panelPad}`}>
              <div className={styles.sectionHead}><div><p className="eyebrow">Definitions</p><h2>Income sources</h2></div><button className="button button-ghost" type="button" onClick={() => setNonce((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={14} /> Refresh</button></div>
              <label className={styles.factLabel}><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived</label>
              <div className={styles.sourceGrid} style={{ marginTop: 12 }}>
                {income.incomeSources.length === 0 ? <div className={styles.emptyState}><WalletCards size={25} /><h3>No income sources</h3><p>Create a paycheck, recurring deposit, or one-time expected income source.</p><button className="button button-primary" onClick={openNewIncome}><Plus size={14} /> Add income</button></div> : income.incomeSources.map((source) => {
                  const nextOccurrence = income.occurrences.find((item) => item.incomeSourceId === source.incomeSourceId && item.status === "EXPECTED");
                  const amount = formatIncomeAmount(source);
                  return <article className={styles.sourceCard} key={source.incomeSourceId}>
                    <div className={styles.sourceHead}><div><h3>{source.name}</h3><p>{source.payer || "No payer"}</p></div><span className={`${styles.statusBadge} ${styles[`status${source.status}`]}`}>{source.status}</span></div>
                    <div className={styles.sourceFacts}><div><b>{amount.label}</b><small>{amount.qualifier}</small></div><div><b>{incomeRecurrenceLabel(source)}</b><small>Schedule</small></div><div><b>{nextOccurrence ? formatDateOnly(nextOccurrence.payDate) : "No expected date"}</b><small>Next occurrence</small></div></div>
                    <div className={styles.sourceActions}><button type="button" onClick={() => openEditIncome(source)}><Pencil size={12} /> Edit</button>{source.status === "ACTIVE" && <button type="button" disabled={statusPending === source.incomeSourceId} onClick={() => changeIncomeStatus(source, "PAUSED")}><Ban size={12} /> Pause</button>}{source.status === "PAUSED" && <button type="button" disabled={statusPending === source.incomeSourceId} onClick={() => changeIncomeStatus(source, "ACTIVE")}><Play size={12} /> Resume</button>}{source.status !== "ARCHIVED" && <button type="button" disabled={statusPending === source.incomeSourceId} onClick={() => changeIncomeStatus(source, "ARCHIVED")}><Archive size={12} /> Archive</button>}{source.status === "ARCHIVED" && <button type="button" disabled={statusPending === source.incomeSourceId} onClick={() => changeIncomeStatus(source, "ACTIVE")}><ArchiveRestore size={12} /> Restore</button>}</div>
                  </article>;
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>

    {editingIncome !== undefined && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setEditingIncome(undefined); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="income-editor-title">
        <div className={styles.modalHead}><div><p className="eyebrow">{editingIncome ? "Edit definition" : "New definition"}</p><h2 id="income-editor-title">{editingIncome ? editingIncome.name : "Add income source"}</h2></div><button className={styles.closeButton} type="button" onClick={() => setEditingIncome(undefined)} disabled={saving} aria-label="Close"><X size={16} /></button></div>
        <form className={styles.form} onSubmit={saveIncome}>
          <div className={styles.formGrid}>
            <label><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Paycheck" required /></label>
            <label><span>Payer</span><input value={draft.payer} onChange={(event) => setDraft({ ...draft, payer: event.target.value })} placeholder="Employer or client" /></label>
            <label><span>Amount type</span><select value={draft.amountMode} onChange={(event) => setDraft({ ...draft, amountMode: event.target.value as IncomeDraft["amountMode"] })}><option value="FIXED">Fixed / exact</option><option value="VARIABLE">Variable / estimated</option></select></label>
            <label><span>Normal net amount</span><div className={styles.moneyInput}><i>$</i><input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder={draft.amountMode === "VARIABLE" ? "Optional" : "1500.00"} /></div></label>
            <label><span>First expected pay date</span><input type="date" value={draft.scheduleStartDate} onChange={(event) => setDraft({ ...draft, scheduleStartDate: event.target.value })} required /></label>
            <label><span>Frequency</span><select value={draft.recurrenceUnit} onChange={(event) => setDraft({ ...draft, recurrenceUnit: event.target.value as IncomeRecurrenceUnit })}><option value="NONE">One-time</option><option value="WEEK">Weekly / every N weeks</option><option value="SEMIMONTH">Twice monthly</option><option value="MONTH">Monthly / every N months</option><option value="YEAR">Yearly / every N years</option></select></label>
            {draft.recurrenceUnit !== "NONE" && draft.recurrenceUnit !== "SEMIMONTH" && <label><span>Repeat every</span><input type="number" min="1" max="120" step="1" value={draft.recurrenceInterval} onChange={(event) => setDraft({ ...draft, recurrenceInterval: event.target.value })} required /></label>}
            {(draft.recurrenceUnit === "MONTH" || draft.recurrenceUnit === "YEAR") && <label><span>Calendar rule</span><select value={draft.recurrenceDayMode} onChange={(event) => setDraft({ ...draft, recurrenceDayMode: event.target.value as IncomeRecurrenceDayMode })}><option value="ANCHOR_DATE">Anchor date (clamp short months)</option><option value="LAST_DAY">Last day of period</option></select></label>}
            {draft.recurrenceUnit === "SEMIMONTH" && <><label><span>First payday day</span><input type="number" min="1" max="27" value={draft.semimonthDayOne} onChange={(event) => setDraft({ ...draft, semimonthDayOne: event.target.value })} required /></label><label><span>Second payday day</span><input type="number" min="2" max="31" value={draft.semimonthDayTwo} onChange={(event) => setDraft({ ...draft, semimonthDayTwo: event.target.value })} required /></label><p className={`${styles.formHint} ${styles.wide}`}>For twice-monthly income, the first expected pay date must match one of these configured paydays in its month.</p></>}
            {editingIncome && shapeChanged && <label className={styles.wide}><span>Changes take effect</span><input type="date" min={today} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required /><small>Resolved history and expected occurrences before this date are preserved. The new schedule begins at this boundary.</small></label>}
          </div>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <div className={styles.modalActions}><button className="button button-ghost" type="button" onClick={() => setEditingIncome(undefined)} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editingIncome ? "Save changes" : "Add income"}</button></div>
        </form>
      </section>
    </div>}

    {resolution && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !resolving) setResolution(null); }}>
      <section className={`${styles.modal} ${styles.smallModal}`} role="dialog" aria-modal="true" aria-labelledby="income-resolution-title">
        <div className={styles.modalHead}><div><p className="eyebrow">Income occurrence</p><h2 id="income-resolution-title">{resolution.action === "RECEIVED" ? "Mark received" : resolution.action === "SKIPPED" ? "Skip expected income" : "Cancel expected income"}</h2></div><button className={styles.closeButton} type="button" onClick={() => setResolution(null)} disabled={resolving} aria-label="Close"><X size={16} /></button></div>
        <form className={styles.form} onSubmit={saveResolution}>
          <p className={styles.disclosure}>{incomeById.get(resolution.occurrence.incomeSourceId)?.name ?? "Income"} · expected {formatDateOnly(resolution.occurrence.payDate)}</p>
          {resolution.action === "RECEIVED" && <div className={styles.formGrid}><label><span>Received on</span><input type="date" value={resolution.receivedOn} onChange={(event) => setResolution({ ...resolution, receivedOn: event.target.value })} required /></label><label><span>Actual amount</span><div className={styles.moneyInput}><i>$</i><input inputMode="decimal" value={resolution.receivedAmount} onChange={(event) => setResolution({ ...resolution, receivedAmount: event.target.value })} placeholder="Optional" /></div></label></div>}
          <label><span>Note</span><input value={resolution.note} onChange={(event) => setResolution({ ...resolution, note: event.target.value })} placeholder="Optional note" /></label>
          {resolutionError && <p className={styles.formError} role="alert">{resolutionError}</p>}
          <div className={styles.modalActions}><button className="button button-ghost" type="button" onClick={() => setResolution(null)} disabled={resolving}>Back</button><button className="button button-primary" type="submit" disabled={resolving}>{resolving ? "Saving…" : "Confirm"}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}

function BillForecastRow({ bill, occurrence, today, workspaceId }: {
  bill: HostedBill;
  occurrence: HostedBillOccurrence;
  today: string;
  workspaceId: ProductWorkspaceId;
}) {
  const amount = occurrence.expectedAmountMinor === null
    ? "Amount unknown"
    : formatSignedMinorCurrency(occurrence.expectedAmountMinor, occurrence.currency);
  const qualifier = occurrence.expectedAmountMinor === null ? "Unknown" : bill.amountMode === "FIXED" ? "Exact" : "Estimated";
  return <article className={`${styles.forecastRow} ${occurrence.dueDate < today ? styles.overdue : ""}`}>
    <div className={styles.dateBlock}><b>{formatDateOnly(occurrence.dueDate)}</b><small>{occurrence.dueDate < today ? "Overdue · still open" : occurrence.dueDate === today ? "Due today" : "Open bill"}</small></div>
    <div className={styles.rowCopy}><h3>{bill.name}</h3><p>{bill.payee || bill.category || "Bill obligation"}</p><div className={styles.badges}>{bill.autopay && <span className={styles.badge}>AutoPay</span>}{bill.amountMode === "VARIABLE" && <span className={styles.estimatedBadge}>Variable</span>}{occurrence.expectedAmountMinor === null && <span className={styles.unknownBadge}>Unknown amount</span>}</div></div>
    <div className={styles.amountBlock}><b>{amount}</b><small>{qualifier}</small></div>
    <div className={styles.rowActions}><Link href={`/bills?workspaceId=${encodeURIComponent(workspaceId)}`}><WalletCards size={12} /> Open Bills</Link></div>
  </article>;
}
