import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  IssueQueueId,
  PlanArtifactEntry,
  PlanArtifactId,
  PlanArtifactStatus,
  type PlanArtifactEntry as PlanArtifactEntryType,
} from "./AgentStateSchemas.ts";

export const GetPlanArtifactByIdInput = Schema.Struct({
  id: PlanArtifactId,
});
export type GetPlanArtifactByIdInput = typeof GetPlanArtifactByIdInput.Type;

export const ListPlanArtifactsByIssueInput = Schema.Struct({
  issueId: IssueQueueId,
});
export type ListPlanArtifactsByIssueInput = typeof ListPlanArtifactsByIssueInput.Type;

export const DeletePlanArtifactByIdInput = GetPlanArtifactByIdInput;
export type DeletePlanArtifactByIdInput = typeof DeletePlanArtifactByIdInput.Type;

export interface PlanArtifactRepositoryShape {
  readonly insert: (
    artifact: PlanArtifactEntryType,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly update: (
    artifact: PlanArtifactEntryType,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetPlanArtifactByIdInput,
  ) => Effect.Effect<Option.Option<PlanArtifactEntryType>, ProjectionRepositoryError>;
  readonly getLatestByIssueId: (
    input: ListPlanArtifactsByIssueInput,
  ) => Effect.Effect<Option.Option<PlanArtifactEntryType>, ProjectionRepositoryError>;
  readonly listVersionsByIssueId: (
    input: ListPlanArtifactsByIssueInput,
  ) => Effect.Effect<ReadonlyArray<PlanArtifactEntryType>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeletePlanArtifactByIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class PlanArtifactRepository extends ServiceMap.Service<
  PlanArtifactRepository,
  PlanArtifactRepositoryShape
>()("t3/persistence/Services/PlanArtifacts/PlanArtifactRepository") {}

export { PlanArtifactEntry, PlanArtifactId, PlanArtifactStatus };
