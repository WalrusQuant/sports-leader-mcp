/**
 * One stdio child for the Python lab. Started on the first lab tool call,
 * reused after that, and stopped when this process exits.
 *
 * The sports data tools never touch this module's child. If uv is missing,
 * a lab call fails with a message and the rest of the server keeps working.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

import { VERSION } from "../version.js";

const UV_HELP =
  "The research lab needs uv on PATH and Python 3.11, 3.12, or 3.13. " +
  "Install uv from https://docs.astral.sh/uv/ and call this tool again. " +
  "The other sports-leader tools do not need uv.";

let pending: Promise<Client> | null = null;
let transport: StdioClientTransport | null = null;
let stderrTail = "";
let hooksInstalled = false;

export function labDirectory(): string {
  return fileURLToPath(new URL("../../lab", import.meta.url));
}

export function labUvCommand(): string {
  const override = process.env.SPORTSLEADER_LAB_UV?.trim();
  return override && override.length > 0 ? override : "uv";
}

export async function callLabTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await ensureClient();
  const result = await client.callTool({ name, arguments: compact(args) });
  if (result.isError) {
    throw new Error(textOf(result) || `lab tool ${name} failed`);
  }
  const structured = result.structuredContent;
  if (structured !== undefined && structured !== null && typeof structured === "object" && !Array.isArray(structured)) {
    return structured;
  }
  const text = textOf(result);
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text };
    }
  }
  return { text };
}

export async function closeLab(): Promise<void> {
  const current = transport;
  pending = null;
  transport = null;
  stderrTail = "";
  if (!current) return;
  await current.close().catch(() => undefined);
}

/** Test hook. Closes a live child so the next call starts clean. */
export async function resetLabForTests(): Promise<void> {
  await closeLab();
}

async function ensureClient(): Promise<Client> {
  installHooks();
  if (!pending) {
    pending = start().catch((err: unknown) => {
      pending = null;
      throw toLabError(err);
    });
  }
  return pending;
}

async function start(): Promise<Client> {
  const dir = labDirectory();
  if (!existsSync(`${dir}/pyproject.toml`)) {
    throw new Error(
      `The research lab files are not next to this server (looked in ${dir}). ` +
        "Use a checkout of sports-leader-mcp so lab/ is present. " +
        UV_HELP,
    );
  }
  const child = new StdioClientTransport({
    command: labUvCommand(),
    args: ["run", "--directory", dir, "python", "-m", "sports_leader_lab"],
    cwd: dir,
    env: childEnv(),
    stderr: "pipe",
  });
  stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000);
  });
  const client = new Client({ name: "sports-leader-mcp", version: VERSION });
  transport = child;
  try {
    await client.connect(child);
  } catch (err) {
    transport = null;
    await child.close().catch(() => undefined);
    throw err;
  }
  child.onclose = () => {
    if (transport === child) {
      transport = null;
      pending = null;
    }
  };
  return client;
}

function childEnv(): Record<string, string> {
  const env = getDefaultEnvironment();
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("SPORTSLEADER_") || key.startsWith("UV_") || key === "TMPDIR" || key === "TMP" || key === "TEMP") {
      env[key] = value;
    }
  }
  return env;
}

function compact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toLabError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const missing = /ENOENT|spawn .*uv/i.test(raw) || /ENOENT/.test(stderrTail);
  if (missing) return new Error(UV_HELP);
  const detail = stderrTail.trim();
  if (detail) return new Error(`${raw}\n${detail}`.trim());
  return err instanceof Error ? err : new Error(raw);
}

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", () => {
    const pid = transport?.pid;
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        // The child is already gone.
      }
    }
  });
}
