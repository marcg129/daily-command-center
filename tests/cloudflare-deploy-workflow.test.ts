import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeploy = () => readFile(new URL("../.github/workflows/cloudflare-protected-deploy.yml", import.meta.url), "utf8");
const readCheck = () => readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");
const readBootstrap = () => readFile(new URL("../.github/workflows/cloudflare-bootstrap-grants.yml", import.meta.url), "utf8");
const readTodoistDeploy = () => readFile(new URL("../.github/workflows/cloudflare-todoist-deploy.yml", import.meta.url), "utf8");
const readWebWrangler = () => readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const readMcpWrangler = () => readFile(new URL("../wrangler.mcp.jsonc", import.meta.url), "utf8");
const readSmoke = () => readFile(new URL("../scripts/smoke.mjs", import.meta.url), "utf8");

test("protected Cloudflare deployment accepts only the current merged PR revision", async () => {
  const deploy = await readDeploy();
  assert.match(deploy, /issue_comment:\s+types: \[created\]/);
  assert.match(deploy, /resolve-deploy-target:[\s\S]+if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event\.issue\.pull_request && github\.event\.comment\.user\.login == github\.repository_owner && github\.event\.comment\.author_association == 'OWNER' && startsWith\(github\.event\.comment\.body, '\/deploy-current-main '\)\)/);
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

test("production deploys serialize and retain the protected custom-domain posture checks", async () => {
  const workflow = await readDeploy();
  assert.match(workflow, /'cloudflare-production' \|\| format\('cloudflare-noop-\{0\}', github\.run_id\)/);
  assert.match(workflow, /github\.event\.comment\.user\.login == github\.repository_owner/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /startsWith\(github\.event\.comment\.body, '\/deploy-current-main '\)/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s+actions: read\s+contents: read\s+issues: read\s+pull-requests: read/);
  assert.match(workflow, /deploy:\s+name: deploy Access-protected web Worker[\s\S]+env:\s+CLOUDFLARE_API_TOKEN:[\s\S]+CLOUDFLARE_ACCOUNT_ID:/);
  assert.match(workflow, /command\.coreyg\.dev/);
  assert.match(workflow, /Unexpected web Worker Custom Domain/);
  assert.match(workflow, /Generated Custom Domain mismatch/);
  assert.match(workflow, /workers_dev must remain enabled as the Access-protected rollback path during 1G-C cutover/);
  assert.match(workflow, /preview_urls must remain disabled/);
  assert.match(workflow, /Generated POLICY_AUD mismatch/);
  assert.match(workflow, /npm run deploy:vinext/);
  assert.match(workflow, /MCP Worker must remain independent from the web Custom Domain/);
  assert.match(workflow, /Unexpected MCP D1 binding/);
  assert.match(workflow, /npm run build:mcp/);
  assert.match(workflow, /npm run deploy:mcp/);
  assert.match(workflow, /Task-capture MCP remains on its separate hostname/);
  assert.doesNotMatch(workflow, /report-deploy-result:/);
  assert.doesNotMatch(workflow, /github\.rest\.issues\.createComment/);
});

test("Todoist deploy queues only owner-authorized deploy commands with production", async () => {
  const workflow = await readTodoistDeploy();
  assert.match(workflow, /'cloudflare-production' \|\| format\('cloudflare-noop-\{0\}', github\.run_id\)/);
  assert.match(workflow, /github\.event\.comment\.user\.login == github\.repository_owner/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /resolve-deploy-target:[\s\S]+if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event\.issue\.pull_request && github\.event\.comment\.user\.login == github\.repository_owner && github\.event\.comment\.author_association == 'OWNER' && startsWith\(github\.event\.comment\.body, '\/deploy-todoist-current-main '\)\)/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /\^\\\/deploy-todoist-current-main \(\[0-9a-f\]\{40\}\) \(\[0-9\]\+\)\$/);
  assert.match(workflow, /pullRequest\.merge_commit_sha === requestedSha/);
  assert.match(workflow, /main\.commit\.sha === requestedSha/);
  assert.match(workflow, /checkRun\.conclusion === 'success'/);
});

test("pull request CI proves the generated vinext artifact keeps the custom domain", async () => {
  const check = await readCheck();
  assert.match(check, /Build vinext deployment artifact[\s\S]+npm run build:vinext/);
  assert.match(check, /Verify generated web Custom Domain/);
  assert.match(check, /command\.coreyg\.dev/);
  assert.match(check, /Generated Custom Domain mismatch/);
  assert.match(check, /matrix\.os == 'ubuntu-latest'/);
});

test("launcher smoke exercises hosted Intake and Events route posture without Cloudflare bindings", async () => {
  const smoke = await readSmoke();
  assert.match(smoke, /\/api\/hosted\/intake\?workspaceId=personal&view=PENDING/);
  assert.match(smoke, /\/api\/hosted\/events\?workspaceId=personal&from=/);
  assert.match(smoke, /status !== 500/);
  assert.match(smoke, /headers\.get\("cache-control"\) !== "no-store"/);
  assert.match(smoke, /Hosted runtime is unavailable\./);
});

test("web Worker declares only the canonical custom domain while keeping a temporary rollback hostname", async () => {
  const config = JSON.parse(await readWebWrangler());
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "command.coreyg.dev", custom_domain: true }]);
});

test("task-capture MCP remains independent from the web-domain migration", async () => {
  const config = JSON.parse(await readMcpWrangler());
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
});

test("legacy Cloudflare provisioning workflow is verification-only and cannot grant shared workspaces", async () => {
  const workflow = await readBootstrap();
  assert.match(workflow, /principal_id must be a verified cf-user:\* identity/);
  assert.match(workflow, /Verify private Personal provisioning/);
  assert.match(workflow, /m\.workspace_key = 'personal'/);
  assert.match(workflow, /JOIN workspace_memberships m ON m\.user_id = u\.user_id/);
  assert.doesNotMatch(workflow, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO/i);
  assert.doesNotMatch(workflow, /'indelitech'\s*,\s*'OWNER'/i);
  assert.doesNotMatch(workflow, /principal_workspace_grants/);
});
