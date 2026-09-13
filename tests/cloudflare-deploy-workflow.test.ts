import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeploy = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");
const readBootstrap = () => readFile(new URL("../.github/workflows/cloudflare-bootstrap-grants.yml", import.meta.url), "utf8");

test("protected Cloudflare deployment accepts only the current merged PR revision", async () => {
  const deploy = await readDeploy();
  assert.match(deploy, /issue_comment:\s+types: \[created\]/);
  assert.match(deploy, /startsWith\(github\.event\.comment\.body, '\/deploy-current-main '\)/);
  assert.match(deploy, /\^\\\/deploy-current-main \(\[0-9a-f\]\{40\}\) \(\[0-9\]\+\)\$/);
  assert.match(deploy, /comment\.user\.login !== owner/);
  assert.match(deploy, /comment\.author_association !== 'OWNER'/);
  assert.match(deploy, /pullRequest\.merged_at/);
  assert.match(deploy, /pullRequest\.base\.ref === repository\.default_branch/);
  assert.match(deploy, /pullRequest\.head\.sha === checkRun\.head_sha/);
  assert.match(deploy, /pullRequest\.merge_commit_sha === requestedSha/);
  assert.match(deploy, /main\.commit\.sha === requestedSha/);
  assert.match(deploy, /checkRun\.name === 'Check'/);
  assert.match(deploy, /checkRun\.event === 'pull_request'/);
  assert.match(deploy, /checkRun\.status === 'completed'/);
  assert.match(deploy, /checkRun\.conclusion === 'success'/);
  assert.match(deploy, /context\.eventName === 'workflow_dispatch'[\s\S]+setOutput\('deploy_sha', main\.commit\.sha\)/);
  assert.match(deploy, /if: needs\.resolve-deploy-target\.outputs\.deploy_sha != ''/);
  assert.match(deploy, /ref: \$\{\{ needs\.resolve-deploy-target\.outputs\.deploy_sha \}\}/);
  assert.doesNotMatch(deploy, /pull_request:/);
});

test("production deploys serialize and retain the protected posture checks", async () => {
  const workflow = await readDeploy();
  assert.match(workflow, /group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s+actions: read\s+contents: read\s+issues: read\s+pull-requests: read/);
  assert.match(workflow, /deploy:\s+name:[\s\S]+env:\s+CLOUDFLARE_API_TOKEN:[\s\S]+CLOUDFLARE_ACCOUNT_ID:/);
  assert.match(workflow, /preview_urls must remain disabled/);
  assert.match(workflow, /Generated POLICY_AUD mismatch/);
  assert.match(workflow, /npm run deploy:vinext/);
  assert.match(workflow, /Unexpected MCP D1 binding/);
  assert.match(workflow, /npm run build:mcp/);
  assert.match(workflow, /npm run deploy:mcp/);
  assert.match(workflow, /MCP rejects every request unless its separate Access audience secret verifies/);
});

test("owner bootstrap provisions the canonical user and workspace membership model", async () => {
  const workflow = await readBootstrap();
  assert.match(workflow, /principal_id must be the verified cf-user:\* value returned by \/api\/hosted\/session/);
  assert.match(workflow, /INSERT OR IGNORE INTO users/);
  assert.match(workflow, /INSERT OR IGNORE INTO user_principals/);
  assert.match(workflow, /INSERT OR IGNORE INTO workspace_memberships/);
  assert.match(workflow, /'personal', 'OWNER'/);
  assert.match(workflow, /'indelitech', 'OWNER'/);
  assert.match(workflow, /JOIN workspace_memberships m ON m\.user_id = u\.user_id/);
  assert.doesNotMatch(workflow, /INSERT OR IGNORE INTO principal_workspace_grants/);
});
