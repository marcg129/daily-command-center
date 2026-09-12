import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("workspace identity uses distinct backgrounds and textures, not accent color alone", async () => {
  const [layout, css] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/workspace-accessibility.css"),
  ]);
  assert.match(layout, /import "\.\/workspace-accessibility\.css"/);
  assert.match(css, /\.app-shell\[data-workspace="personal"\][\s\S]*background-image:[\s\S]*radial-gradient/);
  assert.match(css, /\.app-shell\[data-workspace="indelitech"\][\s\S]*background-image:[\s\S]*28px 28px/);
  assert.match(css, /\[data-theme="dark"\] \.app-shell\[data-workspace="personal"\][\s\S]*--paper: #0b1420/);
  assert.match(css, /\[data-theme="dark"\] \.app-shell\[data-workspace="indelitech"\][\s\S]*--paper: #17130f/);
});

test("task priority is encoded with text, symbols, borders, and non red-green palette", async () => {
  const [surface, css] = await Promise.all([
    read("../components/task-surface.tsx"),
    read("../app/workspace-accessibility.css"),
  ]);
  assert.match(surface, /priority === "HIGH" \? "▲"/);
  assert.match(surface, /priority === "MEDIUM" \? "◆"/);
  assert.match(surface, /className={`priority-badge priority-\$\{priority\.toLowerCase\(\)\}`}/);
  assert.match(surface, /data-priority={task\.priority\.toLowerCase\(\)}/);
  assert.match(css, /--priority-high-border: #f5c451/);
  assert.match(css, /--priority-medium-border: #7db2e8/);
  assert.match(css, /\.priority-badge\.priority-high[\s\S]*border-width: 2px/);
});

test("task action menu can escape the list and remains scrollable in the viewport", async () => {
  const css = await read("../app/workspace-accessibility.css");
  assert.match(css, /\.task-list \{\s*overflow: visible;/);
  assert.match(css, /\.task-row:has\(\.task-actions\[open\]\)/);
  assert.match(css, /\.task-action-panel \{[\s\S]*bottom: 34px;[\s\S]*max-height: min\(70vh, 620px\);[\s\S]*overflow-y: auto;/);
});

test("desktop task action popover stays below the sticky header", async () => {
  const [layout, css] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/task-menu-viewport.css"),
  ]);
  assert.match(layout, /import "\.\/task-menu-viewport\.css"/);
  assert.match(css, /@media \(min-width: 621px\)/);
  assert.match(css, /\.task-action-panel \{[\s\S]*position: fixed;[\s\S]*top: 84px;[\s\S]*bottom: auto;/);
  assert.match(css, /max-height: calc\(100dvh - 108px\);/);
  assert.match(css, /right: max\(24px, calc\(\(100vw - 1380px\) \/ 2 \+ 68px\)\);/);
});
