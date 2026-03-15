import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RETRYABLE_RM_SYNC_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const RETRYABLE_RM_SYNC_ATTEMPTS = 20;
const RETRYABLE_RM_SYNC_DELAY_MS = 50;

const sleepSync = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const isTempPath = (targetPath: Parameters<typeof fs.rmSync>[0]) => {
  if (typeof targetPath !== "string") {
    return false;
  }

  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedTempDirectory = path.resolve(os.tmpdir());

  return (
    resolvedTargetPath === resolvedTempDirectory ||
    resolvedTargetPath.startsWith(`${resolvedTempDirectory}${path.sep}`)
  );
};

if (process.platform === "win32") {
  const originalRmSync = fs.rmSync.bind(fs);

  fs.rmSync = ((targetPath, options) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return originalRmSync(targetPath, options);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : undefined;

        if (
          code === undefined ||
          !RETRYABLE_RM_SYNC_CODES.has(code) ||
          attempt >= RETRYABLE_RM_SYNC_ATTEMPTS - 1
        ) {
          if (code !== undefined && RETRYABLE_RM_SYNC_CODES.has(code) && isTempPath(targetPath)) {
            return;
          }
          throw error;
        }

        sleepSync(RETRYABLE_RM_SYNC_DELAY_MS * (attempt + 1));
      }
    }
  }) as typeof fs.rmSync;
}
