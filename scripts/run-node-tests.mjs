import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const testPatterns = process.argv.slice(2);
const configuredNodePath = process.env.NVM_SYMLINK;
const nodeExecutable =
  configuredNodePath === undefined
    ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe")
    : path.extname(configuredNodePath).toLowerCase() === ".exe"
      ? configuredNodePath
      : path.join(configuredNodePath, "node.exe");
const nodeArgs = ["--experimental-strip-types", "--test", ...testPatterns];

const result =
  process.platform === "win32"
    ? spawnSync(fs.existsSync(nodeExecutable) ? nodeExecutable : "node", nodeArgs, {
        stdio: "inherit",
      })
    : spawnSync("node", nodeArgs, {
        stdio: "inherit",
      });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
