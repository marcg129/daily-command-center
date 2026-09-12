import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function apiRequest(origin?: string) {
  return new NextRequest("http://127.0.0.1:3000/api/brief", {
    headers: {
      host: "127.0.0.1:3000",
      ...(origin ? { origin } : {}),
    },
  });
}

function hostedRequest(path: string, origin?: string) {
  return new NextRequest(`https://command.example.com${path}`, {
    headers: { host: "command.example.com", ...(origin ? { origin } : {}) },
  });
}

test("proxy allows browser requests only from the exact API origin", () => {
  assert.equal(proxy(apiRequest("http://127.0.0.1:3000")).status, 200);
  assert.equal(proxy(apiRequest("http://127.0.0.1:3001")).status, 403);
  assert.equal(proxy(apiRequest("http://localhost:3000")).status, 403);
  assert.equal(proxy(apiRequest("https://127.0.0.1:3000")).status, 403);
});

test("proxy allows local CLI requests without an Origin header", () => {
  assert.equal(proxy(apiRequest()).status, 200);
});

test("hosted proxy allows only the exact task MVP routes", () => {
  for (const path of [
    "/api/hosted/workspace?workspaceId=personal",
    "/api/hosted/tasks/mutations?workspaceId=personal",
    "/api/hosted/tasks/capture?workspaceId=personal",
  ]) assert.equal(proxy(hostedRequest(path)).status, 200);
  for (const path of ["/api/settings", "/api/workspace", "/api/hosted/other", "/api/hosted/workspace/extra"])
    assert.equal(proxy(hostedRequest(path)).status, 403);
});

test("hosted proxy rejects cross-origin browser calls but permits no-Origin service calls", () => {
  const path = "/api/hosted/workspace?workspaceId=personal";
  assert.equal(proxy(hostedRequest(path, "https://command.example.com")).status, 200);
  assert.equal(proxy(hostedRequest(path, "https://evil.example.com")).status, 403);
  assert.equal(proxy(hostedRequest(path)).status, 200);
  assert.equal(proxy(new NextRequest(`https://command.example.com${path}`, {
    headers: { host: "command.example.com", "x-principal-id": "pretend-admin" },
  })).status, 200, "proxy does not treat client identity as auth; the route still verifies Access JWT and grants");
});
