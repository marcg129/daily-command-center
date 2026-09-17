import type { BillDefinitionCore } from "./bills";
import type { HostedIntakeItem } from "./intake-repository";
import type { StructuredTaskCapture } from "./task-capture";

export class IntakeApprovalValidationError extends Error {}
export class IntakeApprovalConflictError extends Error {}

export function taskCaptureFromIntake(item: HostedIntakeItem): StructuredTaskCapture {
  if (item.intakeType !== "TASK" && item.intakeType !== "FOLLOW_UP") {
    throw new IntakeApprovalValidationError("Only Task or Follow-up Intake items can create canonical Tasks.");
  }
  return {
    requestId: `intake:${item.intakeId}`,
    workspaceId: item.workspaceKey,
    title: item.title,
    context: item.classificationReason,
    type: item.intakeType === "FOLLOW_UP" ? "FOLLOW_UP" : undefined,
    priority: item.priority ?? undefined,
    due: item.dueDate ?? undefined,
    followUpAt: item.followUpAt ?? undefined,
    sourceContext: item.sourceSummary,
  };
}

export function billDefinitionFromIntake(item: HostedIntakeItem): BillDefinitionCore {
  if (item.intakeType !== "BILL") {
    throw new IntakeApprovalValidationError("Only Bill Intake items can create canonical Bills.");
  }
  if (!item.dueDate) throw new IntakeApprovalValidationError("Bill Intake requires a due date before approval.");
  if (item.amountMinor == null) throw new IntakeApprovalValidationError("Bill Intake requires an amount before approval.");
  if (!item.currency) throw new IntakeApprovalValidationError("Bill Intake requires a currency before approval.");

  const schedule = item.recurrence ?? {
    scheduleStartDate: item.dueDate,
    recurrenceUnit: "NONE" as const,
    recurrenceInterval: 1,
    recurrenceDayMode: null,
  };

  return {
    name: item.title,
    payee: null,
    category: null,
    amountMode: "FIXED",
    defaultAmountMinor: item.amountMinor,
    currency: item.currency,
    autopay: false,
    paymentUrl: null,
    notes: item.sourceSummary,
    scheduleStartDate: schedule.scheduleStartDate,
    recurrenceUnit: schedule.recurrenceUnit,
    recurrenceInterval: schedule.recurrenceInterval,
    recurrenceDayMode: schedule.recurrenceDayMode,
    reminderDaysBefore: null,
    status: "ACTIVE",
  };
}
