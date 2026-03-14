import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { Effect } from "effect";
import { afterEach, assert, describe, it } from "vitest";

import { clearWorkspaceIndexCache } from "../../workspaceScanner.ts";
import { CodeChunkerLive } from "./CodeChunker.ts";
import { CodeChunker } from "../Services/CodeChunker.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relativePath: string, contents = ""): void {
  const absolutePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}

async function chunkWorkspace(cwd: string) {
  return Effect.gen(function* () {
    const chunker = yield* CodeChunker;
    return yield* chunker.chunkWorkspace({ cwd });
  }).pipe(Effect.provide(CodeChunkerLive), Effect.runPromise);
}

describe("CodeChunkerLive", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      clearWorkspaceIndexCache(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chunks only ts/tsx workspace files and respects ignored directories and gitignored paths", async () => {
    const cwd = makeTempDir("t3code-code-chunker-");
    runGit(cwd, ["init"]);
    writeFile(cwd, ".gitignore", "ignored.ts\n");
    writeFile(cwd, "src/alpha.ts", "export const alpha = 1;");
    writeFile(cwd, "src/bravo.tsx", "export const Bravo = () => <div />;");
    writeFile(cwd, "ignored.ts", "export const nope = 1;");
    writeFile(cwd, "dist/skipped.ts", "export const skipped = true;");
    writeFile(cwd, "node_modules/pkg/index.ts", "export const pkg = true;");

    const chunks = await chunkWorkspace(cwd);
    const filePaths = [...new Set(chunks.map((chunk) => chunk.filePath))];

    assert.deepEqual(filePaths, ["src/alpha.ts", "src/bravo.tsx"]);
  });

  it("returns a stable workspace chunk order across repeated scans", async () => {
    const cwd = makeTempDir("t3code-code-chunker-order-");
    writeFile(cwd, "src/zeta.ts", "export const zeta = 1;");
    writeFile(cwd, "src/alpha.ts", "export const alpha = 1;");
    writeFile(cwd, "src/nested/beta.tsx", "export const Beta = () => <section />;");

    const first = await chunkWorkspace(cwd);
    const second = await chunkWorkspace(cwd);

    assert.deepEqual(
      first.map((chunk) => `${chunk.filePath}:${chunk.startLine}:${chunk.endLine}`),
      second.map((chunk) => `${chunk.filePath}:${chunk.startLine}:${chunk.endLine}`),
    );
  });
});
