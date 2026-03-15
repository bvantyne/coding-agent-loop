import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const isWsl = process.platform === "linux" && os.release().toLowerCase().includes("microsoft");
const runnerArgs = ["scripts/turbo-runner.mjs", ...args];
const resolveNodeExecutable = () => {
  if (process.platform !== "win32") {
    return path.basename(process.execPath).toLowerCase().startsWith("node")
      ? process.execPath
      : "node";
  }

  const configuredNodePath = process.env.NVM_SYMLINK;
  const candidate =
    configuredNodePath === undefined
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe")
      : path.extname(configuredNodePath).toLowerCase() === ".exe"
        ? configuredNodePath
        : path.join(configuredNodePath, "node.exe");

  return fs.existsSync(candidate) ? candidate : "node";
};
const nodeExecutable = resolveNodeExecutable();

const spawnAndExit = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
};

if (process.platform === "win32") {
  spawnAndExit(nodeExecutable, runnerArgs);
}

if (isWsl) {
  spawnAndExit(nodeExecutable, runnerArgs);
}

spawnAndExit(nodeExecutable, runnerArgs);
