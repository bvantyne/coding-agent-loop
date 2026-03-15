import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const isWsl = process.platform === "linux" && os.release().toLowerCase().includes("microsoft");
const cmdExecutable =
  process.platform === "win32"
    ? (process.env.COMSPEC ??
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"))
    : "cmd.exe";

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
  const command = ["node", "scripts\\turbo-runner.mjs", ...args].join(" ");

  spawnAndExit(cmdExecutable, ["/d", "/s", "/c", command]);
}

if (isWsl) {
  spawnAndExit("/bin/bash", ["-lc", ["node", "scripts/turbo-runner.mjs", ...args].join(" ")]);
}

spawnAndExit("node", ["scripts/turbo-runner.mjs", ...args]);
