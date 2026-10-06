/**
 * Backward compatibility: an unmodified MCP TypeScript SDK 1.29 client (the
 * 2025-11-25 era, what existing connectors such as Rocky's speak) against the
 * v2 server, over the real Express HTTP app and over stdio. Also raw
 * initialize requests for the older 2025-06-18 / 2025-03-26 / 2024-11-05
 * revisions, and the HTTP guards (kill switch, rate limit, /health).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client as V1Client } from "@modelcontextprotocol/sdk-v1/client/index.js";
import { StreamableHTTPClientTransport as V1HttpTransport } from "@modelcontextprotocol/sdk-v1/client/streamableHttp.js";
import { StdioClientTransport as V1StdioTransport } from "@modelcontextprotocol/sdk-v1/client/stdio.js";
import { Client as V2Client } from "@modelcontextprotocol/client";
import { StdioClientTransport as V2StdioTransport } from "@modelcontextprotocol/client/stdio";
import { fixtureState, installFixtureFetch, readFixture } from "./fixture-fetch.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The rate limiter reads its limits at import time; give the suite headroom.
process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.RATE_LIMIT_PER_DAY = "100000";
const { createHttpApp } = await import("./http.js");
const { ALL_TOOLS } = await import("./server.js");
const { apiCache } = await import("./client.js");

const INDEX = fileURLToPath(new URL("./index.js", import.meta.url));

test.after(installFixtureFetch());

const { app, handler } = createHttpApp();
const httpServer = app.listen(0, "127.0.0.1");
await once(httpServer, "listening");
const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
test.after(async () => {
  await handler.close();
  httpServer.close();
});

async function v1Http() {
  const client = new V1Client({ name: "rocky-like-v1", version: "1.29.0" });
  const transport = new V1HttpTransport(new URL(`${base}/mcp`));
  await client.connect(transport);
  return { client, transport };
}

test("SDK 1.29 client over HTTP: handshake, 21 tools in order, stateless", async () => {
  const { client, transport } = await v1Http();
  assert.equal(transport.protocolVersion, "2025-11-25");
  assert.equal(transport.sessionId, undefined, "no Mcp-Session-Id is issued");
  assert.equal(client.getServerVersion()?.name, "sports-leader-mcp");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ALL_TOOLS.map((t) => t.name));
  assert.equal((tools.find((t) => t.name === "get_game_odds")!.outputSchema as any).type, "object");
  await client.close();
});

test("SDK 1.29 client over HTTP: schema-validated tool call, resource links, template read, prompts", async () => {
  const { client } = await v1Http();
  await client.listTools(); // primes the v1 client's Ajv output validators
  apiCache.clear();
  const event = readFixture("nfl", "event");
  const res: any = await client.callTool({
    name: "get_game_summary",
    arguments: { sport: "football", league: "nfl", eventId: event.id },
  });
  assert.ok(!res.isError, res.content?.[0]?.text);
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);
  const link = res.content.find((c: any) => c.type === "resource_link" && c.uri.endsWith("/odds"));
  assert.ok(link, "resource_link survives the 2025 wire");
  apiCache.clear();
  const read = await client.readResource({ uri: link.uri });
  assert.equal((read.contents[0] as any).mimeType, "application/json");
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.equal(resourceTemplates.length, 7);
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.length > 0);
  const slate: any = await client.callTool({ name: "get_slate", arguments: { sport: "baseball", league: "mlb" } });
  assert.ok(!slate.isError && slate.structuredContent.games);
  await client.close();
});

test("SDK 1.29 client over HTTP: dropping the connection aborts the in-flight ESPN fetch", async () => {
  // On stateless legacy serving a 2025-era `notifications/cancelled` arrives as
  // a separate POST at a fresh instance, so it cannot reach the running call
  // (the SDK 1.29 client also keeps the call's SSE stream open after a
  // cancel). What does propagate is the HTTP exchange closing: the request's
  // cancel signal fires and the ESPN fetch is aborted rather than left to the
  // 30 s timeout and retries.
  const { client } = await v1Http();
  apiCache.clear();
  fixtureState.hang = true;
  fixtureState.aborted = 0;
  fixtureState.log = [];
  try {
    const p = client.callTool({ name: "get_injuries", arguments: { sport: "football", league: "nfl" } });
    p.catch(() => {});
    for (let i = 0; i < 200 && !fixtureState.log.some((l) => l.endsWith("/injuries")); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await client.close(); // aborts the client's open POST/SSE exchange
    for (let i = 0; i < 200 && fixtureState.aborted === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(fixtureState.aborted, 1);
    await assert.rejects(p);
  } finally {
    fixtureState.hang = false;
  }
});

async function rawInitialize(protocolVersion: string) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    }),
  });
  const text = await res.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
  return { res, json };
}

for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
  test(`raw initialize at ${v} is accepted as-is (no session id)`, async () => {
    const { res, json } = await rawInitialize(v);
    assert.equal(res.status, 200);
    assert.equal(json.result.protocolVersion, v);
    assert.equal(res.headers.get("mcp-session-id"), null);
    assert.ok(json.result.capabilities.tools);
  });
}

test("raw initialize with an unknown revision gets a counter-offer, not an error", async () => {
  const { json } = await rawInitialize("2023-01-01");
  assert.equal(json.result.protocolVersion, "2025-11-25");
});

test("GET/DELETE /mcp (old session verbs) answer 405; /health has no session fields", async () => {
  assert.equal((await fetch(`${base}/mcp`, { headers: { accept: "text/event-stream" } })).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 405);
  const health: any = await (await fetch(`${base}/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.tools, ALL_TOOLS.length);
  assert.equal(health.stateless, true);
  assert.equal(health.sessions, undefined);
  assert.deepEqual(health.protocolVersions.modern, ["2026-07-28"]);
  const stats: any = await (await fetch(`${base}/stats`)).json();
  assert.ok(stats.cache && stats.rateLimit);
  assert.equal(stats.sessions, undefined);
});

test("KILL_SWITCH=1 returns 503 on /mcp but /health stays up", async () => {
  process.env.KILL_SWITCH = "1";
  try {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 503);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    delete process.env.KILL_SWITCH;
  }
});

test("real entry point over HTTP (PORT set): per-IP rate limit still applies", async () => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [INDEX], {
    env: { ...process.env, PORT: String(port), RATE_LIMIT_PER_MIN: "2", KILL_SWITCH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d) => String(d).includes("listening") && resolve());
      child.once("exit", (c) => reject(new Error(`server exited ${c}`)));
    });
    const post = () =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    const codes = [(await post()).status, (await post()).status, (await post()).status];
    assert.notEqual(codes[0], 429);
    assert.equal(codes[2], 429, `codes ${codes}`);
  } finally {
    child.kill("SIGTERM");
  }
});

test("SDK 1.29 client over stdio (spawned dist/index.js): 2025 handshake still served", async () => {
  const client = new V1Client({ name: "rocky-like-v1", version: "1.29.0" });
  await client.connect(new V1StdioTransport({ command: process.execPath, args: [INDEX], stderr: "pipe" }));
  assert.equal(client.getServerVersion()?.name, "sports-leader-mcp");
  const { tools } = await client.listTools();
  assert.equal(tools.length, ALL_TOOLS.length);
  const r: any = await client.callTool({ name: "list_sports_and_leagues", arguments: {} });
  assert.ok(!r.isError && JSON.parse(r.content[0].text).count > 0);
  await client.close();
});

test("SDK v2 client pinned to 2026-07-28 over stdio: modern era served by serveStdio", async () => {
  const client = new V2Client({ name: "modern", version: "2" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } } as any);
  await client.connect(new V2StdioTransport({ command: process.execPath, args: [INDEX], stderr: "pipe" }));
  assert.equal(client.getProtocolEra(), "modern");
  const t: any = await client.listTools();
  assert.deepEqual(t.tools.map((x: any) => x.name), ALL_TOOLS.map((x) => x.name));
  assert.equal(t.ttlMs, 3_600_000);
  await client.close();
});
