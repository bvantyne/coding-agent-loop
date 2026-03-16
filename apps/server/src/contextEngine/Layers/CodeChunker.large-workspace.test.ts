import { assert, beforeEach, describe, expect, it, vi } from "vitest";

const FILE_COUNT = 25_002;
const LARGE_WORKSPACE_FILES = Array.from(
  { length: FILE_COUNT },
  (_, index) => `src/file-${index}.ts`,
);

const { chunkTypeScriptFileMock, listWorkspaceFilesMock, readFileMock } = vi.hoisted(() => ({
  listWorkspaceFilesMock: vi.fn(),
  readFileMock: vi.fn(),
  chunkTypeScriptFileMock: vi.fn(),
}));

vi.mock("../../workspaceScanner.ts", () => ({
  listWorkspaceFiles: listWorkspaceFilesMock,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock,
  },
}));

vi.mock("../astChunker.ts", () => ({
  chunkTypeScriptFile: chunkTypeScriptFileMock,
}));

describe("CodeChunkerLive large workspace scans", () => {
  beforeEach(() => {
    vi.resetModules();
    listWorkspaceFilesMock.mockReset();
    readFileMock.mockReset();
    chunkTypeScriptFileMock.mockReset();

    listWorkspaceFilesMock.mockResolvedValue(LARGE_WORKSPACE_FILES);
    readFileMock.mockImplementation(async (_absolutePath: string) => "export const value = 1;");
    chunkTypeScriptFileMock.mockImplementation(
      ({ filePath, content }: { filePath: string; content: string }) => [
        {
          id: filePath,
          filePath,
          startLine: 1,
          endLine: 1,
          content,
          chunkType: "const",
          exports: [],
          imports: [],
          tokenCount: 5,
        },
      ],
    );
  });

  it("chunks files beyond the search index cap when the scanner returns them", async () => {
    const { Effect } = await import("effect");
    const { CodeChunkerLive } = await import("./CodeChunker.ts");
    const { CodeChunker } = await import("../Services/CodeChunker.ts");

    const chunks = await Effect.gen(function* () {
      const chunker = yield* CodeChunker;
      return yield* chunker.chunkWorkspace({ cwd: "/virtual/workspace" });
    }).pipe(Effect.provide(CodeChunkerLive), Effect.runPromise);

    assert.lengthOf(chunks, FILE_COUNT);
    assert.equal(chunks[0]?.filePath, LARGE_WORKSPACE_FILES[0]);
    assert.equal(chunks.at(-1)?.filePath, LARGE_WORKSPACE_FILES.at(-1));
    assert.equal(chunkTypeScriptFileMock.mock.calls.length, FILE_COUNT);
  });

  it("surfaces truncated workspace scans as chunkWorkspace failures", async () => {
    listWorkspaceFilesMock.mockRejectedValueOnce(
      new Error("Workspace file scan was truncated for '/virtual/workspace'"),
    );

    const { Effect } = await import("effect");
    const { CodeChunkerLive } = await import("./CodeChunker.ts");
    const { CodeChunker } = await import("../Services/CodeChunker.ts");

    const result = Effect.gen(function* () {
      const chunker = yield* CodeChunker;
      return yield* chunker.chunkWorkspace({ cwd: "/virtual/workspace" });
    }).pipe(Effect.provide(CodeChunkerLive), Effect.runPromise);

    await expect(result).rejects.toThrow("Workspace file scan was truncated");
  });
});
