import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedIntelRouteRuntime } from "@/lib/server/hosted-intel-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedIntelRouteRuntime(await getHostedBindings()).GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500 });
  }
}
