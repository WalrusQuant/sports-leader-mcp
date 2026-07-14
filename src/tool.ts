import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputShape: S;
  /**
   * Optional MCP annotations. Defaults to read-only/idempotent when omitted
   * (every current tool is a read-only ESPN fetch); set explicitly when a tool
   * needs different hints.
   */
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/**
 * ToolDef with the shape generic erased, for registries that hold tools of many
 * different shapes. Contains the `any` in one named place instead of scattering
 * it across call sites with eslint-disables.
 */
export type AnyToolDef = ToolDef<any>;
