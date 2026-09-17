import { requireHostedWorkspaceInstance, type RequestContext } from "@/lib/runtime/context";
import { createHostedStructuredTaskCaptureService } from "@/lib/runtime/hosted-task-capture";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { BillDefinitionCore } from "@/lib/runtime/bills";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";
import {
  billDefinitionFromIntake,
  IntakeApprovalConflictError,
  IntakeApprovalValidationError,
  taskCaptureFromIntake,
} from "@/lib/runtime/intake-approval";
import type { HostedIntakeItem, IntakeRepository } from "@/lib/runtime/intake-repository";
import type { Clock } from "@/lib/runtime/primitives";

export type IntakeBillCreateOptions = Readonly<{ sourceIntakeId?: string }>;
export interface IntakeBillRepository {
  create(
    core: BillDefinitionCore,
    options?: IntakeBillCreateOptions,
  ): Promise<Readonly<{ bill: HostedBill; occurrences: HostedBillOccurrence[] }>>;
}

type Dependencies = Readonly<{
  intakeRepository: IntakeRepository;
  taskRepository: HostedTaskRepository;
  billRepositoryForContext: (context: RequestContext) => IntakeBillRepository;
  clock: Clock;
}>;

function requireApprovable(item: HostedIntakeItem, context: RequestContext): void {
  const instance = requireHostedWorkspaceInstance(context);
  if (item.userId !== instance.userId || item.workspaceKey !== instance.workspaceKey) {
    throw new IntakeApprovalValidationError("Intake approval workspace access denied.");
  }
  if (item.status === "DISMISSED" || item.status === "ARCHIVED") {
    throw new IntakeApprovalConflictError("Intake item is in a terminal state.");
  }
  if (item.intakeType === "AWARENESS") {
    throw new IntakeApprovalValidationError("Awareness items cannot be approved.");
  }
}

export function createIntakeApprovalService({
  intakeRepository,
  taskRepository,
  billRepositoryForContext,
  clock,
}: Dependencies) {
  const captureTask = createHostedStructuredTaskCaptureService(taskRepository, clock);

  return async function approve(context: RequestContext, intakeId: string): Promise<HostedIntakeItem> {
    const item = await intakeRepository.get(context, intakeId);
    if (!item) throw new IntakeApprovalValidationError("Intake item not found.");
    requireApprovable(item, context);

    if (item.status === "APPROVED") {
      if (!item.approvedTargetKind || !item.approvedTargetId) {
        throw new IntakeApprovalConflictError("Approved Intake item is missing its canonical target.");
      }
      return item;
    }

    if (item.intakeType === "TASK" || item.intakeType === "FOLLOW_UP") {
      const result = await captureTask(context, taskCaptureFromIntake(item));
      return intakeRepository.markApproved(context, item.intakeId, { kind: "TASK", id: result.task.taskId });
    }

    const bills = billRepositoryForContext(context);
    const result = await bills.create(billDefinitionFromIntake(item), { sourceIntakeId: item.intakeId });
    return intakeRepository.markApproved(context, item.intakeId, { kind: "BILL", id: result.bill.billId });
  };
}
