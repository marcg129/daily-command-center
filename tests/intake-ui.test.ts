import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WORKSPACES } from "@/lib/workspace-ui";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Intake is a primary destination directly after Tasks in both workspaces", () => {
  assert.deepEqual(WORKSPACES.personal.navigation.map(({ label }) => label).slice(0, 4), ["Today", "Tasks", "Intake", "Calendar"]);
  assert.deepEqual(WORKSPACES.indelitech.navigation.map(({ label }) => label).slice(0, 4), ["Today", "Tasks", "Intake", "Calendar"]);
});

test("Intake view defaults to Pending and exposes durable review states without hiding evidence", () => {
  const view = source("components/intake-view.tsx");
  assert.match(view, /useState<[^>]*IntakeViewMode[^>]*>\("PENDING"\)/);
  for (const label of ["Pending", "Deferred", "Awareness", "History"]) assert.match(view, new RegExp(`>${label}<`));
  for (const evidence of ["classificationReason", "sourceTimestamp", "sourceSummary", "sourceKey", "workspaceKey"]) {
    assert.match(view, new RegExp(evidence));
  }
  assert.match(view, /Open source/);
});

test("review actions keep Awareness non-approvable and Bills out of bulk approval", () => {
  const view = source("components/intake-view.tsx");
  const hook = source("components/use-intake.ts");
  assert.match(view, /item\.intakeType !== "AWARENESS"/);
  assert.match(view, /item\.intakeType !== "BILL"/);
  assert.match(view, /Edit & Approve/);
  assert.match(view, /Defer/);
  assert.match(view, /Dismiss/);
  assert.match(view, /Archive/);
  assert.match(hook, /APPROVE_BULK/);
  assert.match(hook, /DISMISS_BULK/);
});

test("Intake All view is explicitly assembled from separate Personal and Indelitech reads", () => {
  const hook = source("components/use-intake.ts");
  assert.match(hook, /workspaceId=personal/);
  assert.match(hook, /workspaceId=indelitech/);
  assert.doesNotMatch(hook, /workspaceId=all/i);
});

test("Intake controls remain keyboard-native and cards retain visible workspace identity", () => {
  const view = source("components/intake-view.tsx");
  const css = source("components/intake-view.module.css");
  assert.match(view, /<button/);
  assert.match(view, /<label/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /workspaceLabel/);
  assert.match(css, /@media \(max-width:/);
  assert.doesNotMatch(css, /outline:\s*none/);
});
