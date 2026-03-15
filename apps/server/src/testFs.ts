import fs from "node:fs";

export const removeTempDirSync = (dir: string) => {
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
};
