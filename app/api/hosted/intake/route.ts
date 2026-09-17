import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedIntakeRouteRuntime } from "@/lib/server/hosted-intake-route-runtime";

function unavailable() {
  return Response.json(
    { error: "Hosted runtime is unavailable." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    return await createHostedIntakeRouteRuntime(await getHostedBindings()).intake.GET(request);
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: Request) {
  try {
    return await createHostedIntakeRouteRuntime(await getHostedBindings()).intake.PATCH(request);
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  try {
    return await createHostedIntakeRouteRuntime(await getHostedBindings()).intake.POST(request);
  } catch {
    return unavailable();
  }
}
