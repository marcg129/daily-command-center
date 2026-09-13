import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/manual-hosted-intel.yml", import.meta.url), "utf8");

test("manual Intel collection is dispatch-only, owner-only, and current-main only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /current_main="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /current_main" != "\$GITHUB_SHA/);
});

test("manual Intel collection reuses the scheduled handler with only D1 made remote", () => {
  assert.match(workflow, /database\.remote = true;/);
  assert.match(workflow, /config\.triggers = \{ crons: \[\] \};/);
  assert.match(workflow, /wrangler dev --test-scheduled/);
  assert.match(workflow, /--ip 127\.0\.0\.1/);
  assert.match(workflow, /cdn-cgi\/local\/scheduled\?format=json/);
  assert.match(workflow, /workers_dev !== false \|\| config\.preview_urls !== false/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
  assert.doesNotMatch(workflow, /deploy:intel/);
});

test("manual Intel collection proves the exact run wrote production D1", () => {
  assert.match(workflow, /scheduled_time_ms="\$\(node -p 'Date\.now\(\)'\)"/);
  assert.match(workflow, /d1 execute daily-command-center-prod --remote/);
  assert.match(workflow, /workspace_id='indelitech' AND collector='industry'/);
  assert.match(workflow, /hosted-indelitech-intel-v1/);
  assert.match(workflow, /row\.checked_at !== expected/);
  assert.match(workflow, /Source health:/);
  assert.match(workflow, /Surfaced Intel items:/);
});
