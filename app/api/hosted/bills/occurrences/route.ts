import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedBillsRouteRuntime } from "@/lib/server/hosted-bills-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedBillsRouteRuntime(await getHostedBindings()).occurrences.GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    return await createHostedBillsRouteRuntime(await getHostedBindings()).occurrences.POST(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
