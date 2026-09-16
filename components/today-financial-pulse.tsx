"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CircleAlert, RefreshCw, WalletCards } from "lucide-react";
import { billProjectionToday } from "@/lib/bill-projections";
import { browserRuntimeMode, loadHostedApplicationSession } from "@/lib/runtime/browser-runtime";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";
import type {
  HostedCashflowBaseline,
  HostedIncomeOccurrence,
  HostedIncomeSource,
} from "@/lib/runtime/hosted-income";
import {
  buildTodayFinancialPulseForecast,
  formatPulseAmountSummary,
  formatPulseCurrencyMinor,
  pulseAmountQualifier,
} from "@/lib/today-financial-pulse";
import styles from "./today-financial-pulse.module.css";

type IncomeSummary = Readonly<{
  incomeSources: HostedIncomeSource[];
  occurrences: HostedIncomeOccurrence[];
}>;

type BillsSummary = Readonly<{
  bills: HostedBill[];
  occurrences: HostedBillOccurrence[];
}>;

type BaselineSummary = Readonly<{
  baseline: HostedCashflowBaseline | null;
}>;

const subscribeRuntimeMode = () => () => {};

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
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

export function TodayFinancialPulse({ workspaceId }: { workspaceId: ProductWorkspaceId }) {
  const today = billProjectionToday();
  const hosted = useSyncExternalStore(
    subscribeRuntimeMode,
    () => browserRuntimeMode(window.location.hostname) === "hosted",
    () => false,
  );
  const [income, setIncome] = useState<IncomeSummary>({ incomeSources: [], occurrences: [] });
  const [bills, setBills] = useState<BillsSummary>({ bills: [], occurrences: [] });
  const [baseline, setBaseline] = useState<HostedCashflowBaseline | null>(null);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<ProductWorkspaceId | null>(null);
  const [errorWorkspaceId, setErrorWorkspaceId] = useState<ProductWorkspaceId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!hosted) return;

    const controller = new AbortController();
    const requestWorkspaceId = workspaceId;

    const load = async () => {
      setLoading(true);
      setError("");
      setErrorWorkspaceId(null);
      setLoadedWorkspaceId(null);
      setIncome({ incomeSources: [], occurrences: [] });
      setBills({ bills: [], occurrences: [] });
      setBaseline(null);

      try {
        const session = await loadHostedApplicationSession(fetch);
        if (!session.workspaces.some(({ workspaceId: authorized }) => authorized === requestWorkspaceId)) {
          throw new Error("This workspace is not available to your signed-in account.");
        }

        const [incomeResponse, billsResponse, baselineResponse] = await Promise.all([
          fetch(`/api/hosted/income?workspaceId=${encodeURIComponent(requestWorkspaceId)}&includeArchived=false`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/hosted/bills?workspaceId=${encodeURIComponent(requestWorkspaceId)}&includeArchived=false`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/hosted/cashflow/baseline?workspaceId=${encodeURIComponent(requestWorkspaceId)}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const [incomePayload, billsPayload, baselinePayload] = await Promise.all([
          incomeResponse.json(),
          billsResponse.json(),
          baselineResponse.json(),
        ]);

        if (!incomeResponse.ok) throw new Error(responseError(incomePayload, "Income could not be loaded."));
        if (!billsResponse.ok) throw new Error(responseError(billsPayload, "Bills could not be loaded."));
        if (!baselineResponse.ok) throw new Error(responseError(baselinePayload, "Cash baseline could not be loaded."));
        if (controller.signal.aborted) return;

        setIncome(incomePayload as IncomeSummary);
        setBills(billsPayload as BillsSummary);
        setBaseline((baselinePayload as BaselineSummary).baseline);
        setLoadedWorkspaceId(requestWorkspaceId);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Financial Pulse could not be loaded.");
        setErrorWorkspaceId(requestWorkspaceId);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [hosted, nonce, workspaceId]);

  const forecast = useMemo(() => {
    if (loadedWorkspaceId !== workspaceId) return null;
    return buildTodayFinancialPulseForecast({
      today,
      currency: "USD",
      incomeSources: income.incomeSources,
      incomeOccurrences: income.occurrences,
      bills: bills.bills,
      billOccurrences: bills.occurrences,
      baseline,
    });
  }, [baseline, bills.bills, bills.occurrences, income.incomeSources, income.occurrences, loadedWorkspaceId, today, workspaceId]);

  if (!hosted) return null;

  const next = forecast?.nextPayday ?? null;
  const showError = errorWorkspaceId === workspaceId && Boolean(error);
  const showLoading = !showError && (loading || loadedWorkspaceId !== workspaceId);

  return (
    <section className={styles.panel} aria-label={`${workspaceId === "personal" ? "Personal" : "Indelitech"} Financial Pulse`}>
      <div className={styles.header}>
        <div>
          <p className="eyebrow">Financial pulse</p>
          <h2>Near-term money picture</h2>
        </div>
        <Link href={`/cash-flow?workspaceId=${encodeURIComponent(workspaceId)}`} className={styles.openLink}>
          <WalletCards size={15} aria-hidden="true" /> Open Cash Flow
        </Link>
      </div>

      {showError ? (
        <div className={styles.error} role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setNonce((value) => value + 1)}>Retry</button>
        </div>
      ) : showLoading ? (
        <div className={styles.loading}><RefreshCw className="spin" size={17} aria-hidden="true" /> Checking Cash Flow…</div>
      ) : (
        <div className={styles.grid}>
          <article>
            <small>Next payday</small>
            <strong>{next ? formatDateOnly(next.date) : "Not set"}</strong>
            <span>{next ? `${next.income.itemCount} expected income occurrence${next.income.itemCount === 1 ? "" : "s"}` : "Add an active income source in Cash Flow"}</span>
          </article>
          <article>
            <small>Expected income</small>
            <strong>{next ? formatPulseAmountSummary(next.income) : "—"}</strong>
            <span>{next ? pulseAmountQualifier(next.income) : "No upcoming payday"}</span>
          </article>
          <article data-attention={next && (next.billsBeforePayday.estimatedKnownMinor !== 0 || next.billsBeforePayday.unknownAmountCount !== 0) ? "true" : undefined}>
            <small>Due before payday</small>
            <strong>{next ? formatPulseAmountSummary(next.billsBeforePayday) : "—"}</strong>
            <span>{next ? pulseAmountQualifier(next.billsBeforePayday) : "Waiting for an income schedule"}</span>
          </article>
          <article data-attention={next?.afterProjectionHasUncertainty ? "true" : undefined}>
            <small>Projected known after payday</small>
            <strong>{next?.projectedKnownAfterPaydayMinor === null || next?.projectedKnownAfterPaydayMinor === undefined
              ? "No baseline"
              : formatPulseCurrencyMinor(next.projectedKnownAfterPaydayMinor)}</strong>
            <span>{!next?.baseline
              ? "Add a manual cash baseline in Cash Flow"
              : next.afterProjectionHasUncertainty
                ? "Known-amount projection · estimates or unknowns remain"
                : "Known-amount projection"}</span>
          </article>
        </div>
      )}

      <p className={styles.disclaimer}>Workspace-scoped planning projection. Manual cash baselines are not bank verified, and this is not a spending recommendation.</p>
    </section>
  );
}
