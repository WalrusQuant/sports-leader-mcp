import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { scoreboardTools } from "./tools/scoreboard.js";
import { leagueTools } from "./tools/league.js";
import { teamTools } from "./tools/teams.js";
import { athleteTools } from "./tools/athletes.js";
import { discoveryTools } from "./tools/discovery.js";
import { slateTools } from "./tools/slate.js";
import type { AnyToolDef } from "./tool.js";
import { UpstreamError } from "./client.js";
import { applyBudget } from "./transforms.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { VERSION } from "./version.js";
import type { ResourceLinkContent } from "./links.js";
import { registerResourceTemplates } from "./resource-templates.js";

export const ALL_TOOLS: AnyToolDef[] = [
  ...scoreboardTools,
  ...leagueTools,
  ...teamTools,
  ...athleteTools,
  ...discoveryTools,
  ...slateTools,
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

type ToolResult = {
  content: Array<{ type: "text"; text: string } | ResourceLinkContent>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Render compact JSON without pretty-print whitespace. Object responses are
 * also exposed through structuredContent. Top-level arrays are wrapped as
 * `{ items: [...] }` because the current SDK requires an object there.
 */
function toTextResult(data: unknown, structured?: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const result: ToolResult = {
    content: [{ type: "text" as const, text }],
  };
  const sc = structured === undefined ? data : structured;
  if (Array.isArray(sc)) {
    result.structuredContent = { items: sc };
  } else if (sc !== null && typeof sc === "object") {
    result.structuredContent = sc as Record<string, unknown>;
  }
  return result;
}

function toErrorResult(err: unknown): ToolResult {
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

/**
 * Fetch + transform + budget for one call. Shared by tool calls and
 * resource-template reads so both return identical compact JSON.
 */
export async function produce(tool: AnyToolDef, rest: Record<string, unknown>, compact: boolean): Promise<unknown> {
  const contextP: Promise<unknown> =
    compact && tool.transform && tool.context
      ? tool.context(rest as never).catch(() => undefined)
      : Promise.resolve(undefined);

  let data: unknown = await tool.handler(rest as never);

  // Apply the tool's curated transform unless the caller asked for raw.
  if (compact && tool.transform) {
    data = tool.transform(data, { args: rest, context: await contextP });
  }

  // Token-budget backstop always applies, even in raw mode, so an
  // untransformed response can never overflow the agent's context.
  return applyBudget(data);
}

/**
 * Execute one tool call end to end: fetch, optional context fetch, transform,
 * token budget, result shaping, and resource links. Exported for tests.
 */
export async function runTool(tool: AnyToolDef, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    // `raw` is consumed here, never passed to the tool handler.
    const { raw, ...rest } = args;
    const compact = raw !== true;
    const data = await produce(tool, rest, compact);

    // Tools with an outputSchema describe the compact shape. In raw mode the
    // text block is still the untouched ESPN JSON, while structuredContent
    // wraps it as { raw: true, response } so it remains schema-valid.
    const isEnvelope =
      data !== null && typeof data === "object" && (data as Record<string, unknown>).truncated === true;
    if (tool.outputSchema && !compact && !isEnvelope) {
      return toTextResult(data, { raw: true, response: data });
    }
    const result = toTextResult(data);
    if (compact && !isEnvelope && tool.links) {
      result.content.push(...tool.links(rest as never, data));
    }
    return result;
  } catch (err) {
    return toErrorResult(err);
  }
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
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: {
          ...READ_ONLY_ANNOTATIONS,
          title: tool.title,
          ...(tool.annotations ?? {}),
        },
      },
      async (args: Record<string, unknown>) => runTool(tool, args),
    );
  }

  registerPrompts(server);
  registerResources(server);
  registerResourceTemplates(server, ALL_TOOLS, (tool, args) => produce(tool, args, true));

  return server;
}
