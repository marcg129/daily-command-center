import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function text(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const worker = text("../workers/todoist-task-ingress.ts");
const deploymentUrl = new URL("../.github/workflows/cloudflare-todoist-deploy.yml", import.meta.url);

test("Todoist Worker stays safely inactive until both runtime secrets exist", () => {
  assert.match(worker, /TODOIST_API_TOKEN/);
  assert.match(worker, /DCC_USER_ID/);
  assert.match(worker, /Todoist task ingress inactive: required runtime bindings are missing\./);
  assert.match(worker, /return;/);
});

test("Todoist deployment is isolated from the main web deployment", () => {
  assert.equal(existsSync(deploymentUrl), true, "dedicated Todoist deployment workflow must exist");
  const deployment = text("../.github/workflows/cloudflare-todoist-deploy.yml");
  const mainDeployment = text("../.github/workflows/cloudflare-protected-deploy.yml");

  assert.match(deployment, /^name: Cloudflare deploy Todoist ingress/m);
  assert.match(deployment, /cloudflare-production/);
  assert.match(deployment, /\/deploy-todoist-current-main/);
  assert.match(deployment, /pullRequest\.merged_at/);
  assert.match(deployment, /checkRun\.event === 'pull_request'/);
  assert.match(deployment, /checkRun\.conclusion === 'success'/);
  assert.match(deployment, /main\.commit\.sha === requestedSha/);
  assert.match(deployment, /npm run build:todoist/);
  assert.match(deployment, /npm run deploy:todoist/);
  assert.doesNotMatch(deployment, /deploy:vinext|deploy:intel|deploy:mcp/);
  assert.doesNotMatch(mainDeployment, /deploy:todoist/);
});

test("Todoist deployment validates private cron posture before deploy", () => {
  const deployment = text("../.github/workflows/cloudflare-todoist-deploy.yml");
  assert.match(deployment, /daily-command-center-todoist-ingress/);
  assert.match(deployment, /workers\/todoist-task-ingress\.ts/);
  assert.match(deployment, /Todoist Worker must not expose workers\.dev/);
  assert.match(deployment, /Todoist preview URLs must remain disabled/);
  assert.match(deployment, /Unexpected Todoist D1 binding/);
  assert.match(deployment, /Unexpected Todoist cron schedule/);
  assert.match(deployment, /Unexpected Todoist project binding/);
});

test("deployment never sources Todoist credentials or DCC identity from GitHub secrets", () => {
  const deployment = text("../.github/workflows/cloudflare-todoist-deploy.yml");
  assert.doesNotMatch(deployment, /secrets\.TODOIST_API_TOKEN/);
  assert.doesNotMatch(deployment, /secrets\.DCC_USER_ID/);
  assert.match(deployment, /Cloudflare Worker secrets/);
});
