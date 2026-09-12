import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHostname } from "@/lib/runtime/browser-runtime";

function requestHostname(host: string) {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

function isSameOrigin(value: string, request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    requestUrl.host = request.headers.get("host") || requestUrl.host;
    return new URL(value).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const local = isLoopbackHostname(requestHostname(host));
  const allowedHostedPaths = new Set([
    "/api/hosted/workspace",
    "/api/hosted/tasks/mutations",
    "/api/hosted/tasks/capture",
  ]);
  if (!local && !allowedHostedPaths.has(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "This API is unavailable in hosted mode." },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
