import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createWorkOSPrincipalLinkRouteRuntime } from "@/lib/server/workos-principal-link-route-runtime";

export async function POST(request: Request) {
  try {
    return await createWorkOSPrincipalLinkRouteRuntime(
      await getHostedBindings(),
    ).POST(request);
  } catch {
    return Response.json(
      { error: "Identity linking is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
