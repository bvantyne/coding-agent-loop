import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { CodeChunk } from "../types.ts";
import type { CodeChunkerServiceError } from "../Errors.ts";

export interface ChunkWorkspaceInput {
  readonly cwd: string;
}

export interface ChunkFileInput {
  readonly cwd: string;
  readonly filePath: string;
}

export interface CodeChunkerShape {
  readonly chunkWorkspace: (
    input: ChunkWorkspaceInput,
  ) => Effect.Effect<ReadonlyArray<CodeChunk>, CodeChunkerServiceError>;
  readonly chunkFile: (
    input: ChunkFileInput,
  ) => Effect.Effect<ReadonlyArray<CodeChunk>, CodeChunkerServiceError>;
}

export class CodeChunker extends ServiceMap.Service<CodeChunker, CodeChunkerShape>()(
  "t3/contextEngine/Services/CodeChunker",
) {}
