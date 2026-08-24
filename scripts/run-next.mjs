import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2];
const forwardedArguments = process.argv.slice(3);
const supportedCommands = new Set(["dev", "build", "start"]);

if (!command || !supportedCommands.has(command)) {
  console.error("Usage: node scripts/run-next.mjs <dev|build|start> [...arguments]");
  process.exit(1);
}

const projectNode = resolve("node_modules/node/bin/node");
const runtime = existsSync(projectNode) ? projectNode : process.execPath;
const nextCli = resolve("node_modules/next/dist/bin/next");

const versionCheck = spawnSync(runtime, ["--version"], { encoding: "utf8" });
const version = versionCheck.stdout.trim().replace(/^v/, "");
const [major = 0, minor = 0] = version.split(".").map(Number);

if (major < 20 || (major === 20 && minor < 9)) {
  console.error(
    "TravelTrace needs Node 20.9 or newer to run Next.js. Run `npm install` first; it installs a project-local Node 22 runtime automatically.",
  );
  process.exit(1);
}

const result = spawnSync(runtime, [nextCli, command, ...forwardedArguments], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
