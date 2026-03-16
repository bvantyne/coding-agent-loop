import * as path from "node:path";
import { defineConfig } from "vitest/config";

import { makeTypeScriptVitestTransformPlugin } from "./vitest.typescript-transform";

export default defineConfig({
  oxc: false,
  plugins: [makeTypeScriptVitestTransformPlugin("root-vitest-absolute-typescript-transform")],
  resolve: {
    alias: [
      {
        find: /^@t3tools\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
    ],
  },
});
