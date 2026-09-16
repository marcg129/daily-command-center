import { PRODUCT_TIME_ZONE } from "./product-time";
import type { ProductWorkspaceId } from "./runtime/context";
import type { HostedBill, HostedBillOccurrence } from "./runtime/hosted-bills";

export type BillWorkspaceSummary = Readonly<{
  workspaceId: ProductWorkspaceId;
  bills: HostedBill[];
  occurrences: HostedBillOccurrence[];
}>;

export type ProjectedBillOccurrence = Readonly<{
  workspaceId: ProductWorkspaceId;
  bill: HostedBill;
  occurrence: HostedBillOccurrence;
}>;

export function billProjectionToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function billProjectionWorkspaceIds(
  viewingWorkspaceId: ProductWorkspaceId,
  authorizedWorkspaceIds: readonly ProductWorkspaceId[],
): ProductWorkspaceId[] {
  const authorized = new Set(authorizedWorkspaceIds);
  const desired: ProductWorkspaceId[] = viewingWorkspaceId === "personal"
    ? ["personal", "indelitech"]
    : ["indelitech"];
  return desired.filter((workspaceId) => authorized.has(workspaceId));
}

export function projectOpenBillOccurrences(summaries: readonly BillWorkspaceSummary[]): ProjectedBillOccurrence[] {
  const projected = summaries.flatMap((summary) => {
    const activeBills = new Map(
      summary.bills
        .filter((bill) => bill.status === "ACTIVE")
        .map((bill) => [bill.billId, bill] as const),
    );
    return summary.occurrences.flatMap((occurrence) => {
      if (occurrence.status !== "OPEN") return [];
      const bill = activeBills.get(occurrence.billId);
      return bill ? [{ workspaceId: summary.workspaceId, bill, occurrence }] : [];
    });
  });

  const workspaceRank: Record<ProductWorkspaceId, number> = { personal: 0, indelitech: 1 };
  return projected.toSorted((left, right) =>
    left.occurrence.dueDate.localeCompare(right.occurrence.dueDate) ||
    workspaceRank[left.workspaceId] - workspaceRank[right.workspaceId] ||
    left.bill.name.localeCompare(right.bill.name) ||
    left.occurrence.occurrenceId.localeCompare(right.occurrence.occurrenceId));
}

export function billOccurrencesNeedingAttentionToday(
  entries: readonly ProjectedBillOccurrence[],
  today = billProjectionToday(),
): ProjectedBillOccurrence[] {
  return entries.filter(({ occurrence }) => occurrence.dueDate <= today);
}

export function billOccurrenceIsOverdue(entry: ProjectedBillOccurrence, today = billProjectionToday()): boolean {
  return entry.occurrence.dueDate < today;
}
