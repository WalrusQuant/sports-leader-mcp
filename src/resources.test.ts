/**
 * Resource templates and resource links, exercised through a real SDK client
 * over the in-memory transport with fetch served from test/fixtures.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "./server.js";
import { apiCache } from "./client.js";
import { RESOURCE_TEMPLATES } from "./links.js";
import { fixtureState, installFixtureFetch, readFixture } from "./fixture-fetch.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
test.after(installFixtureFetch());

async function connect() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  await client.listTools();
  return client;
}

async function toolText(client: Client, name: string, args: Record<string, unknown>) {
  apiCache.clear();
  const res: any = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name}: ${res.content?.[0]?.text}`);
  return res;
}

async function readText(client: Client, uri: string) {
  apiCache.clear();
  const res = await client.readResource({ uri });
  assert.equal(res.contents.length, 1);
  assert.equal(res.contents[0].uri, uri);
  assert.equal(res.contents[0].mimeType, "application/json");
  return (res.contents[0] as any).text as string;
}

const nflSummaryId = () => String(readFixture("nfl", "summary").header.id);
const nflOddsId = () => String(readFixture("nfl", "event").id);

test("templates are listed and static resources are unchanged", async () => {
  const client = await connect();
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.deepEqual(
    resourceTemplates.map((t) => t.uriTemplate).sort(),
    RESOURCE_TEMPLATES.map((t) => t.uriTemplate).sort(),
  );
  for (const uri of [
    "espn://{sport}/{league}/game/{eventId}/plays",
    "espn://{sport}/{league}/game/{eventId}/probabilities",
    "espn://{sport}/{league}/injuries",
    "espn://{sport}/{league}/team/{teamId}/injuries",
  ]) {
    assert.ok(resourceTemplates.some((t) => t.uriTemplate === uri), `missing ${uri}`);
  }
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), [
    "sports://leagues",
    "sports://reference/api-domains",
    "sports://reference/betting-providers",
    "sports://reference/season-types",
  ]);
});

test("reading a template URI returns the same compact JSON as the matching tool", async () => {
  const client = await connect();
  const sid = nflSummaryId();
  const oid = nflOddsId();
  const cases: Array<[string, string, Record<string, unknown>]> = [
    [`espn://football/nfl/game/${sid}/plays`, "get_game_plays", { eventId: sid }],
    [`espn://football/nfl/game/${sid}/probabilities`, "get_game_probabilities", { eventId: sid }],
    [`espn://football/nfl/game/${sid}/summary`, "get_game_summary", { eventId: sid }],
    [`espn://football/nfl/game/${oid}/odds`, "get_game_odds", { eventId: oid }],
    ["espn://football/nfl/injuries", "get_injuries", {}],
    ["espn://football/nfl/slate/20261011", "get_slate", { date: "20261011" }],
    [`espn://baseball/mlb/game/${readFixture("mlb", "summary").header.id}/plays`, "get_game_plays",
      { eventId: String(readFixture("mlb", "summary").header.id) }],
  ];
  for (const [uri, tool, extra] of cases) {
    const sport = uri.split("/")[2];
    const league = uri.split("/")[3];
    const read = await readText(client, uri);
    const viaTool = await toolText(client, tool, { sport, league, ...extra });
    assert.equal(read, viaTool.content[0].text, `${uri} should equal ${tool}`);
    assert.ok(JSON.parse(read), "valid JSON");
  }
});

test("template variables are validated before any upstream call", async () => {
  const client = await connect();
  fixtureState.log = [];
  await assert.rejects(client.readResource({ uri: "espn://foot%20ball/nfl/injuries" }), /Invalid|sport/);
  await assert.rejects(client.readResource({ uri: "espn://football/nfl/slate/2026-10-11" }), /YYYYMMDD/);
  assert.equal(fixtureState.log.length, 0, "no ESPN request for an invalid URI");
});

test("get_game_summary returns resource_link items after the unchanged text block", async () => {
  const client = await connect();
  const sid = nflSummaryId();
  const res = await toolText(client, "get_game_summary", { sport: "football", league: "nfl", eventId: sid });
  assert.equal(res.content[0].type, "text");
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);
  const links = res.content.slice(1);
  assert.ok(links.length >= 4);
  for (const l of links) {
    assert.equal(l.type, "resource_link");
    assert.equal(l.mimeType, "application/json");
    assert.match(l.uri, /^espn:\/\/football\/nfl\//);
    assert.ok(l.name && l.description);
  }
  const uris = links.map((l: any) => l.uri);
  assert.ok(uris.includes(`espn://football/nfl/game/${sid}/plays`));
  assert.ok(uris.includes(`espn://football/nfl/game/${sid}/probabilities`));
  assert.ok(uris.includes(`espn://football/nfl/game/${sid}/odds`));
  assert.ok(uris.includes("espn://football/nfl/injuries"));
  // Every link resolves through resources/read.
  for (const uri of uris) assert.ok(JSON.parse(await readText(client, uri)));
});

test("get_slate links the full league injury report; raw mode and other tools add no links", async () => {
  const client = await connect();
  const slate = await toolText(client, "get_slate", { sport: "football", league: "nfl", date: "20261011" });
  assert.deepEqual(slate.content.slice(1).map((l: any) => l.uri), ["espn://football/nfl/injuries"]);

  const raw = await toolText(client, "get_game_summary", { sport: "football", league: "nfl", eventId: nflSummaryId(), raw: true });
  assert.equal(raw.content.length, 1);

  const odds = await toolText(client, "get_game_odds", { sport: "football", league: "nfl", eventId: nflOddsId() });
  assert.equal(odds.content.length, 1);
  const sb = await toolText(client, "get_scoreboard", { sport: "football", league: "nfl" });
  assert.equal(sb.content.length, 1);
});
