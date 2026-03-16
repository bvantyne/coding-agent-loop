import { transformWithEsbuild, type Plugin } from "vite";

export function makeTypeScriptVitestTransformPlugin(name: string): Plugin {
  return {
    name,
    enforce: "pre",
    async transform(code, id) {
      const [filePath] = id.split("?", 1);
      if (!filePath || filePath.includes("/node_modules/")) {
        return null;
      }
      if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
        const isTsx = filePath.endsWith(".tsx");
        return transformWithEsbuild(code, filePath, {
          format: "esm",
          loader: isTsx ? "tsx" : "ts",
          ...(isTsx ? { jsx: "automatic" as const, jsxImportSource: "react" } : {}),
          target: "esnext",
        });
      }
      return null;
    },
  };
}
