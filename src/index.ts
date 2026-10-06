#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";
import { createHttpApp, MODERN_PROTOCOL_VERSION } from "./http.js";

/**
 * stdio: serveStdio reads the opening message and pins one server instance
 * for the connection. A 2025-era `initialize` gets the classic handshake; a
 * 2026-07-28 request is served directly. Same factory either way.
 */
function startStdio() {
  serveStdio(() => createServer());
}

function startHttp(port: number) {
  const { app, handler } = createHttpApp();
  const httpServer = app.listen(port, "0.0.0.0", () => {
    console.log(`sports-leader-mcp HTTP server listening on port ${port} (stateless; MCP ${MODERN_PROTOCOL_VERSION} + 2025-era)`);
  });
  const shutdown = () => {
    void handler.close().finally(() => httpServer.close(() => process.exit(0)));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  if (port) startHttp(port);
  else startStdio();
}

try {
  main();
} catch (err) {
  console.error("Fatal:", err);
  process.exit(1);
}
