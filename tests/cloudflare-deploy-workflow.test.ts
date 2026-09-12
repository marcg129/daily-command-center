import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeploy = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");
const readCheck = () => readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");

test("protected Cloudflare deployment follows successful main checks, including API-driven merges", async () => {
  const [deploy, check] = await Promise.all([readDeploy(), readCheck()]);
  assert.match(check, /pull_request:\s+types: \[opened, synchronize, reopened, closed\]/);
  assert.match(check, /push:\s+branches-ignore: \[main\]/);
  assert.match(check, /API-driven merges still validate the resulting main SHA/);
  assert.match(deploy, /workflow_run:\s+workflows: \[Check\]\s+types: \[completed\]\s+branches: \[main\]/);
  assert.match(deploy, /if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.doesNotMatch(deploy, /pull_request:/);
});

test("production deploys serialize and retain the protected posture checks", async () => {
  const workflow = await readDeploy();
  assert.match(workflow, /group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow, /preview_urls must remain disabled/);
  assert.match(workflow, /Generated POLICY_AUD mismatch/);
  assert.match(workflow, /npm run deploy:vinext/);
  assert.match(workflow, /Unexpected MCP D1 binding/);
  assert.match(workflow, /npm run build:mcp/);
  assert.match(workflow, /npm run deploy:mcp/);
  assert.match(workflow, /MCP rejects every request unless its separate Access audience secret verifies/);
});
