import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");

test("protected Cloudflare deployment follows only successful main Check runs", async () => {
  const workflow = await read();
  assert.match(workflow, /workflow_run:\s+workflows: \[Check\]\s+types: \[completed\]\s+branches: \[main\]/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
});

test("production deploys serialize and retain the protected posture checks", async () => {
  const workflow = await read();
  assert.match(workflow, /group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow, /preview_urls must remain disabled/);
  assert.match(workflow, /Generated POLICY_AUD mismatch/);
  assert.match(workflow, /npm run deploy:vinext/);
  assert.match(workflow, /Unexpected MCP D1 binding/);
  assert.match(workflow, /npm run build:mcp/);
  assert.match(workflow, /npm run deploy:mcp/);
  assert.match(workflow, /MCP rejects every request unless its separate Access audience secret verifies/);
});
