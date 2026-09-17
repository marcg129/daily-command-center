import assert from "node:assert/strict";
import test from "node:test";
import { isProductWorkspaceId } from "../lib/runtime/context";
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACES,
  WORKSPACE_OPTIONS,
  parseWorkspaceId,
} from "../lib/workspace-ui";

test("the UI accepts only the two canonical product workspace IDs", () => {
  assert.deepEqual(WORKSPACE_OPTIONS.map(({ id }) => id), ["personal", "indelitech"]);
  assert.equal(isProductWorkspaceId("personal"), true);
  assert.equal(isProductWorkspaceId("indelitech"), true);
  for (const value of ["legacy-local", "business", "home", "", null, undefined]) {
    assert.equal(isProductWorkspaceId(value), false);
  }
});

test("invalid persisted selections fall back to Personal", () => {
  assert.equal(DEFAULT_WORKSPACE_ID, "personal");
  assert.equal(parseWorkspaceId("personal"), "personal");
  assert.equal(parseWorkspaceId("indelitech"), "indelitech");
  assert.equal(parseWorkspaceId("stale-workspace"), "personal");
  assert.equal(parseWorkspaceId(null), "personal");
});

test("Personal primary navigation is the exact V1 set", () => {
  assert.deepEqual(WORKSPACES.personal.navigation.map(({ label }) => label), [
    "Today", "Tasks", "Intake", "Calendar", "News", "Settings",
  ]);
  assert.equal(WORKSPACES.personal.navigation.some(({ label }) => label === "Mentions"), false);
});

test("Indelitech primary navigation is the exact V1 set", () => {
  assert.deepEqual(WORKSPACES.indelitech.navigation.map(({ label }) => label), [
    "Today", "Tasks", "Intake", "Calendar", "Intel", "Mentions", "Settings",
  ]);
  assert.equal(WORKSPACES.indelitech.navigation.some(({ label }) => label === "News"), false);
});

test("Reminders is absent from every V1 primary navigation", () => {
  for (const workspace of WORKSPACE_OPTIONS) {
    assert.equal(workspace.navigation.some(({ label }) => label === "Reminders"), false);
  }
});

test("workspace themes match the canonical database seeds", () => {
  assert.equal(WORKSPACES.personal.themeKey, "personal-tech-blue");
  assert.equal(WORKSPACES.indelitech.themeKey, "indelitech-business");
});
