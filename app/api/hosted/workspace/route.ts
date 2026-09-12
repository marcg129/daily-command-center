import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedTaskRouteRuntime } from "@/lib/server/hosted-task-route-runtime";

export async function GET(request: Request) {
  try {
    return await createHostedTaskRouteRuntime(await getHostedBindings()).GET(request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500 });
  }
}
