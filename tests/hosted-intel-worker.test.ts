import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function text(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function jsonc(path: string) {
  return JSON.parse(text(path).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

const worker = text("../workers/hosted-intel-collector.ts");
const config = jsonc("../wrangler.intel.jsonc");
const packageJson = JSON.parse(text("../package.json")) as { scripts: Record<string, string> };
const checkWorkflow = text("../.github/workflows/check.yml");
const deployWorkflow = text("../.github/workflows/cloudflare-protected-deploy.yml");

test("hosted Intel Worker is cron-only and has no HTTP handler", () => {
  assert.match(worker, /scheduled\s*\(/);
  assert.doesNotMatch(worker, /\bfetch\s*\(/);
  assert.match(worker, /D1CollectorSnapshotRepository/);
});

test("hosted Intel Wrangler config exposes no public URL and binds only production D1 plus cron", () => {
  assert.equal(config.name, "daily-command-center-intel");
  assert.equal(config.main, "workers/hosted-intel-collector.ts");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.triggers, { crons: ["17 */6 * * *"] });
  assert.equal(config.vars, undefined);
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "daily-command-center-prod",
    database_id: "2f67ea9a-bf97-4008-9031-2ebfdb5a6e57",
  }]);
});

test("CI dry-runs the Intel Worker and protected deployment validates then deploys it", () => {
  assert.equal(packageJson.scripts["build:intel"], "wrangler deploy --dry-run --config wrangler.intel.jsonc");
  assert.equal(packageJson.scripts["deploy:intel"], "wrangler deploy --config wrangler.intel.jsonc");
  assert.match(checkWorkflow, /npm run build:intel/);
  assert.match(deployWorkflow, /Intel Worker must not expose workers\.dev/);
  assert.match(deployWorkflow, /npm run build:intel/);
  assert.match(deployWorkflow, /npm run deploy:intel/);
});
