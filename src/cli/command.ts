// cli/ — argument parsing and command wiring (the top edge). It builds a TraceRequest,
// drives the orchestrator, and renders the result. Nothing imports this module.

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { createStaticRegistry } from "../registry/index.js";
import type { ChainEndpoint } from "../registry/index.js";
import { trace } from "../orchestrator/index.js";
import type { TraceDeps } from "../orchestrator/index.js";
import { render } from "../report/index.js";
import { accountOrigin, location, locationOrigin, xcmInstruction, xcmProgram } from "../types/index.js";
import type {
  HexString,
  Location,
  NormalizedValue,
  OutputFormat,
  TraceRequest,
  XcmInstruction,
  XcmProgram,
  XcmVersion,
} from "../types/index.js";

// TODO(verify: default result XCM version per target chain — pin once descriptors are
// generated (ADR-0002). v4 is a reasonable current default for system chains.)
const DEFAULT_XCM_VERSION: XcmVersion = 4;
const CALL_HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

/** The raw `--flag` values commander collects for the `trace` subcommand. */
interface TraceFlagValues {
  readonly rpc: string;
  readonly origin: string;
  readonly call?: string;
  readonly xcm?: string;
  readonly registry?: string;
  readonly maxDepth?: string;
  readonly format: string;
}

interface TraceInvocation {
  readonly request: TraceRequest;
  readonly deps?: TraceDeps;
}

/** Runs a parsed request to its rendered string. Injectable so the command is testable. */
export type TraceRunner = (request: TraceRequest, deps?: TraceDeps) => Promise<string>;

const defaultRunner: TraceRunner = async (request, deps) =>
  render(deps === undefined ? await trace(request) : await trace(request, deps), request.format);

/**
 * Build the `cartographer` program. `run` is injected (defaults to the real pipeline) so
 * tests can drive the command without a network. `exitOverride` makes failures throw
 * instead of calling `process.exit`, so the caller owns error reporting.
 */
export function buildProgram(run: TraceRunner = defaultRunner): Command {
  const program = new Command();
  program.name("cartographer").description("Dry-run XCM-related calls and diagnose the outcome.");
  program
    .command("trace")
    .description("Dry-run a call on a chain and report the outcome.")
    .requiredOption("--rpc <url>", "WebSocket RPC endpoint of the origin chain")
    .requiredOption("--origin <caller>", "origin caller (SS58 address or dev seed, e.g. //Alice)")
    .option("--call <hex>", "SCALE-encoded call to dry-run (0x-prefixed)")
    .option("--xcm <path>", "raw XCM program JSON input")
    .option("--registry <path>", "static route registry JSON input for multi-hop tracing")
    .option("--max-depth <count>", "maximum total hops to follow when using a registry")
    .option("--format <format>", "output format: human | json", "human")
    .action(async (raw: unknown) => {
      const invocation = await toInvocation(parseFlags(raw));
      const out = await run(invocation.request, invocation.deps);
      process.stdout.write(`${out}\n`);
    });
  program.exitOverride();
  return program;
}

/** Parse `process.argv` and execute. */
export async function runCli(argv: readonly string[]): Promise<void> {
  await buildProgram().parseAsync(Array.from(argv));
}

/** Narrow commander's option bag (typed as a loose record) into our typed flags. */
function parseFlags(raw: unknown): TraceFlagValues {
  /* v8 ignore next -- Commander action handlers provide an option object; this guards malformed internal calls. */
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid CLI options.");
  const bag = raw as Record<string, unknown>;
  return {
    rpc: requireString(bag, "rpc"),
    origin: requireString(bag, "origin"),
    format: optionalString(bag, "format") ?? "human",
    ...(typeof bag["call"] === "string" ? { call: bag["call"] } : {}),
    ...(typeof bag["xcm"] === "string" ? { xcm: bag["xcm"] } : {}),
    ...(typeof bag["registry"] === "string" ? { registry: bag["registry"] } : {}),
    ...(typeof bag["maxDepth"] === "string" ? { maxDepth: bag["maxDepth"] } : {}),
  };
}

function requireString(bag: Record<string, unknown>, key: string): string {
  const value = bag[key];
  if (typeof value !== "string") throw new Error(`Missing required option --${key}.`);
  return value;
}

function optionalString(bag: Record<string, unknown>, key: string): string | undefined {
  const value = bag[key];
  return typeof value === "string" ? value : undefined;
}

/** Build a validated trace invocation. Exactly one of --call | --xcm is required. */
async function toInvocation(flags: TraceFlagValues): Promise<TraceInvocation> {
  const request = await toRequest(flags);
  const deps = await toTraceDeps(flags);
  return { request, ...(deps ? { deps } : {}) };
}

