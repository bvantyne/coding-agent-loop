import { IsoDateTime } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  AgentCliBackend,
  AgentSessionEntry,
  AgentSessionId,
  AgentSessionStatus,
  AgentSessionType,
  IssueQueueId,
  type AgentSessionEntry as AgentSessionEntryType,
} from "./AgentStateSchemas.ts";

export const GetAgentSessionByIdInput = Schema.Struct({
  id: AgentSessionId,
});
export type GetAgentSessionByIdInput = typeof GetAgentSessionByIdInput.Type;

export const ListAgentSessionsByIssueInput = Schema.Struct({
  issueId: IssueQueueId,
});
export type ListAgentSessionsByIssueInput = typeof ListAgentSessionsByIssueInput.Type;

export const UpdateAgentSessionStatusInput = Schema.Struct({
  id: AgentSessionId,
  status: AgentSessionStatus,
  completedAt: Schema.NullOr(IsoDateTime),
  exitCode: Schema.NullOr(Schema.Int),
  errorOutput: Schema.NullOr(Schema.String),
});
export type UpdateAgentSessionStatusInput = typeof UpdateAgentSessionStatusInput.Type;

export const DeleteAgentSessionByIdInput = GetAgentSessionByIdInput;
export type DeleteAgentSessionByIdInput = typeof DeleteAgentSessionByIdInput.Type;

export interface AgentSessionRepositoryShape {
  readonly insert: (
    session: AgentSessionEntryType,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly update: (
    session: AgentSessionEntryType,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateStatus: (
    input: UpdateAgentSessionStatusInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetAgentSessionByIdInput,
  ) => Effect.Effect<Option.Option<AgentSessionEntryType>, ProjectionRepositoryError>;
  readonly listByIssueId: (
    input: ListAgentSessionsByIssueInput,
  ) => Effect.Effect<ReadonlyArray<AgentSessionEntryType>, ProjectionRepositoryError>;
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<AgentSessionEntryType>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeleteAgentSessionByIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class AgentSessionRepository extends ServiceMap.Service<
  AgentSessionRepository,
  AgentSessionRepositoryShape
>()("t3/persistence/Services/AgentSessions/AgentSessionRepository") {}

export { AgentCliBackend, AgentSessionEntry, AgentSessionId, AgentSessionStatus, AgentSessionType };
