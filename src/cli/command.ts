// cli/ — argument parsing and command wiring (the top edge). It builds a TraceRequest,
// drives the orchestrator, and renders the result. Nothing imports this module.

import { Command } from "commander";
import { trace } from "../orchestrator/index.js";
import { render } from "../report/index.js";
import { accountOrigin } from "../types/index.js";
import type { HexString, OutputFormat, TraceRequest, XcmVersion } from "../types/index.js";

// TODO(verify: default result XCM version per target chain — pin once descriptors are
// generated (ADR-0002). v4 is a reasonable current default for system chains.)
const DEFAULT_XCM_VERSION: XcmVersion = 4;
const CALL_HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

/** The raw `--flag` values commander collects for the `trace` subcommand. */
interface TraceFlags {
  readonly rpc: string;
  readonly origin: string;
  readonly call?: string;
  readonly xcm?: string;
  readonly format: string;
}

/** Runs a parsed request to its rendered string. Injectable so the command is testable. */
export type TraceRunner = (request: TraceRequest) => Promise<string>;

const defaultRunner: TraceRunner = async (request) => render(await trace(request), request.format);

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
    .option("--xcm <path>", "planned raw XCM program JSON input (currently unsupported)")
    .option("--format <format>", "output format: human | json", "human")
    .action(async (raw: unknown) => {
      const out = await run(toRequest(parseFlags(raw)));
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
function parseFlags(raw: unknown): TraceFlags {
  /* v8 ignore next -- Commander action handlers provide an option object; this guards malformed internal calls. */
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid CLI options.");
  const bag = raw as Record<string, unknown>;
  return {
    rpc: requireString(bag, "rpc"),
    origin: requireString(bag, "origin"),
    format: optionalString(bag, "format") ?? "human",
    ...(typeof bag["call"] === "string" ? { call: bag["call"] } : {}),
    ...(typeof bag["xcm"] === "string" ? { xcm: bag["xcm"] } : {}),
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

/** Build a validated TraceRequest. Exactly one of --call | --xcm is required. */
function toRequest(flags: TraceFlags): TraceRequest {
  if (flags.call !== undefined && flags.xcm !== undefined) {
    throw new Error("Provide exactly one of --call or --xcm.");
  }
  if (flags.call !== undefined) return callRequest(flags, flags.call);
  if (flags.xcm !== undefined) {
    // TODO(verify: raw-XCM input needs a JSON→XcmProgram parser/validator and client.dryRunXcm;
    // neither exists in Sprint 0. Enable once both land.)
    throw new Error("Raw XCM input (--xcm) is not supported in this build; pass --call.");
  }
  throw new Error("Provide exactly one of --call or --xcm.");
}

function callRequest(flags: TraceFlags, call: string): TraceRequest {
  return {
    rpc: flags.rpc,
    origin: accountOrigin(flags.origin),
    resultXcmVersion: DEFAULT_XCM_VERSION,
    format: parseFormat(flags.format),
    call: asHex(call),
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
