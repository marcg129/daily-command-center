import { BriefcaseBusiness, Check, UserRound, WalletCards } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  WORKSPACE_OPTIONS,
  type WorkspacePresentation,
} from "@/lib/workspace-ui";

export function WorkspaceSwitcher({
  value,
  onChange,
  options = WORKSPACE_OPTIONS,
  showBillsLink = true,
}: {
  value: ProductWorkspaceId;
  onChange: (workspaceId: ProductWorkspaceId) => void;
  options?: readonly WorkspacePresentation[];
  showBillsLink?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div
        className="workspace-switcher"
        role="group"
        aria-label="Choose workspace"
      >
        {options.map((workspace) => {
          const active = workspace.id === value;
          const Icon =
            workspace.workspaceType === "PERSONAL"
              ? UserRound
              : BriefcaseBusiness;
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
              {active && (
                <Check className="workspace-check" size={12} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      {showBillsLink && (
        <a
          className="button button-ghost"
          href={`/bills?workspaceId=${encodeURIComponent(value)}`}
          aria-label={`Open ${value === "personal" ? "Personal" : "Indelitech"} Bills`}
          style={{ minHeight: 42, paddingInline: 11, textDecoration: "none" }}
        >
          <WalletCards size={14} aria-hidden="true" />
          Bills
        </a>
      )}
    </div>
  );
}
