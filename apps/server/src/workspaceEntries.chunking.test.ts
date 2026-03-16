import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";

import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessRunOptions, ProcessRunResult } from "./processRunner";

const { runProcessMock } = vi.hoisted(() => ({
  runProcessMock:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options?: ProcessRunOptions,
      ) => Promise<ProcessRunResult>
    >(),
}));

vi.mock("./processRunner", () => ({
  runProcess: runProcessMock,
}));

function processResult(
  overrides: Partial<ProcessRunResult> & Pick<ProcessRunResult, "stdout" | "code">,
): ProcessRunResult {
  return {
    stdout: overrides.stdout,
    code: overrides.code,
    stderr: overrides.stderr ?? "",
    signal: overrides.signal ?? null,
    timedOut: overrides.timedOut ?? false,
    stdoutTruncated: overrides.stdoutTruncated ?? false,
    stderrTruncated: overrides.stderrTruncated ?? false,
  };
}

function directoryEntry(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  } as Dirent;
}

function fileEntry(name: string): Dirent {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  } as Dirent;
}

describe("searchWorkspaceEntries git-ignore chunking", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runProcessMock.mockReset();
    vi.resetModules();
  });

  it("chunks git check-ignore stdin to avoid building giant strings", async () => {
    const ignoredPaths = Array.from(
      { length: 5000 },
      (_, index) => `ignored/${index.toString().padStart(5, "0")}/${"x".repeat(80)}.ts`,
    );
    const keptPaths = ["src/keep.ts", "docs/readme.md"];
    const listedPaths = [...ignoredPaths, ...keptPaths];
    let checkIgnoreCalls = 0;

    runProcessMock.mockImplementation(async (_command, args, options) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "true\n" });
      }

      if (args[0] === "ls-files") {
        return processResult({ code: 0, stdout: `${listedPaths.join("\0")}\0` });
      }

      if (args[0] === "check-ignore") {
        checkIgnoreCalls += 1;
        const chunkPaths = (options?.stdin ?? "").split("\0").filter((value) => value.length > 0);
        const chunkIgnored = chunkPaths.filter((value) => value.startsWith("ignored/"));
        return processResult({
          code: chunkIgnored.length > 0 ? 0 : 1,
          stdout: chunkIgnored.length > 0 ? `${chunkIgnored.join("\0")}\0` : "",
        });
      }

      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    const { searchWorkspaceEntries } = await import("./workspaceEntries");
    const result = await searchWorkspaceEntries({
      cwd: "/virtual/workspace",
      query: "",
      limit: 100,
    });

    assert.isAbove(checkIgnoreCalls, 1);
    assert.isFalse(result.entries.some((entry) => entry.path.startsWith("ignored/")));
    assert.isTrue(result.entries.some((entry) => entry.path === "src/keep.ts"));
  });

  it("returns all workspace files even when the search index truncates large scans", async () => {
    const listedPaths = Array.from(
      { length: 25_010 },
      (_, index) => `src/file-${index.toString().padStart(5, "0")}.ts`,
    );

    runProcessMock.mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "true\n" });
      }

      if (args[0] === "ls-files") {
        return processResult({ code: 0, stdout: `${listedPaths.join("\0")}\0` });
      }

      if (args[0] === "check-ignore") {
        return processResult({ code: 1, stdout: "" });
      }

      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    const { listWorkspaceFiles } = await import("./workspaceScanner");
    const files = await listWorkspaceFiles("/virtual/workspace", new Set([".ts"]));

    assert.lengthOf(files, 25_010);
    assert.equal(files[0], "src/file-00000.ts");
    assert.equal(files.at(-1), "src/file-25009.ts");
  });

  it("keeps the search index capped while reporting truncation for large scans", async () => {
    const listedPaths = Array.from(
      { length: 25_010 },
      (_, index) => `src/file-${index.toString().padStart(5, "0")}.ts`,
    );

    runProcessMock.mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "true\n" });
      }

      if (args[0] === "ls-files") {
        return processResult({ code: 0, stdout: `${listedPaths.join("\0")}\0` });
      }

      if (args[0] === "check-ignore") {
        return processResult({ code: 1, stdout: "" });
      }

      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    const { searchWorkspaceEntries } = await import("./workspaceEntries");
    const result = await searchWorkspaceEntries({
      cwd: "/virtual/workspace",
      query: "",
      limit: 30_000,
    });

    assert.lengthOf(result.entries, 25_000);
    assert.isTrue(result.truncated);
    assert.equal(result.entries[0]?.path, "src");
    assert.equal(result.entries.at(-1)?.path, "src/file-24998.ts");
  });

  it("rebuilds the derived caches after clearWorkspaceIndexCache is called", async () => {
    let listedPaths = ["src/alpha.ts"];

    runProcessMock.mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "true\n" });
      }

      if (args[0] === "ls-files") {
        return processResult({ code: 0, stdout: `${listedPaths.join("\0")}\0` });
      }

      if (args[0] === "check-ignore") {
        return processResult({ code: 1, stdout: "" });
      }

      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    const { clearWorkspaceIndexCache, listWorkspaceFiles } = await import("./workspaceScanner");
    const first = await listWorkspaceFiles("/virtual/workspace", new Set([".ts"]));
    listedPaths = ["src/bravo.ts"];
    clearWorkspaceIndexCache("/virtual/workspace");
    const second = await listWorkspaceFiles("/virtual/workspace", new Set([".ts"]));

    assert.deepEqual(first, ["src/alpha.ts"]);
    assert.deepEqual(second, ["src/bravo.ts"]);
  });

  it("flags truncated git scans for search while rejecting incomplete full file listings", async () => {
    const visiblePaths = ["src/alpha.ts", "src/bravo.ts"];

    runProcessMock.mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "true\n" });
      }

      if (args[0] === "ls-files") {
        return processResult({
          code: 0,
          stdout: `${visiblePaths.join("\0")}\0partial-tail`,
          stdoutTruncated: true,
        });
      }

      if (args[0] === "check-ignore") {
        return processResult({ code: 1, stdout: "" });
      }

      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    const { listWorkspaceFiles } = await import("./workspaceScanner");
    const { searchWorkspaceEntries } = await import("./workspaceEntries");

    const searchResult = await searchWorkspaceEntries({
      cwd: "/virtual/workspace",
      query: "",
      limit: 100,
    });

    assert.isTrue(searchResult.truncated);
    assert.equal(searchResult.entries[0]?.path, "src");
    assert.equal(searchResult.entries.at(-1)?.path, "src/bravo.ts");
    await expect(listWorkspaceFiles("/virtual/workspace", new Set([".ts"]))).rejects.toThrow(
      "Workspace file scan was truncated",
    );
  });

  it("keeps bounded search scans separate from full non-git workspace scans", async () => {
    const rootPath = "/virtual/workspace";
    const directoryCount = 25_010;
    const rootDirectories = Array.from({ length: directoryCount }, (_, index) =>
      directoryEntry(`group-${index.toString().padStart(5, "0")}`),
    );
    let rootReadCount = 0;
    let childReadCount = 0;

    runProcessMock.mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse") {
        return processResult({ code: 0, stdout: "false\n" });
      }
      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    });

    vi.spyOn(fsPromises, "readdir").mockImplementation((async (target, options) => {
      const readdirOptions = options as { withFileTypes?: boolean } | undefined;
      if (readdirOptions?.withFileTypes !== true) {
        throw new Error(`Unexpected readdir options: ${String(options)}`);
      }

      if (target === rootPath) {
        rootReadCount += 1;
        return rootDirectories;
      }

      if (typeof target === "string" && target.startsWith(`${rootPath}/group-`)) {
        childReadCount += 1;
        return [fileEntry("entry.ts")];
      }

      throw new Error(`Unexpected readdir: ${String(target)}`);
    }) as typeof fsPromises.readdir);

    const { searchWorkspaceEntries } = await import("./workspaceEntries");
    const { listWorkspaceFiles } = await import("./workspaceScanner");

    const searchResult = await searchWorkspaceEntries({
      cwd: rootPath,
      query: "",
      limit: 30_000,
    });

    assert.lengthOf(searchResult.entries, 25_000);
    assert.isTrue(searchResult.truncated);
    assert.equal(rootReadCount, 1);
    assert.equal(childReadCount, 0);

    const files = await listWorkspaceFiles(rootPath, new Set([".ts"]));

    assert.lengthOf(files, directoryCount);
    assert.equal(rootReadCount, 2);
    assert.equal(childReadCount, directoryCount);
    assert.equal(files[0], "group-00000/entry.ts");
    assert.equal(files.at(-1), "group-25009/entry.ts");
  });
});
