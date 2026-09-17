import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedIntakeRouteRuntime } from "@/lib/server/hosted-intake-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedIntakeRouteRuntime(await getHostedBindings()).status.GET(request);
  } catch {
    return Response.json(
      { error: "Hosted runtime is unavailable." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
