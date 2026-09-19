import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createWorkOSBrowserAuthHandlers } from "@/lib/server/workos-browser-auth";

export async function GET(request: Request) {
  try {
    return await createWorkOSBrowserAuthHandlers(await getHostedBindings()).callback(request);
  } catch {
    return Response.json({ error: "Authentication is unavailable." }, { status: 503 });
  }
}
