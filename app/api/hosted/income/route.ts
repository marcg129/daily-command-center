import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedIncomeRouteRuntime } from "@/lib/server/hosted-income-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).income.GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).income.POST(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  try {
    return await createHostedIncomeRouteRuntime(await getHostedBindings()).income.PATCH(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
