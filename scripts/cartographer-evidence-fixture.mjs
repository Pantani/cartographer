import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { fileURLToPath } from "node:url";

const MARKER = "CARTOGRAPHER_IT_EVIDENCE ";

/** Extract parsed CARTOGRAPHER_IT_EVIDENCE JSON envelopes from mixed command logs. */
export function extractEvidenceBlocks(log) {
  const blocks = [];
  let offset = 0;
  while (offset < log.length) {
    const marker = log.indexOf(MARKER, offset);
    if (marker === -1) return blocks;
    const block = readJsonBlock(log, marker + MARKER.length);
    blocks.push(JSON.parse(block.json));
    offset = block.end;
  }
  return blocks;
}

/** Convert one live evidence envelope into a diagnostics fixture entry. */
export function toDiagnosticsFixture(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.normalizedEffects)) {
    throw new Error("CARTOGRAPHER_IT_EVIDENCE entry must include normalizedEffects.");
  }
  return {
    name: fixtureName(typeof evidence.label === "string" ? evidence.label : "fixture"),
    effects: evidence.normalizedEffects,
  };
}

/** Render extracted evidence as a deterministic TypeScript diagnostics fixture module. */
export function renderDiagnosticsFixtureModule(evidences) {
  const entries = evidences.map(toDiagnosticsFixture).map(renderFixtureEntry);
  return [
    "// Generated from scrubbed CARTOGRAPHER_IT_EVIDENCE logs. Review before committing.",
    'import type { DryRunEffects } from "../../types/index.js";',
    "",
    "export const liveDryRunFixtures = {",
    ...entries,
    "} satisfies Record<string, DryRunEffects>;",
    "",
  ].join("\n");
}

/** Resolve the optional evidence-log path while tolerating package-manager separators. */
export function resolveInputPath(argv) {
  const paths = argv.slice(2).filter((argument) => argument !== "--");
  if (paths.length > 1) throw new Error("Usage: cartographer-evidence-fixture [evidence-log]");
  return paths[0];
}

function readJsonBlock(source, start) {
  const jsonStart = skipWhitespace(source, start);
  assertJsonObjectStart(source, jsonStart);
  const jsonEnd = findJsonBlockEnd(source, jsonStart);
  return { json: source.slice(jsonStart, jsonEnd + 1), end: jsonEnd + 1 };
}

function assertJsonObjectStart(source, jsonStart) {
  if (source[jsonStart] !== "{") {
    throw new Error("CARTOGRAPHER_IT_EVIDENCE marker must be followed by a JSON object.");
  }
}

function findJsonBlockEnd(source, start) {
  let state = { depth: 0, inString: false, escaped: false };
  for (let index = start; index < source.length; index += 1) {
    state = advanceJsonState(state, source[index]);
    if (!state.inString && state.depth === 0) return index;
  }
  throw new Error("Unterminated CARTOGRAPHER_IT_EVIDENCE JSON object.");
}

function advanceJsonState(state, char) {
  if (state.inString) return advanceJsonStringState(state, char);
  if (char === "\"") return { ...state, inString: true };
  return { ...state, depth: nextDepth(state.depth, char) };
}

function advanceJsonStringState(state, char) {
  if (state.escaped) return { ...state, escaped: false };
  if (char === "\\") return { ...state, escaped: true };
  if (char === "\"") return { ...state, inString: false };
  return state;
}

function nextDepth(depth, char) {
  if (char === "{" || char === "[") return depth + 1;
  if (char === "}" || char === "]") return depth - 1;
  return depth;
}

function skipWhitespace(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fixtureName(label) {
  const words = label.match(/[A-Za-z0-9]+/g) ?? ["fixture"];
  const [first = "fixture", ...rest] = words;
  const name = [first.toLowerCase(), ...rest.map(capitalize)].join("");
  return /^\d/.test(name) ? `fixture${capitalize(name)}` : name;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderFixtureEntry(fixture) {
  return `  ${fixture.name}: ${indent(json(fixture.effects), 2)},`;
}

function json(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value.replace(/\n/g, `\n${prefix}`);
}

const defaultRuntime = {
  readFile: (path) => readFile(path, "utf8"),
  readStdin,
  write: (output) => process.stdout.write(output),
};

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(path, runtime) {
  if (path) return runtime.readFile(path);
  return runtime.readStdin();
}

/** Run the fixture generator with injectable I/O; CLI behavior stays stdout-only. */
export async function main(argv, runtime = defaultRuntime) {
  const input = await readInput(resolveInputPath(argv), runtime);
  runtime.write(renderDiagnosticsFixtureModule(extractEvidenceBlocks(input)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv);
}
