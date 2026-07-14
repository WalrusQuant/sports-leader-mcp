#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { createServer, ALL_TOOLS } from "./server.js";
import { apiCache } from "./client.js";
import { rateLimitMiddleware, rateLimitStats } from "./rate-limit.js";
import { VERSION } from "./version.js";

// Upper bound on concurrent HTTP sessions. Without this, a client that opens
// many sessions (or crashes without sending DELETE) leaks a McpServer + its
// transport indefinitely. When the cap is reached, the oldest session is
// evicted to make room for the new one.
const MAX_SESSIONS = readPositiveInt(process.env.MAX_SESSIONS, 1000);

function readPositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(port: number) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Map of session ID → { server, transport, createdAt }, in insertion order.
  const sessions = new Map<string, SessionEntry>();

  // Evict the oldest session (Map preserves insertion order, so the first key
  // is the oldest). Called when we're about to exceed MAX_SESSIONS.
  function evictOldestSession(): void {
    const oldestId = sessions.keys().next().value;
    if (oldestId === undefined) return;
    const entry = sessions.get(oldestId);
    sessions.delete(oldestId);
    // Close the transport so it can clean up; ignore errors on a dead session.
    if (entry) {
      entry.transport.close?.().catch(() => {});
    }
  }

  // Kill switch + rate limiting for MCP routes
  const mcpGuard = [
    (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
      if (process.env.KILL_SWITCH === "1" || process.env.KILL_SWITCH === "true") {
        res.status(503).json({ error: "Service temporarily disabled" });
        return;
      }
      next();
    },
    rateLimitMiddleware,
  ];

  // POST /mcp — main MCP endpoint (initialize + tool calls)
  app.post("/mcp", ...mcpGuard, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // Enforce the session cap before creating a new session.
    if (sessions.size >= MAX_SESSIONS) evictOldestSession();

    // Create the server BEFORE the transport closure so the `onsessioninitialized`
    // callback captures an already-initialized binding.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport, createdAt: Date.now() });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for server-initiated notifications
  app.get("/mcp", ...mcpGuard, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // DELETE /mcp — close a session (no guards — always allow cleanup)
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: VERSION,
      uptime: process.uptime(),
      tools: ALL_TOOLS.length,
      sessions: sessions.size,
    });
  });

  // Monitoring stats
  app.get("/stats", (_req, res) => {
    const cache = apiCache.stats();
    const total = cache.hits + cache.misses;
    res.json({
      cache: {
        ...cache,
        hitRatePercent: total > 0 ? ((cache.hits / total) * 100).toFixed(1) : "0.0",
      },
      rateLimit: rateLimitStats(),
      uptime: process.uptime(),
      sessions: sessions.size,
      maxSessions: MAX_SESSIONS,
      killSwitch: process.env.KILL_SWITCH === "1" || process.env.KILL_SWITCH === "true",
    });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`sports-leader-mcp HTTP server listening on port ${port}`);
  });
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  if (port) {
    await startHttp(port);
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
