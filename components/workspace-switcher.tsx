import Link from "next/link";
import { BriefcaseBusiness, Check, CircleDollarSign, UserRound, WalletCards } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  WORKSPACE_OPTIONS,
  type WorkspacePresentation,
} from "@/lib/workspace-ui";

const financeLinkStyle = {
  minHeight: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "0 9px",
  borderLeft: "1px solid var(--line)",
  color: "var(--muted)",
  fontSize: 10,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;

export function WorkspaceSwitcher({
  value,
  onChange,
  options = WORKSPACE_OPTIONS,
  showBillsLink = true,
  showCashFlowLink = true,
}: {
  value: ProductWorkspaceId;
  onChange: (workspaceId: ProductWorkspaceId) => void;
  options?: readonly WorkspacePresentation[];
  showBillsLink?: boolean;
  showCashFlowLink?: boolean;
}) {
  const hasFinanceLinks = showBillsLink || showCashFlowLink;
  return (
    <div
      className="workspace-switcher"
      role="group"
      aria-label={hasFinanceLinks ? "Choose workspace or open a financial surface" : "Choose workspace"}
    >
      {options.map((workspace) => {
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
      {showBillsLink && (
        <Link
          href={`/bills?workspaceId=${encodeURIComponent(value)}`}
          aria-label={`Open ${value === "personal" ? "Personal" : "Indelitech"} Bills`}
          style={financeLinkStyle}
        >
          <WalletCards size={14} aria-hidden="true" />
          <span>Bills</span>
        </Link>
      )}
      {showCashFlowLink && (
        <Link
          href={`/cash-flow?workspaceId=${encodeURIComponent(value)}`}
          aria-label={`Open ${value === "personal" ? "Personal" : "Indelitech"} Cash Flow`}
          style={financeLinkStyle}
        >
          <CircleDollarSign size={14} aria-hidden="true" />
          <span>Cash Flow</span>
        </Link>
      )}
    </div>
  );
}
