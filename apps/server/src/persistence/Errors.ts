import { Schema, SchemaIssue } from "effect";

// ===============================
// Core Persistence Errors
// ===============================

export class PersistenceSqlError extends Schema.TaggedErrorClass<PersistenceSqlError>()(
  "PersistenceSqlError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SQL error in ${this.operation}: ${this.detail}`;
  }
}

export class PersistenceDecodeError extends Schema.TaggedErrorClass<PersistenceDecodeError>()(
  "PersistenceDecodeError",
  {
    operation: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Decode error in ${this.operation}: ${this.issue}`;
  }
}

export function toPersistenceSqlError(operation: string) {
  return (cause: unknown): PersistenceSqlError =>
    new PersistenceSqlError({
      operation,
      detail: `Failed to execute ${operation}`,
      cause,
    });
}

export function toPersistenceDecodeError(operation: string) {
  return (error: Schema.SchemaError): PersistenceDecodeError =>
    new PersistenceDecodeError({
      operation,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}

export function toPersistenceDecodeCauseError(operation: string) {
  return (cause: unknown): PersistenceDecodeError =>
    new PersistenceDecodeError({
      operation,
      issue: `Failed to execute ${operation}`,
      cause,
    });
}

export const isPersistenceError = (u: unknown) =>
  Schema.is(PersistenceSqlError)(u) || Schema.is(PersistenceDecodeError)(u);

// ===============================
// Provider Session Repository Errors
// ===============================

export class ProviderSessionRepositoryValidationError extends Schema.TaggedErrorClass<ProviderSessionRepositoryValidationError>()(
  "ProviderSessionRepositoryValidationError",
  {
    operation: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Provider session repository validation failed in ${this.operation}: ${this.issue}`;
  }
}

export class ProviderSessionRepositoryPersistenceError extends Schema.TaggedErrorClass<ProviderSessionRepositoryPersistenceError>()(
  "ProviderSessionRepositoryPersistenceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Provider session repository persistence error in ${this.operation}: ${this.detail}`;
  }
}

export class FileLockConflictError extends Schema.TaggedErrorClass<FileLockConflictError>()(
  "FileLockConflictError",
  {
    filePath: Schema.String,
    lockType: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `File lock conflict for ${this.filePath}: ${this.detail}`;
  }
}

export class FileLockExpiredError extends Schema.TaggedErrorClass<FileLockExpiredError>()(
  "FileLockExpiredError",
  {
    filePath: Schema.String,
    expiresAt: Schema.String,
    asOf: Schema.String,
  },
) {
  override get message(): string {
    return `File lock for ${this.filePath} expires at ${this.expiresAt}, which is not after ${this.asOf}`;
  }
}

export type OrchestrationEventStoreError = PersistenceSqlError | PersistenceDecodeError;

export type ProviderSessionRepositoryError =
  | ProviderSessionRepositoryValidationError
  | ProviderSessionRepositoryPersistenceError;

export type OrchestrationCommandReceiptRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError;

export type ProviderSessionRuntimeRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type ProjectionRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type IssueQueueRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type AgentSessionRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type FileLockRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError
  | FileLockConflictError
  | FileLockExpiredError;

export type PlanArtifactRepositoryError = PersistenceSqlError | PersistenceDecodeError;
