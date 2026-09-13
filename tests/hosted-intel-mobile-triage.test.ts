import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted Intel defaults to a compact top-eight feed while preserving access to the full snapshot", async () => {
  const view = await readFile(new URL("../components/hosted-intel-snapshot.tsx", import.meta.url), "utf8");
  assert.match(view, /const INITIAL_VISIBLE_STORIES = 8;/);
  assert.match(view, /allStories\.slice\(0, INITIAL_VISIBLE_STORIES\)/);
  assert.match(view, /Show \$\{allStories\.length - INITIAL_VISIBLE_STORIES\} more/);
  assert.match(view, /Show top \$\{INITIAL_VISIBLE_STORIES\}/);
});

test("hosted Intel cards present a TLDR and keep external stories isolated in new tabs", async () => {
  const view = await readFile(new URL("../components/hosted-intel-snapshot.tsx", import.meta.url), "utf8");
  assert.match(view, /target="_blank"/);
  assert.match(view, /rel="noreferrer noopener"/);
  assert.match(view, /<strong>TL;DR<\/strong>/);
  assert.match(view, /<strong>Why surfaced<\/strong>/);
  assert.doesNotMatch(view, /window\.location|location\.href/);
});

test("hosted Intel keeps mobile cards dense without hiding title, TLDR, or relevance context", async () => {
  const css = await readFile(new URL("../components/hosted-intel-snapshot.module.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.story\s*\{[\s\S]*?padding:\s*\.82rem;/);
  assert.match(css, /\.tldr\s*\{[\s\S]*?font-size:\s*\.84rem;/);
  assert.match(css, /\.reason\s*\{[\s\S]*?font-size:\s*\.72rem;/);
  assert.doesNotMatch(css, /\.tldr[^}]*display:\s*none|\.reason[^}]*display:\s*none/);
});
