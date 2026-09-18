import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("hosted Intel route delegates only to the hosted runtime", () => {
  const route = source("app/api/hosted/intel/route.ts");
  assert.match(route, /createHostedIntelRouteRuntime/);
  assert.match(route, /getHostedBindings/);
  assert.doesNotMatch(route, /api\/live\/industry|readSettings|getDatabase/);
});

test("hosted Intel runtime composes shared hosted authentication with D1 authorization and collector storage", () => {
  const runtime = source("lib/server/hosted-intel-route-runtime.ts");
  assert.match(runtime, /createHostedAuthenticationSessionProvider/);
  assert.match(runtime, /D1WorkspaceResolver/);
  assert.match(runtime, /D1CollectorSnapshotRepository/);
  assert.doesNotMatch(runtime, /LocalCollector|LocalSettings|legacyRequestContext/);
});

test("hosted Intel UI uses only the hosted namespaced route", () => {
  const view = source("components/hosted-intel-snapshot.tsx");
  const shell = source("components/workspace-page-shell.tsx");
  assert.match(view, /\/api\/hosted\/intel\?workspaceId=indelitech/);
  assert.doesNotMatch(view, /\/api\/live\/industry|\/api\/settings/);
  assert.match(shell, /Indelitech · Intel/);
  assert.match(shell, /HostedIntelSnapshotView/);
});
