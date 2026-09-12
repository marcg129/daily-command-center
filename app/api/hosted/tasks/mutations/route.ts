import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedTaskRouteRuntime } from "@/lib/server/hosted-task-route-runtime";

export async function POST(request: Request) {
  try {
    return await createHostedTaskRouteRuntime(await getHostedBindings()).POST(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500 });
  }
}
