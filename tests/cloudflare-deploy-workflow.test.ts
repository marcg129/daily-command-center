import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");

test("protected Cloudflare deployment follows merged main PRs, including API-driven merges", async () => {
  const workflow = await read();
  assert.match(workflow, /pull_request:\s+types: \[closed\]\s+branches: \[main\]/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /API-driven merges that do not emit a follow-up push workflow/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.(merged|merge_commit_sha)/);
  assert.doesNotMatch(workflow, /workflow_run:/);
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
