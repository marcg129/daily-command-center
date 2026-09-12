import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedSessionRouteRuntime } from "@/lib/server/hosted-session-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedSessionRouteRuntime(await getHostedBindings()).GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500 });
  }
}
