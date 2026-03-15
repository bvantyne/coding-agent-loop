import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { FileLockRepositoryError } from "../Errors.ts";
import {
  AgentSessionId,
  FileLockEntry,
  FileLockType,
  IssueQueueId,
  type FileLockEntry as FileLockEntryType,
} from "./AgentStateSchemas.ts";

export const CheckFileLockAvailabilityInput = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  lockType: FileLockType,
  lockedByAgent: Schema.optional(AgentSessionId),
  asOf: Schema.optional(IsoDateTime),
});
export type CheckFileLockAvailabilityInput = typeof CheckFileLockAvailabilityInput.Type;

export const ReleaseFileLockInput = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  lockedByAgent: AgentSessionId,
});
export type ReleaseFileLockInput = typeof ReleaseFileLockInput.Type;

export const ListFileLocksByIssueInput = Schema.Struct({
  issueId: IssueQueueId,
});
export type ListFileLocksByIssueInput = typeof ListFileLocksByIssueInput.Type;

export interface FileLockRepositoryShape {
  readonly acquire: (lock: FileLockEntryType) => Effect.Effect<void, FileLockRepositoryError>;
  readonly release: (input: ReleaseFileLockInput) => Effect.Effect<void, FileLockRepositoryError>;
  readonly listByIssueId: (
    input: ListFileLocksByIssueInput,
  ) => Effect.Effect<ReadonlyArray<FileLockEntryType>, FileLockRepositoryError>;
  readonly checkAvailability: (
    input: CheckFileLockAvailabilityInput,
  ) => Effect.Effect<boolean, FileLockRepositoryError>;
}

export class FileLockRepository extends ServiceMap.Service<
  FileLockRepository,
  FileLockRepositoryShape
>()("t3/persistence/Services/FileLocks/FileLockRepository") {}

export { FileLockEntry, FileLockType };
