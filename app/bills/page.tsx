import { BillsView } from "@/components/bills-view";
import { parseWorkspaceId } from "@/lib/workspace-ui";

export default async function BillsPage(props: {
  searchParams?: Promise<{ workspaceId?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const requested = Array.isArray(searchParams?.workspaceId)
    ? searchParams?.workspaceId[0]
    : searchParams?.workspaceId;
  return <BillsView initialWorkspaceId={parseWorkspaceId(requested)} />;
}
