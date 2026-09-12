import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeploy = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");

test("protected Cloudflare deployment accepts only the current merged PR revision", async () => {
  const deploy = await readDeploy();
  assert.match(deploy, /workflow_run:\s+workflows: \[Check\]\s+types: \[completed\]/);
  assert.match(deploy, /if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /run\.event !== 'pull_request' \|\| pullRequests\.length !== 1/);
  assert.match(deploy, /pullRequest\.merged_at/);
  assert.match(deploy, /pullRequest\.base\.ref === repository\.default_branch/);
  assert.match(deploy, /pullRequest\.head\.sha === run\.head_sha/);
  assert.match(deploy, /pullRequest\.merge_commit_sha === main\.commit\.sha/);
  assert.match(deploy, /context\.eventName === 'workflow_dispatch'[\s\S]+setOutput\('deploy_sha', main\.commit\.sha\)/);
  assert.match(deploy, /if: needs\.resolve-deploy-target\.outputs\.deploy_sha != ''/);
  assert.match(deploy, /ref: \$\{\{ needs\.resolve-deploy-target\.outputs\.deploy_sha \}\}/);
  assert.doesNotMatch(deploy, /pull_request:/);
});

test("production deploys serialize and retain the protected posture checks", async () => {
  const workflow = await readDeploy();
  assert.match(workflow, /group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s+contents: read\s+pull-requests: read/);
  assert.match(workflow, /deploy:\s+name:[\s\S]+env:\s+CLOUDFLARE_API_TOKEN:[\s\S]+CLOUDFLARE_ACCOUNT_ID:/);
  assert.match(workflow, /preview_urls must remain disabled/);
  assert.match(workflow, /Generated POLICY_AUD mismatch/);
  assert.match(workflow, /npm run deploy:vinext/);
  assert.match(workflow, /Unexpected MCP D1 binding/);
  assert.match(workflow, /npm run build:mcp/);
  assert.match(workflow, /npm run deploy:mcp/);
  assert.match(workflow, /MCP rejects every request unless its separate Access audience secret verifies/);
});
