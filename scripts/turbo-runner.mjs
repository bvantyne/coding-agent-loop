import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const isWsl = process.platform === "linux" && os.release().toLowerCase().includes("microsoft");
const shouldUseWindowsTurboInWsl = isWsl && args[0] === "run" && args[1] === "test";
const quoteForCmd = (value) => `"${value.replaceAll('"', '""')}"`;
const createTurboEnv = () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      const upperKey = key.toUpperCase();

      return (
        !upperKey.startsWith("NPM_") && !upperKey.startsWith("BUN_") && upperKey !== "INIT_CWD"
      );
    }),
  );

  if (process.platform !== "win32") {
    return env;
  }

  const windowsPathEntries = (env.PATH ?? "").split(";").filter(Boolean);
  const bunBinDirectory = path.join(os.homedir(), ".bun", "bin");
  const npmShimDirectory = env.APPDATA ? path.join(env.APPDATA, "npm") : undefined;
  const gitCmdDirectoryCandidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "cmd"),
  ];
  const gitCmdDirectory = gitCmdDirectoryCandidates.find((candidate) => fs.existsSync(candidate));
  const normalizedBunBinDirectory = bunBinDirectory.toLowerCase();
  const normalizedNpmShimDirectory = npmShimDirectory?.toLowerCase();
  const normalizedGitCmdDirectory = gitCmdDirectory?.toLowerCase();
  const remainingPathEntries = windowsPathEntries.filter((entry) => {
    const normalizedEntry = entry.toLowerCase();

    return (
      normalizedEntry !== normalizedBunBinDirectory &&
      normalizedEntry !== normalizedNpmShimDirectory &&
      normalizedEntry !== normalizedGitCmdDirectory
    );
  });

  env.PATH = [
    ...(fs.existsSync(bunBinDirectory) ? [bunBinDirectory] : []),
    ...(gitCmdDirectory ? [gitCmdDirectory] : []),
    ...remainingPathEntries,
    ...(npmShimDirectory ? [npmShimDirectory] : []),
  ].join(";");
  env.Path = env.PATH;

  return env;
};
const turboEnv = createTurboEnv();

const spawnAndExit = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
};

if (process.platform === "win32") {
  spawnAndExit(path.join("node_modules", ".bin", "turbo.exe"), args, {
    env: turboEnv,
  });
}

if (shouldUseWindowsTurboInWsl) {
  const windowsCwd = execFileSync("wslpath", ["-w", process.cwd()], {
    encoding: "utf8",
  }).trim();

  const turboArgs = args.map((arg) => (arg.includes(" ") ? quoteForCmd(arg) : arg)).join(" ");
  const command = `cd /d ${windowsCwd} && node_modules\\.bin\\turbo.exe ${turboArgs}`;

  spawnAndExit("cmd.exe", ["/d", "/c", command], {
    env: turboEnv,
  });
}

const turboPath = path.join(process.cwd(), "node_modules", ".bin", "turbo");

if (!fs.existsSync(turboPath)) {
  throw new Error(`Unable to find local turbo binary at ${turboPath}`);
}

spawnAndExit(turboPath, args, {
  env: turboEnv,
});
