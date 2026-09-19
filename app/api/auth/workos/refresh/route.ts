import { getHostedBindings } from "@/lib/server/cloudflare-worker-bindings";
import { createWorkOSBrowserAuthHandlers } from "@/lib/server/workos-browser-auth";

export async function POST(request: Request) {
  try {
    return await createWorkOSBrowserAuthHandlers(await getHostedBindings()).refresh(request);
  } catch {
    return Response.json({ error: "Authentication is unavailable." }, { status: 503 });
  }
}
