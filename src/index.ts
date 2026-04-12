#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { scoreboardTools } from "./tools/scoreboard.js";
import { leagueTools } from "./tools/league.js";
import { teamTools } from "./tools/teams.js";
import { athleteTools } from "./tools/athletes.js";
import { discoveryTools } from "./tools/discovery.js";
import type { ToolDef } from "./tool.js";
import { UpstreamError } from "./client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: ToolDef<any>[] = [
  ...scoreboardTools,
  ...leagueTools,
  ...teamTools,
  ...athleteTools,
  ...discoveryTools,
];

function toTextResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toErrorResult(err: unknown) {
  let message: string;
  if (err instanceof UpstreamError) {
    message = `Upstream error ${err.status} from ${err.url}: ${err.message}${err.body ? `\n${err.body}` : ""}`;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "sports-leader-mcp",
    version: "0.1.0",
  });

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await tool.handler(args as never);
          return toTextResult(data);
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  }

  return server;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(port: number) {
  const app = express();
  app.use(express.json());

  // Map of session ID → { server, transport }
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  // POST /mcp — main MCP endpoint (initialize + tool calls)
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for server-initiated notifications
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // DELETE /mcp — close a session
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
    res.json({ status: "ok", tools: ALL_TOOLS.length });
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
