import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedIncomeRouteRuntime } from "@/lib/server/hosted-income-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).baseline.GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).baseline.PUT(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).baseline.DELETE(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
