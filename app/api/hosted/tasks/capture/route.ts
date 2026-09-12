import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createHostedTaskCaptureRuntime } from "@/lib/server/hosted-task-capture-runtime";

export async function POST(request: Request) {
  try {
    return await createHostedTaskCaptureRuntime(await getHostedBindings()).call(null, request);
  } catch {
    return Response.json({ error: "Hosted runtime is unavailable." }, { status: 500 });
  }
}
