import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PlanArtifactRepositoryError } from "../Errors.ts";
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
  ) => Effect.Effect<void, PlanArtifactRepositoryError>;
  readonly update: (
    artifact: PlanArtifactEntryType,
  ) => Effect.Effect<void, PlanArtifactRepositoryError>;
  readonly getById: (
    input: GetPlanArtifactByIdInput,
  ) => Effect.Effect<Option.Option<PlanArtifactEntryType>, PlanArtifactRepositoryError>;
  readonly getLatestByIssueId: (
    input: ListPlanArtifactsByIssueInput,
  ) => Effect.Effect<Option.Option<PlanArtifactEntryType>, PlanArtifactRepositoryError>;
  readonly listVersionsByIssueId: (
    input: ListPlanArtifactsByIssueInput,
  ) => Effect.Effect<ReadonlyArray<PlanArtifactEntryType>, PlanArtifactRepositoryError>;
  readonly deleteById: (
    input: DeletePlanArtifactByIdInput,
  ) => Effect.Effect<void, PlanArtifactRepositoryError>;
}

export class PlanArtifactRepository extends ServiceMap.Service<
  PlanArtifactRepository,
  PlanArtifactRepositoryShape
>()("t3/persistence/Services/PlanArtifacts/PlanArtifactRepository") {}

export { PlanArtifactEntry, PlanArtifactId, PlanArtifactStatus };
