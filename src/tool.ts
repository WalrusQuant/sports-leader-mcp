import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { ResourceLinkContent } from "./links.js";

/** Extra information handed to a transform alongside the raw ESPN response. */
export interface TransformContext<A = Record<string, unknown>> {
  /** Validated tool arguments (without the auto-injected `raw` flag). */
  args: A;
  /**
   * Optional supplementary data fetched by the tool's `context` hook (compact
   * mode only). Undefined when the tool has no hook or the hook failed.
   */
  context?: unknown;
}

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
  /**
   * Optional zod object schema describing the compact output. Exposed as the
   * MCP `outputSchema`; the server validates `structuredContent` against it.
   */
  outputSchema?: z.ZodObject<z.ZodRawShape>;
  /**
   * Optional compaction function applied to the raw ESPN response before it is
   * returned to the agent. Bypassed when the caller passes `raw=true`.
   * The server also applies a token-budget backstop after the transform.
   */
  transform?: (data: unknown, ctx: TransformContext<z.infer<z.ZodObject<S>>>) => unknown;
  /**
   * Optional hook that fetches supplementary data for the transform (e.g. event
   * metadata for odds). Runs only in compact mode so `raw=true` output and its
   * upstream call pattern are unchanged. Failures are swallowed: the transform
   * receives `context: undefined` and must degrade gracefully.
   */
  context?: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
  /**
   * Optional resource links appended to the content array in compact mode
   * (after the text block), pointing at espn:// resource templates for large
   * sub-payloads. Clients that ignore links lose nothing.
   */
  links?: (args: z.infer<z.ZodObject<S>>, data: unknown) => ResourceLinkContent[];
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
