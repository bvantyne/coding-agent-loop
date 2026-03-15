import { transformWithEsbuild } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    oxc: false,
    plugins: [
      {
        name: "server-vitest-absolute-typescript-transform",
        enforce: "pre",
        async transform(code, id) {
          const [filePath] = id.split("?", 1);
          if (!filePath || filePath.includes("/node_modules/")) {
            return null;
          }
          if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
            return transformWithEsbuild(code, filePath, {
              format: "esm",
              loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
              target: "esnext",
            });
          }
          return null;
        },
      },
    ],
    test: {
      fileParallelism: false,
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  }),
);
