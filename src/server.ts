import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { scoreboardTools } from "./tools/scoreboard.js";
import { leagueTools } from "./tools/league.js";
import { teamTools } from "./tools/teams.js";
import { athleteTools } from "./tools/athletes.js";
import { discoveryTools } from "./tools/discovery.js";
import type { AnyToolDef } from "./tool.js";
import { UpstreamError } from "./client.js";
import { applyBudget } from "./transforms.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { VERSION } from "./version.js";

export const ALL_TOOLS: AnyToolDef[] = [
  ...scoreboardTools,
  ...leagueTools,
  ...teamTools,
  ...athleteTools,
  ...discoveryTools,
];

/**
 * Auto-injected on every tool. Lets the caller opt out of compaction and get
 * the raw ESPN response. Individual tool definitions never declare this — it's
 * added centrally so it can't be forgotten or drift between tools.
 */
const rawParam = z
  .boolean()
  .optional()
  .describe(
    "Return the raw ESPN API response without compaction. Defaults to false (compact). " +
      "Use true only when you need a field omitted by the compact view.",
  );

/**
 * Render a tool result to MCP text content. If `data` is already a string
 * (e.g. the budget guard returned a pre-formatted truncation notice), pass it
 * through without re-serializing.
 */
function toTextResult(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
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

// Default annotations for read-only ESPN fetch tools. Individual tools can
// override by setting `annotations` on their ToolDef.
const READ_ONLY_ANNOTATIONS = {
  title: "",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "sports-leader-mcp",
    version: VERSION,
  });

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: { ...tool.inputShape, raw: rawParam },
        annotations: {
          ...READ_ONLY_ANNOTATIONS,
          title: tool.title,
          ...(tool.annotations ?? {}),
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          // `raw` is consumed here, never passed to the tool handler.
          const { raw, ...rest } = args;
          const compact = raw !== true;

          let data: unknown = await tool.handler(rest as never);

          // Apply the tool's curated transform unless the caller asked for raw.
          if (compact && tool.transform) {
            data = tool.transform(data);
          }

          // Token-budget backstop always applies, even in raw mode, so an
          // untransformed response can never overflow the agent's context.
          data = applyBudget(data);

          return toTextResult(data);
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  }

  registerPrompts(server);
  registerResources(server);

  return server;
}
