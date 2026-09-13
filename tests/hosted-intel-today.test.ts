import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted Indelitech Today shows three Intel highlights without changing Personal Today", async () => {
  const controlCenter = await readFile(new URL("../components/control-center.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/hosted-intel-today.tsx", import.meta.url), "utf8");

  assert.match(controlCenter, /!personal && <HostedIntelTodayPanel/);
  assert.match(controlCenter, /onOpenIntel=\{\(\) => goTo\("industry"\)\}/);
  assert.match(controlCenter, /latest hosted Intel highlights/);
  assert.match(panel, /const TODAY_INTEL_LIMIT = 3;/);
  assert.match(panel, /items\.slice\(0, TODAY_INTEL_LIMIT\)/);
});

test("Today Intel reads only the protected hosted snapshot and preserves isolated new-tab links", async () => {
  const panel = await readFile(new URL("../components/hosted-intel-today.tsx", import.meta.url), "utf8");

  assert.match(panel, /fetch\("\/api\/hosted\/intel\?workspaceId=indelitech"/);
  assert.match(panel, /credentials: "same-origin"/);
  assert.match(panel, /target="_blank"/);
  assert.match(panel, /rel="noreferrer noopener"/);
  assert.doesNotMatch(panel, /api\/live\/industry|api\/settings|window\.location/);
});

test("Today Intel handles loading, empty, stale, and read failure without blocking task work", async () => {
  const panel = await readFile(new URL("../components/hosted-intel-today.tsx", import.meta.url), "utf8");

  assert.match(panel, /Loading the latest protected Intel snapshot/);
  assert.match(panel, /No current Intel highlights are available yet/);
  assert.match(panel, /Snapshot is stale/);
  assert.match(panel, /if \(load\.state === "error"\) return null/);
});
