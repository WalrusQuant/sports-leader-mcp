import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { scoreboardTools } from "./tools/scoreboard.js";
import { leagueTools } from "./tools/league.js";
import { teamTools } from "./tools/teams.js";
import { athleteTools } from "./tools/athletes.js";
import { discoveryTools } from "./tools/discovery.js";
import type { AnyToolDef } from "./tool.js";
import { UpstreamError } from "./client.js";
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
        inputSchema: tool.inputShape,
        annotations: {
          ...READ_ONLY_ANNOTATIONS,
          title: tool.title,
          ...(tool.annotations ?? {}),
        },
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

  registerPrompts(server);
  registerResources(server);

  return server;
}
