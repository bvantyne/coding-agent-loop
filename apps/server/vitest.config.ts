import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";
import { makeTypeScriptVitestTransformPlugin } from "../../vitest.typescript-transform";

export default mergeConfig(
  baseConfig,
  defineConfig({
    oxc: false,
    plugins: [makeTypeScriptVitestTransformPlugin("server-vitest-absolute-typescript-transform")],
    test: {
      fileParallelism: false,
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  }),
);
