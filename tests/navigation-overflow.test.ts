import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/navigation-overflow.css", import.meta.url), "utf8");

test("root layout loads the desktop navigation overflow guard", () => {
  assert.match(layout, /import "\.\/navigation-overflow\.css";/);
});

test("desktop navigation keeps overflow reachable instead of centering past both edges", () => {
  assert.match(css, /@media \(min-width: 901px\)/);
  assert.match(css, /\.main-nav\s*\{[^}]*min-width:\s*0;[^}]*justify-content:\s*flex-start;/s);
  assert.match(css, /\.main-nav::before,[\s\S]*\.main-nav::after\s*\{[^}]*flex:\s*1 0 0;/);
  assert.match(css, /\.main-nav button\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test("Indelitech reclaims desktop tab width without hiding labels", () => {
  assert.match(css, /data-workspace="indelitech"[^\n]*\.main-nav button\s*\{[^}]*padding-inline:\s*10px;/s);
  assert.doesNotMatch(css, /data-workspace="indelitech"[^}]*display:\s*none;/s);
});
