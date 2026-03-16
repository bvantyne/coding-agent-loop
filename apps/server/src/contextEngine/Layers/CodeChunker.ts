import fs from "node:fs/promises";
import path from "node:path";

import { Effect, Layer } from "effect";

import { listWorkspaceFiles } from "../../workspaceScanner.ts";
import { CodeChunkerError } from "../Errors.ts";
import {
  CodeChunker,
  type CodeChunkerShape,
  type ChunkFileInput,
  type ChunkWorkspaceInput,
} from "../Services/CodeChunker.ts";
import { chunkTypeScriptFile } from "../astChunker.ts";
import type { CodeChunk } from "../types.ts";

const CHUNKABLE_EXTENSIONS = new Set([".ts", ".tsx"]);
const WORKSPACE_CHUNK_CONCURRENCY = 8;

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from({ length: items.length }) as TOutput[];
  let nextIndex = 0;

  const workers = Array.from({ length: boundedConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex] as TInput, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function readChunksForFilePromise({
  cwd,
  filePath,
}: ChunkFileInput): Promise<ReadonlyArray<CodeChunk>> {
  const normalizedPath = toPosixPath(filePath);
  const absolutePath = path.join(cwd, normalizedPath);
  const content = await fs.readFile(absolutePath, "utf8");
  return chunkTypeScriptFile({ filePath: normalizedPath, content });
}

const readChunksForFile = ({ cwd, filePath }: ChunkFileInput) =>
  Effect.tryPromise({
    try: () => readChunksForFilePromise({ cwd, filePath }),
    catch: (cause) =>
      new CodeChunkerError({
        operation: "chunkFile",
        detail: `Unable to read or chunk ${filePath}`,
        cause,
      }),
  });

const makeCodeChunker = Effect.sync(() => {
  const chunkFile: CodeChunkerShape["chunkFile"] = (input) => readChunksForFile(input);

  const chunkWorkspace: CodeChunkerShape["chunkWorkspace"] = (input: ChunkWorkspaceInput) =>
    Effect.tryPromise({
      try: async () => {
        const filePaths = await listWorkspaceFiles(input.cwd, CHUNKABLE_EXTENSIONS);
        const chunkLists = await mapWithConcurrency(
          filePaths,
          WORKSPACE_CHUNK_CONCURRENCY,
          (filePath) => readChunksForFilePromise({ cwd: input.cwd, filePath }),
        );
        return chunkLists.flat();
      },
      catch: (cause) =>
        new CodeChunkerError({
          operation: "chunkWorkspace",
          detail:
            cause instanceof Error
              ? `Unable to chunk workspace at ${input.cwd}: ${cause.message}`
              : `Unable to chunk workspace at ${input.cwd}`,
          cause,
        }),
    });

  return {
    chunkFile,
    chunkWorkspace,
  } satisfies CodeChunkerShape;
});

export const CodeChunkerLive = Layer.effect(CodeChunker, makeCodeChunker);
