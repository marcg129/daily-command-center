import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readCss = () => readFile(new URL("../app/task-planning-filters.css", import.meta.url), "utf8");

test("planning filter selectors only hide open canonical task rows", async () => {
  const css = await readCss();
  assert.match(css, /\.quick-task-add\[data-filter-priority="high"\][\s\S]+\.task-summary ~ \.task-list \.task-row:not/);
  assert.match(css, /\.quick-task-add\[data-filter-due="today"\][\s\S]+\.task-list \.task-row:not/);
  assert.match(css, /\.quick-task-add\[data-filter-duration="quick"\][\s\S]+\.task-list \.task-row:not/);
  assert.doesNotMatch(css, /completed-list|completed-row/);
}
);
