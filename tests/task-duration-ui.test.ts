import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("task UI captures, displays, edits, and clears canonical estimated duration", async () => {
  const surface = await readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8");
  assert.match(surface, /const TASK_DURATIONS = \["5m", "15m", "30m", "1h", "2h\+", "Project"\]/);
  assert.match(surface, /label="Estimated duration" value=\{duration\}/);
  assert.match(surface, /estimatedDuration: duration \|\| undefined/);
  assert.match(surface, /Estimated \$\{task\.estimatedDuration\}/);
  assert.match(surface, /label="Change estimated duration" value=\{duration\}/);
});
