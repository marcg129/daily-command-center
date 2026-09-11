import { BriefcaseBusiness, Check, UserRound } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { WORKSPACE_OPTIONS } from "@/lib/workspace-ui";

export function WorkspaceSwitcher({
  value,
  onChange,
}: {
  value: ProductWorkspaceId;
  onChange: (workspaceId: ProductWorkspaceId) => void;
}) {
  return (
    <div className="workspace-switcher" role="group" aria-label="Choose workspace">
      {WORKSPACE_OPTIONS.map((workspace) => {
        const active = workspace.id === value;
        const Icon = workspace.workspaceType === "PERSONAL" ? UserRound : BriefcaseBusiness;
        return (
          <button
            key={workspace.id}
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            onClick={() => onChange(workspace.id)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{workspace.displayName}</span>
            {active && <Check className="workspace-check" size={12} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
