import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedEventsRouteRuntime } from "@/lib/server/hosted-events-route-runtime";

function unavailable() {
  return Response.json(
    { error: "Hosted runtime is unavailable." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    return await createHostedEventsRouteRuntime(await getHostedBindings()).GET(request);
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: Request) {
  try {
    return await createHostedEventsRouteRuntime(await getHostedBindings()).PATCH(request);
  } catch {
    return unavailable();
  }
}
