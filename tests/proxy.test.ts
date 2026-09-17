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

test("hosted proxy allows only the exact hosted MVP routes", () => {
  for (const path of [
    "/api/hosted/session",
    "/api/hosted/workspace?workspaceId=personal",
    "/api/hosted/tasks/mutations?workspaceId=personal",
    "/api/hosted/tasks/capture?workspaceId=personal",
    "/api/hosted/intel?workspaceId=indelitech",
    "/api/hosted/bills?workspaceId=personal",
    "/api/hosted/bills/occurrences?workspaceId=personal",
    "/api/hosted/income?workspaceId=personal",
    "/api/hosted/income/occurrences?workspaceId=personal",
    "/api/hosted/cashflow/baseline?workspaceId=personal",
    "/api/hosted/intake?workspaceId=personal&view=PENDING",
    "/api/hosted/intake/status?workspaceId=personal",
    "/api/hosted/events?workspaceId=personal&fromDate=2026-09-17&throughDate=2026-10-31",
  ]) assert.equal(proxy(hostedRequest(path)).status, 200);
  for (const path of [
    "/api/settings",
    "/api/workspace",
    "/api/hosted/other",
    "/api/hosted/workspace/extra",
    "/api/hosted/session/extra",
    "/api/hosted/intel/extra",
    "/api/hosted/bills/extra",
    "/api/hosted/bills/occurrences/extra",
    "/api/hosted/income/extra",
    "/api/hosted/income/occurrences/extra",
    "/api/hosted/cashflow/baseline/extra",
    "/api/hosted/intake/extra",
    "/api/hosted/intake/status/extra",
    "/api/hosted/events/extra",
  ]) assert.equal(proxy(hostedRequest(path)).status, 403);
});

test("hosted proxy rejects cross-origin browser calls but permits no-Origin service calls", () => {
  for (const path of [
    "/api/hosted/workspace?workspaceId=personal",
    "/api/hosted/intel?workspaceId=indelitech",
    "/api/hosted/bills?workspaceId=personal",
    "/api/hosted/bills/occurrences?workspaceId=personal",
    "/api/hosted/income?workspaceId=personal",
    "/api/hosted/income/occurrences?workspaceId=personal",
    "/api/hosted/cashflow/baseline?workspaceId=personal",
    "/api/hosted/intake?workspaceId=personal&view=PENDING",
    "/api/hosted/intake/status?workspaceId=personal",
    "/api/hosted/events?workspaceId=personal&fromDate=2026-09-17&throughDate=2026-10-31",
  ]) {
    assert.equal(proxy(hostedRequest(path, "https://command.example.com")).status, 200);
    assert.equal(proxy(hostedRequest(path, "https://evil.example.com")).status, 403);
    assert.equal(proxy(hostedRequest(path)).status, 200);
  }
  const path = "/api/hosted/workspace?workspaceId=personal";
  assert.equal(proxy(new NextRequest(`https://command.example.com${path}`, {
    headers: { host: "command.example.com", "x-principal-id": "pretend-admin" },
  })).status, 200, "proxy does not treat client identity as auth; the route still verifies Access JWT and grants");
});

test("public request URL cannot be downgraded to local mode by spoofing Host", () => {
  const legacy = new NextRequest("https://command.example.com/api/settings", {
    headers: { host: "localhost:3000" },
  });
  assert.equal(proxy(legacy).status, 403);

  const hostedCrossSite = new NextRequest("https://command.example.com/api/hosted/workspace?workspaceId=personal", {
    headers: { host: "evil.example.com", origin: "https://evil.example.com" },
  });
  assert.equal(proxy(hostedCrossSite).status, 403);
});
