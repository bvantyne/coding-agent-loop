import { IsoDateTime } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { IssueQueueRepositoryError } from "../Errors.ts";
import {
  IssueQueueEntry,
  IssueQueueId,
  IssueQueueStatus,
  type IssueQueueEntry as IssueQueueEntryType,
} from "./AgentStateSchemas.ts";

export const GetIssueQueueByIdInput = Schema.Struct({
  id: IssueQueueId,
});
export type GetIssueQueueByIdInput = typeof GetIssueQueueByIdInput.Type;

export const ListIssueQueueByStatusInput = Schema.Struct({
  status: IssueQueueStatus,
});
export type ListIssueQueueByStatusInput = typeof ListIssueQueueByStatusInput.Type;

export const UpdateIssueQueueStatusInput = Schema.Struct({
  id: IssueQueueId,
  status: IssueQueueStatus,
  updatedAt: IsoDateTime,
  failureReason: Schema.NullOr(Schema.String),
});
export type UpdateIssueQueueStatusInput = typeof UpdateIssueQueueStatusInput.Type;

export const DeleteIssueQueueByIdInput = GetIssueQueueByIdInput;
export type DeleteIssueQueueByIdInput = typeof DeleteIssueQueueByIdInput.Type;

export interface IssueQueueRepositoryShape {
  readonly insert: (issue: IssueQueueEntryType) => Effect.Effect<void, IssueQueueRepositoryError>;
  readonly update: (issue: IssueQueueEntryType) => Effect.Effect<void, IssueQueueRepositoryError>;
  readonly updateStatus: (
    input: UpdateIssueQueueStatusInput,
  ) => Effect.Effect<void, IssueQueueRepositoryError>;
  readonly getById: (
    input: GetIssueQueueByIdInput,
  ) => Effect.Effect<Option.Option<IssueQueueEntryType>, IssueQueueRepositoryError>;
  readonly listByStatus: (
    input: ListIssueQueueByStatusInput,
  ) => Effect.Effect<ReadonlyArray<IssueQueueEntryType>, IssueQueueRepositoryError>;
  readonly deleteById: (
    input: DeleteIssueQueueByIdInput,
  ) => Effect.Effect<void, IssueQueueRepositoryError>;
}

export class IssueQueueRepository extends ServiceMap.Service<
  IssueQueueRepository,
  IssueQueueRepositoryShape
>()("t3/persistence/Services/IssueQueue/IssueQueueRepository") {}

export { IssueQueueEntry, IssueQueueId, IssueQueueStatus };
