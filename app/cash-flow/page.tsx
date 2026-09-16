import { CashFlowView } from "@/components/cash-flow-view";
import { parseWorkspaceId } from "@/lib/workspace-ui";

export default async function CashFlowPage(props: {
  searchParams?: Promise<{ workspaceId?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const requested = Array.isArray(searchParams?.workspaceId)
    ? searchParams?.workspaceId[0]
    : searchParams?.workspaceId;
  return <CashFlowView initialWorkspaceId={parseWorkspaceId(requested)} />;
}
