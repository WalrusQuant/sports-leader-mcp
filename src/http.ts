import { createMcpHandler, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express from "express";

import { createServer, ALL_TOOLS } from "./server.js";
import { apiCache } from "./client.js";
import { rateLimitMiddleware, rateLimitStats } from "./rate-limit.js";
import { VERSION } from "./version.js";

/** The revision served per request with no handshake (SEP stateless MCP). */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/**
 * Protocol revisions this server answers. 2026-07-28 is served per request;
 * every 2025-era (and 2024-era) revision is still served through the SDK's
 * legacy leg, so existing connectors keep working without changes.
 */
export const PROTOCOL_VERSIONS = {
  modern: [MODERN_PROTOCOL_VERSION],
  legacy: [...SUPPORTED_PROTOCOL_VERSIONS],
};

function killSwitchOn(): boolean {
  return process.env.KILL_SWITCH === "1" || process.env.KILL_SWITCH === "true";
}

/**
 * Express app for HTTP serving (not listening; index.ts and tests do that).
 *
 * Stateless: there is no session map. Every POST /mcp is answered by a fresh
 * server instance from the factory, whether it is a 2026-07-28 request
 * (per-request envelope) or a 2025-era request (served by createMcpHandler's
 * default `legacy: 'stateless'` leg, which runs the old initialize/call flow
 * per request without issuing Mcp-Session-Id). GET and DELETE /mcp, which were
 * only meaningful for sessions, are answered 405 by the SDK.
 */
export function createHttpApp() {
  const handler = createMcpHandler(() => createServer(), {
    onerror: (err) => console.error("[mcp]", err.message),
  });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => console.error("[mcp adapter]", err.message),
  });

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Kill switch + per-IP rate limiting for MCP routes
  const mcpGuard = [
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (killSwitchOn()) {
        res.status(503).json({ error: "Service temporarily disabled" });
        return;
      }
      next();
    },
    rateLimitMiddleware,
  ];

  // All MCP traffic, both eras. The body was already parsed by express.json(),
  // so hand it over rather than letting the adapter re-read the stream.
  app.all("/mcp", ...mcpGuard, (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: VERSION,
      uptime: process.uptime(),
      tools: ALL_TOOLS.length,
      stateless: true,
      protocolVersions: PROTOCOL_VERSIONS,
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
      killSwitch: killSwitchOn(),
    });
  });

  return { app, handler };
}