/** Build a validated TraceRequest. Exactly one of --call | --xcm is required. */
async function toRequest(flags: TraceFlagValues): Promise<TraceRequest> {
  if (flags.call !== undefined && flags.xcm !== undefined) {
    throw new Error("Provide exactly one of --call or --xcm.");
  }
  if (flags.call !== undefined) return callRequest(flags, flags.call);
  if (flags.xcm !== undefined) return xcmRequest(flags, await readXcmProgram(flags.xcm));
  throw new Error("Provide exactly one of --call or --xcm.");
}

async function toTraceDeps(flags: TraceFlagValues): Promise<TraceDeps | undefined> {
  const registry = flags.registry !== undefined ? await readRegistry(flags.registry) : undefined;
  const maxDepth = parseMaxDepth(flags.maxDepth);
  if (registry === undefined && maxDepth === undefined) return undefined;
  return {
    ...(registry !== undefined ? { registry } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  };
}

function callRequest(flags: TraceFlagValues, call: string): TraceRequest {
  return {
    rpc: flags.rpc,
    origin: accountOrigin(flags.origin),
    resultXcmVersion: DEFAULT_XCM_VERSION,
    format: parseFormat(flags.format),
    call: asHex(call),
  };
}

function xcmRequest(flags: TraceFlagValues, xcm: XcmProgram): TraceRequest {
  return {
    rpc: flags.rpc,
    origin: parseLocationOrigin(flags.origin),
    resultXcmVersion: DEFAULT_XCM_VERSION,
    format: parseFormat(flags.format),
    xcm,
  };
}

function parseFormat(value: string): OutputFormat {
  if (value === "human" || value === "json") return value;
  throw new Error(`Unknown --format '${value}'. Use human | json.`);
}

function asHex(value: string): HexString {
  if (!CALL_HEX_PATTERN.test(value)) {
    throw new Error("--call must be a 0x-prefixed, even-length SCALE hex string.");
  }
  return value as HexString;
}

async function readXcmProgram(path: string): Promise<XcmProgram> {
  return parseXcmProgram(JSON.parse(await readFile(path, "utf8")));
}

function parseXcmProgram(value: unknown): XcmProgram {
  const input = record(value, "raw XCM input");
  const version = parseXcmVersion(input["version"]);
  const rawInstructions = array(input["instructions"], "raw XCM instructions");
  return xcmProgram(version, rawInstructions.map(parseXcmInstruction));
}

function parseXcmInstruction(value: unknown): XcmInstruction {
  const input = record(value, "raw XCM instruction");
  const kind = input["kind"];
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error("Raw XCM instruction kind must be a non-empty string.");
  }
  return xcmInstruction(kind, input["args"] === undefined ? undefined : normalized(input["args"], "instruction args"));
}

function parseLocationOrigin(value: string): ReturnType<typeof locationOrigin> {
  return locationOrigin(parseLocation(JSON.parse(value), "--origin location"));
}

async function readRegistry(path: string): Promise<TraceDeps["registry"]> {
  return parseRegistry(JSON.parse(await readFile(path, "utf8")));
}

function parseRegistry(value: unknown): TraceDeps["registry"] {
  const input = record(value, "registry file");
  const chains = array(input["chains"], "registry chains");
  return createStaticRegistry(chains.map(parseChainEndpoint));
}

function parseChainEndpoint(value: unknown): ChainEndpoint {
  const input = record(value, "registry chain");
  const rpc = input["rpc"];
  if (typeof rpc !== "string" || rpc.length === 0) {
    throw new Error("Registry chain rpc must be a non-empty string.");
  }
  return {
    rpc,
    location: parseLocation(input["location"], "registry chain location"),
    ...(typeof input["name"] === "string" ? { name: input["name"] } : {}),
  };
}

function parseLocation(value: unknown, label: string): Location {
  const input = record(value, label);
  const parents = input["parents"];
  if (typeof parents !== "number" || !Number.isInteger(parents) || parents < 0) {
    throw new Error(`${label} parents must be a non-negative integer.`);
  }
  return location(parents, normalized(input["interior"] ?? "Here", "location interior"));
}

function parseMaxDepth(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--max-depth must be a positive integer.");
  }
  return parsed;
}

function parseXcmVersion(value: unknown): XcmVersion {
  if (value === 2 || value === 3 || value === 4 || value === 5) return value;
  throw new Error("Raw XCM version must be one of 2, 3, 4, or 5.");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be a JSON object.`);
}

function array(value: unknown, label: string): readonly unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`${label} must be an array.`);
}

function normalized(value: unknown, label: string): NormalizedValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalized(item, label));
  if (typeof value === "object") return normalizeRecord(value as Record<string, unknown>, label);
  throw new Error(`${label} contains a value unsupported by JSON.`);
}

function normalizeRecord(value: Record<string, unknown>, label: string): NormalizedValue {
  const out: Record<string, NormalizedValue> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = normalized(item, label);
  }
  return out;
}
