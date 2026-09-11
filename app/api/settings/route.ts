import type { SettingsUpdate } from "@/lib/types";
import { legacyRequestContext } from "@/lib/runtime/context";
import { localSettingsService } from "@/lib/server/local-settings-adapters";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await localSettingsService.publicSettings(legacyRequestContext()));
}

export async function PUT(request: Request) {
  try {
    const update = await request.json() as SettingsUpdate;
    return Response.json(await localSettingsService.update(legacyRequestContext(), update));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("connection") !== "gmail") return Response.json({ error: "Unknown connection." }, { status: 400 });
  await localSettingsService.disconnectGmail(legacyRequestContext());
  return Response.json({ ok: true });
}
