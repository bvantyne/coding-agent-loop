import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import { toPersistenceSqlOrDecodeError } from "../repositoryHelpers.ts";
import { JsonSerializableSchema } from "../Services/AgentStateSchemas.ts";
import {
  DeletePlanArtifactByIdInput,
  GetPlanArtifactByIdInput,
  ListPlanArtifactsByIssueInput,
  PlanArtifactEntry,
  PlanArtifactRepository,
  type PlanArtifactRepositoryShape,
} from "../Services/PlanArtifacts.ts";

const PlanArtifactDbRowSchema = PlanArtifactEntry.mapFields(
  Struct.assign({
    feedbackRounds: Schema.NullOr(Schema.fromJsonString(Schema.Array(JsonSerializableSchema))),
  }),
);

const makePlanArtifactRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertPlanArtifactRow = SqlSchema.void({
    Request: PlanArtifactEntry,
    execute: (artifact) => sql`
      INSERT INTO plan_artifacts (
        id,
        issue_id,
        version,
        plan_content,
        feedback_rounds,
        status,
        created_at,
        approved_at
      )
      VALUES (
        ${artifact.id},
        ${artifact.issueId},
        ${artifact.version},
        ${artifact.planContent},
        ${artifact.feedbackRounds === null ? null : JSON.stringify(artifact.feedbackRounds)},
        ${artifact.status},
        ${artifact.createdAt},
        ${artifact.approvedAt}
      )
    `,
  });

  const updatePlanArtifactRow = SqlSchema.void({
    Request: PlanArtifactEntry,
    execute: (artifact) => sql`
      UPDATE plan_artifacts
      SET
        issue_id = ${artifact.issueId},
        version = ${artifact.version},
        plan_content = ${artifact.planContent},
        feedback_rounds = ${artifact.feedbackRounds === null ? null : JSON.stringify(artifact.feedbackRounds)},
        status = ${artifact.status},
        created_at = ${artifact.createdAt},
        approved_at = ${artifact.approvedAt}
      WHERE id = ${artifact.id}
    `,
  });

  const getPlanArtifactRowById = SqlSchema.findOneOption({
    Request: GetPlanArtifactByIdInput,
    Result: PlanArtifactDbRowSchema,
    execute: ({ id }) => sql`
      SELECT
        id,
        issue_id AS "issueId",
        version,
        plan_content AS "planContent",
        feedback_rounds AS "feedbackRounds",
        status,
        created_at AS "createdAt",
        approved_at AS "approvedAt"
      FROM plan_artifacts
      WHERE id = ${id}
    `,
  });

  const getLatestPlanArtifactRowByIssueId = SqlSchema.findOneOption({
    Request: ListPlanArtifactsByIssueInput,
    Result: PlanArtifactDbRowSchema,
    execute: ({ issueId }) => sql`
      SELECT
        id,
        issue_id AS "issueId",
        version,
        plan_content AS "planContent",
        feedback_rounds AS "feedbackRounds",
        status,
        created_at AS "createdAt",
        approved_at AS "approvedAt"
      FROM plan_artifacts
      WHERE issue_id = ${issueId}
      ORDER BY version DESC, created_at DESC, id DESC
      LIMIT 1
    `,
  });

  const listPlanArtifactRowsByIssueId = SqlSchema.findAll({
    Request: ListPlanArtifactsByIssueInput,
    Result: PlanArtifactDbRowSchema,
    execute: ({ issueId }) => sql`
      SELECT
        id,
        issue_id AS "issueId",
        version,
        plan_content AS "planContent",
        feedback_rounds AS "feedbackRounds",
        status,
        created_at AS "createdAt",
        approved_at AS "approvedAt"
      FROM plan_artifacts
      WHERE issue_id = ${issueId}
      ORDER BY version ASC, created_at ASC, id ASC
    `,
  });

  const deletePlanArtifactRowById = SqlSchema.void({
    Request: DeletePlanArtifactByIdInput,
    execute: ({ id }) => sql`
      DELETE FROM plan_artifacts
      WHERE id = ${id}
    `,
  });

  const insert: PlanArtifactRepositoryShape["insert"] = (artifact) =>
    insertPlanArtifactRow(artifact).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanArtifactRepository.insert:query",
          "PlanArtifactRepository.insert:encodeRequest",
        ),
      ),
    );

  const update: PlanArtifactRepositoryShape["update"] = (artifact) =>
    updatePlanArtifactRow(artifact).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanArtifactRepository.update:query",
          "PlanArtifactRepository.update:encodeRequest",
        ),
      ),
    );

  const getById: PlanArtifactRepositoryShape["getById"] = (input) =>
    getPlanArtifactRowById(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanArtifactRepository.getById:query",
          "PlanArtifactRepository.getById:decodeRow",
        ),
      ),
    );

  const getLatestByIssueId: PlanArtifactRepositoryShape["getLatestByIssueId"] = (input) =>
    getLatestPlanArtifactRowByIssueId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanArtifactRepository.getLatestByIssueId:query",
          "PlanArtifactRepository.getLatestByIssueId:decodeRow",
        ),
      ),
    );

  const listVersionsByIssueId: PlanArtifactRepositoryShape["listVersionsByIssueId"] = (input) =>
    listPlanArtifactRowsByIssueId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanArtifactRepository.listVersionsByIssueId:query",
          "PlanArtifactRepository.listVersionsByIssueId:decodeRows",
        ),
      ),
    );

  const deleteById: PlanArtifactRepositoryShape["deleteById"] = (input) =>
    deletePlanArtifactRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("PlanArtifactRepository.deleteById:query")),
    );

  return {
    insert,
    update,
    getById,
    getLatestByIssueId,
    listVersionsByIssueId,
    deleteById,
  } satisfies PlanArtifactRepositoryShape;
});

export const PlanArtifactRepositoryLive = Layer.effect(
  PlanArtifactRepository,
  makePlanArtifactRepository,
);
