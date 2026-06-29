#!/usr/bin/env node
// cli/ — entrypoint. Top edge: nothing imports it (architecture rule 4).
import { runCli } from "./command.js";

runCli(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cartographer: ${message}\n`);
  process.exitCode = 1;
});
