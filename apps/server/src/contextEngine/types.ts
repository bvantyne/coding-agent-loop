export type CodeChunkType = "function" | "class" | "type" | "service" | "layer" | "const" | "other";

export interface CodeChunk {
  readonly id: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly chunkType: CodeChunkType;
  readonly exports: ReadonlyArray<string>;
  readonly imports: ReadonlyArray<string>;
  readonly tokenCount: number;
}
