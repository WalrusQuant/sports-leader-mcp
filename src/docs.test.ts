import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { LEAGUE_CATALOG } from "./catalog.js";
import { ALL_TOOLS } from "./server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");

test("published league, sport, and tool counts match the code", () => {
  const leagues = LEAGUE_CATALOG.length;
  const sports = new Set(LEAGUE_CATALOG.map((l) => l.sport)).size;
  const tools = ALL_TOOLS.length;
  for (const file of ["README.md", "smithery.yaml", "package.json", "SKILL.md", "docs/README.md", "docs/index.html", "docs/docs.html"]) {
    const text = read(file);
    assert.ok(!/\b139\b|17 sports/.test(text), `${file} still has the old 17 sports / 139 leagues claim`);
    assert.ok(text.includes(`${leagues} verified leagues`), `${file} should say "${leagues} verified leagues"`);
    assert.ok(new RegExp(`\\b${sports} sports`).test(text), `${file} should say "${sports} sports"`);
  }
  assert.ok(read("README.md").includes(`**${tools} tools`), `README tool count should be ${tools}`);
  assert.ok(read("smithery.yaml").includes(`${tools} tools`), `smithery.yaml tool count should be ${tools}`);
});
