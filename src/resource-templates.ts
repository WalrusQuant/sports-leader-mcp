import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import type { AnyToolDef } from "./tool.js";
import { RESOURCE_TEMPLATES } from "./links.js";

type Produce = (tool: AnyToolDef, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Register the espn:// resource templates. Template variables are validated
 * with the backing tool's own input schema (slug regexes etc.) before any
 * upstream request, so a crafted URI can't reach an arbitrary ESPN path.
 */
export function registerResourceTemplates(server: McpServer, tools: AnyToolDef[], produce: Produce): void {
  for (const def of RESOURCE_TEMPLATES) {
    const tool = tools.find((t) => t.name === def.tool);
    if (!tool) throw new Error(`resource template ${def.name} references unknown tool ${def.tool}`);
    const schema = z.object(tool.inputShape);

    server.registerResource(
      def.name,
      new ResourceTemplate(def.uriTemplate, { list: undefined }),
      { title: def.title, description: def.description, mimeType: "application/json" },
      async (uri, variables) => {
        const args: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          args[k] = decodeURIComponent(Array.isArray(v) ? v[0] : v);
        }
        const parsed = schema.safeParse(args);
        if (!parsed.success) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid ${def.uriTemplate} variables: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );
        }
        const data = await produce(tool, parsed.data);
        return {
          contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }],
        };
      },
    );
  }
}
