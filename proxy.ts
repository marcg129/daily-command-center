import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHostname } from "@/lib/runtime/browser-runtime";

function requestHostname(request: NextRequest) {
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

function isSameOrigin(value: string, request: NextRequest, local: boolean) {
  try {
    const requestUrl = new URL(request.url);
    if (local) {
      const localHost = request.headers.get("host");
      if (localHost) requestUrl.host = localHost;
    }
    return new URL(value).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const local = isLoopbackHostname(requestHostname(request));
  const allowedHostedPaths = new Set([
    "/api/hosted/session",
    "/api/hosted/workspace",
    "/api/hosted/tasks/mutations",
    "/api/hosted/tasks/capture",
    "/api/hosted/intel",
    "/api/hosted/bills",
    "/api/hosted/bills/occurrences",
    "/api/hosted/income",
    "/api/hosted/income/occurrences",
    "/api/hosted/cashflow/baseline",
    "/api/hosted/intake",
    "/api/hosted/intake/status",
    "/api/hosted/events",
  ]);
  if (!local && !allowedHostedPaths.has(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "This API is unavailable in hosted mode." },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request, local)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
