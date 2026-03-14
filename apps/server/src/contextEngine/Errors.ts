import { Schema } from "effect";

export class CodeChunkerError extends Schema.TaggedErrorClass<CodeChunkerError>()(
  "CodeChunkerError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Code chunker failed in ${this.operation}: ${this.detail}`;
  }
}

export type CodeChunkerServiceError = CodeChunkerError;
