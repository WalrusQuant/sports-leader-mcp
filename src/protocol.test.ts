/**
 * Spec 2026-07-28 behaviour through the real HTTP entry (createMcpHandler) and
 * a v2 SDK client: stateless per-request serving, fixed tool order, cache
 * hints, outputSchema/structuredContent and resource links, cancellation.
 * The same handler also serves a v2 client in legacy (2025-era) mode.
 * ESPN fetches are served from test/fixtures.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHttpApp } from "./http.js";
import { ALL_TOOLS, LIST_CACHE_HINTS } from "./server.js";
import { apiCache } from "./client.js";
import { RESOURCE_TEMPLATES } from "./links.js";
import { fixtureState, installFixtureFetch, readFixture } from "./fixture-fetch.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
test.after(installFixtureFetch());

const { handler } = createHttpApp();
test.after(() => handler.close());

type Mode = "auto" | "legacy" | { pin: string };
const responses: Response[] = [];

async function connect(mode: Mode = { pin: "2026-07-28" }) {
  const client = new Client({ name: "test", version: "0.0.0" }, { versionNegotiation: { mode } } as any);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: async (url, init) => {
      const res = await handler.fetch(new Request(url, init));
      responses.push(res.clone());
      return res;
    },
  });
  await client.connect(transport);
  return client;
}

test("2026-07-28: modern era, no session id, fixed tool order, list cache hints", async () => {
  responses.length = 0;
  const client = await connect();
  assert.equal(client.getProtocolEra(), "modern");
  const a: any = await client.listTools();
  const b: any = await client.listTools();
  const expected = ALL_TOOLS.map((t) => t.name);
  assert.deepEqual(a.tools.map((t: any) => t.name), expected, "tools/list is in ALL_TOOLS order");
  assert.deepEqual(b.tools.map((t: any) => t.name), expected, "and stays that way");
  assert.equal(a.ttlMs, LIST_CACHE_HINTS["tools/list"].ttlMs);
  assert.equal(a.cacheScope, "public");
  const tpl: any = await client.listResourceTemplates();
  assert.equal(tpl.ttlMs, 3_600_000);
  assert.equal(tpl.resourceTemplates.length, RESOURCE_TEMPLATES.length);
  for (const r of responses) assert.equal(r.headers.get("mcp-session-id"), null, "stateless: no Mcp-Session-Id");
  await client.close();
});

test("2026-07-28: auto negotiation picks the modern era", async () => {
  const client = await connect("auto");
  assert.equal(client.getProtocolEra(), "modern");
  await client.close();
});

test("2026-07-28: outputSchema + structuredContent + resource links on get_game_summary", async () => {
  const client = await connect();
  await client.listTools();
  apiCache.clear();
  const event = readFixture("nfl", "event");
  const res: any = await client.callTool({
    name: "get_game_summary",
    arguments: { sport: "football", league: "nfl", eventId: event.id },
  });
  assert.ok(!res.isError, res.content?.[0]?.text);
  assert.equal(res.content[0].type, "text");
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);
  const links = res.content.filter((c: any) => c.type === "resource_link");
  assert.ok(links.length >= 3, "summary carries resource links");
  const plays = links.find((l: any) => l.uri.endsWith("/plays"));
  assert.equal(plays.uri, `espn://football/nfl/game/${event.id}/plays`);
  // The link resolves on the modern era too, with a per-template cache hint.
  apiCache.clear();
  const read: any = await client.readResource({ uri: plays.uri });
  assert.equal(read.contents[0].uri, plays.uri);
  assert.equal(read.ttlMs, 60_000);
  assert.equal(read.cacheScope, "public");
  await client.close();
});

test("2026-07-28: get_slate + get_game_odds validate against their outputSchemas", async () => {
  const client = await connect();
  await client.listTools();
  for (const [name, args] of [
    ["get_slate", { sport: "baseball", league: "mlb" }],
    ["get_game_odds", { sport: "football", league: "nfl", eventId: readFixture("nfl", "event").id }],
  ] as const) {
    apiCache.clear();
    const res: any = await client.callTool({ name, arguments: args });
    assert.ok(!res.isError, `${name}: ${res.content?.[0]?.text}`);
    assert.equal(typeof res.structuredContent, "object");
  }
  await client.close();
});

test("2026-07-28: static resources carry the long cache hint", async () => {
  const client = await connect();
  const res: any = await client.readResource({ uri: "sports://leagues" });
  assert.equal(res.ttlMs, 86_400_000);
  await client.close();
});

test("legacy (2025-era) client on the same endpoint: works, no cache fields, no session", async () => {
  responses.length = 0;
  const client = await connect("legacy");
  assert.equal(client.getProtocolEra(), "legacy");
  assert.equal(client.getNegotiatedProtocolVersion?.() ?? "2025-11-25", "2025-11-25");
  const t: any = await client.listTools();
  assert.deepEqual(t.tools.map((x: any) => x.name), ALL_TOOLS.map((x) => x.name));
  assert.equal(t.ttlMs, undefined, "2025-era responses never carry cache fields");
  apiCache.clear();
  const res: any = await client.callTool({
    name: "get_game_summary",
    arguments: { sport: "football", league: "nfl", eventId: readFixture("nfl", "event").id },
  });
  assert.ok(res.content.some((c: any) => c.type === "resource_link"));
  for (const r of responses) assert.equal(r.headers.get("mcp-session-id"), null);
  await client.close();
});

test("cancellation: aborting a tool call aborts the in-flight ESPN fetch", async () => {
  const client = await connect();
  await client.listTools();
  apiCache.clear();
  fixtureState.hang = true;
  fixtureState.aborted = 0;
  fixtureState.log = [];
  try {
    const ac = new AbortController();
    const p = client.callTool(
      { name: "get_scoreboard", arguments: { sport: "football", league: "nfl" } },
      { signal: ac.signal } as any,
    );
    // Wait until the server is actually blocked on the upstream fetch.
    for (let i = 0; i < 100 && !fixtureState.log.some((l) => l.endsWith("/scoreboard")); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    ac.abort();
    await assert.rejects(p);
    for (let i = 0; i < 100 && fixtureState.aborted === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(fixtureState.aborted, 1, "upstream fetch was aborted");
    // Cancelled requests are never retried: only the one upstream attempt.
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(fixtureState.log.filter((l) => l.endsWith("/scoreboard")).length, 1);
  } finally {
    fixtureState.hang = false;
    fixtureState.log = [];
    await client.close();
  }
});
