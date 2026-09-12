import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Today task cards focus the canonical task while the list link stays generic", async () => {
  const [control, surface] = await Promise.all([
    readFile(new URL("../components/control-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(surface, /const attention = tasksRequiringAttentionToday\(tasks\)/);
  assert.match(surface, /const visibleAttention = attention\.slice\(0, 5\)/);
  assert.match(surface, /onClick=\{\(\) => onOpenTask\(task\.id\)\}/);
  assert.match(surface, /Nothing requires action today\./);
  assert.match(control, /setFocusedTaskId\(taskId\);\s*goTo\("tasks"\);/);
  assert.match(control, /<TaskFocusedTodayView[^>]*openTask=\{openTask\}/);
  assert.match(control, /<TaskAttentionPanel[^>]*onOpenTask=\{openTask\}[^>]*onOpenAll=/);
});
