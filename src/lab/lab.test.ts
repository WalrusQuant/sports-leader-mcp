/**
 * Lab tools on the main connector: 54 names, a stdio round trip, and a clear
 * error when uv is not available.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ALL_TOOLS, createServer, runTool } from "../server.js";
import { LAB_TOOL_NAMES, labTools } from "./tools.js";
import { closeLab, resetLabForTests } from "./bridge.js";

const LAB_NAMES = [
  "ping",
  "inspect_data",
  "query_data",
  "build_dataset",
  "audit_features",
  "train_classifier",
  "train_regressor",
  "predict",
  "list_runs",
  "compare_runs",
  "model_card",
];

function uvOnPath(): boolean {
  const found = spawnSync("uv", ["--version"], { encoding: "utf8" });
  return found.status === 0;
}

test.after(async () => {
  delete process.env.SPORTSLEADER_LAB_UV;
  await closeLab();
});

test("the connector lists 54 tools, including the 11 lab tools", async () => {
  assert.deepEqual(LAB_TOOL_NAMES, LAB_NAMES);
  assert.equal(new Set(ALL_TOOLS.map((tool) => tool.name)).size, ALL_TOOLS.length);
  assert.equal(ALL_TOOLS.length, 54);
  for (const name of LAB_NAMES) {
    assert.equal(ALL_TOOLS.filter((tool) => tool.name === name).length, 1, name);
  }
  const server = createServer();
  const client = new Client({ name: "lab-list", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ALL_TOOLS.map((tool) => tool.name),
  );
  const ping = listed.tools.find((tool) => tool.name === "ping");
  assert.ok(ping);
  assert.match(ping.description ?? "", /home_win|betting edge|research/);
  assert.equal(ping.inputSchema.properties?.raw, undefined);
  await client.close();
});

test("a missing uv returns a lab error and leaves the data tools registered", async () => {
  process.env.SPORTSLEADER_LAB_UV = "/no/such/sports-leader-uv";
  await resetLabForTests();
  const ping = labTools.find((tool) => tool.name === "ping");
  assert.ok(ping);
  const result = await runTool(ping, {});
  assert.equal(result.isError, true);
  const message = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
  assert.match(message, /uv/);
  assert.match(message, /Python 3\.11/);
  assert.equal(ALL_TOOLS.length, 54);
  delete process.env.SPORTSLEADER_LAB_UV;
  await resetLabForTests();
});

test("ping, inspect_data, build, train, and predict round-trip through the lab", { timeout: 240_000 }, async () => {
  if (!uvOnPath()) {
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "sports-leader-lab-bridge-"));
  process.env.SPORTSLEADER_LAB_CACHE_DIR = join(root, "cache");
  process.env.SPORTSLEADER_LAB_RUN_DIR = join(root, "runs");
  delete process.env.SPORTSLEADER_LAB_UV;
  await resetLabForTests();

  const server = createServer();
  const client = new Client({ name: "lab-roundtrip", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  const ping = await client.callTool({ name: "ping", arguments: {} });
  assert.notEqual(ping.isError, true);
  const pingBody = ping.structuredContent as { ok?: boolean; disclaimer?: string };
  assert.equal(pingBody.ok, true);
  assert.match(pingBody.disclaimer ?? "", /not a recommendation to bet/i);

  const inspected = await client.callTool({
    name: "inspect_data",
    arguments: { league: "nfl", dataset: "games", seasons: [2024] },
  });
  assert.notEqual(inspected.isError, true, JSON.stringify(inspected.content));
  const info = inspected.structuredContent as { rows?: number; league?: string };
  assert.equal(info.league, "nfl");
  assert.ok((info.rows ?? 0) > 100);

  const built = await client.callTool({
    name: "build_dataset",
    arguments: {
      league: "nfl",
      target: "home_win",
      seasons: [2023, 2024],
      features: ["site", "elo"],
    },
  });
  assert.notEqual(built.isError, true, JSON.stringify(built.content));
  const dataset = built.structuredContent as { dataset_id?: string; rows?: number };
  assert.match(dataset.dataset_id ?? "", /^dataset_/);
  assert.ok((dataset.rows ?? 0) > 100);

  const trained = await client.callTool({
    name: "train_classifier",
    arguments: { dataset_id: dataset.dataset_id, model: "logistic", min_train_seasons: 1 },
  });
  assert.notEqual(trained.isError, true, JSON.stringify(trained.content));
  const run = trained.structuredContent as { run_id?: string; pooled?: { model?: { log_loss?: number } } };
  assert.match(run.run_id ?? "", /^run_/);
  assert.equal(typeof run.pooled?.model?.log_loss, "number");

  const found = await client.callTool({
    name: "query_data",
    arguments: {
      sql: "SELECT game_id, home_team_abbr FROM nfl_games WHERE completed = true ORDER BY game_date DESC LIMIT 1",
      seasons: [2024],
      max_rows: 1,
    },
  });
  assert.notEqual(found.isError, true, JSON.stringify(found.content));
  const rows = (found.structuredContent as { rows?: Array<{ game_id?: string; home_team_abbr?: string }> }).rows ?? [];
  assert.equal(rows.length, 1);
  const gameId = String(rows[0].game_id);

  const predicted = await client.callTool({
    name: "predict",
    arguments: { run_id: run.run_id, game_ids: [gameId] },
  });
  assert.notEqual(predicted.isError, true, JSON.stringify(predicted.content));
  const score = predicted.structuredContent as {
    as_of_timezone?: string;
    disclaimer?: string;
    games?: Array<{ estimate_kind?: string; home_team_abbr?: string; estimate?: number }>;
  };
  assert.equal(score.as_of_timezone, "America/Chicago");
  assert.match(score.disclaimer ?? "", /not a recommendation to bet/i);
  assert.equal(score.games?.[0]?.estimate_kind, "home_win_probability");
  assert.equal(typeof score.games?.[0]?.home_team_abbr, "string");
  assert.equal(score.games?.[0]?.home_team_abbr, rows[0].home_team_abbr);
  assert.equal(typeof score.games?.[0]?.estimate, "number");

  await client.close();
  await closeLab();
});
