import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import { toPersistenceSqlOrDecodeError } from "../repositoryHelpers.ts";
import {
  DeleteIssueQueueByIdInput,
  GetIssueQueueByIdInput,
  IssueQueueEntry,
  IssueQueueRepository,
  ListIssueQueueByStatusInput,
  type IssueQueueRepositoryShape,
  UpdateIssueQueueStatusInput,
} from "../Services/IssueQueue.ts";

const makeIssueQueueRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertIssueQueueRow = SqlSchema.void({
    Request: IssueQueueEntry,
    execute: (issue) => sql`
      INSERT INTO issue_queue (
        id,
        linear_identifier,
        title,
        description,
        status,
        priority,
        sprint_branch,
        worktree_path,
        retry_count,
        max_retries,
        failure_reason,
        created_at,
        updated_at
      )
      VALUES (
        ${issue.id},
        ${issue.linearIdentifier},
        ${issue.title},
        ${issue.description},
        ${issue.status},
        ${issue.priority},
        ${issue.sprintBranch},
        ${issue.worktreePath},
        ${issue.retryCount},
        ${issue.maxRetries},
        ${issue.failureReason},
        ${issue.createdAt},
        ${issue.updatedAt}
      )
    `,
  });

  const updateIssueQueueRow = SqlSchema.void({
    Request: IssueQueueEntry,
    execute: (issue) => sql`
      UPDATE issue_queue
      SET
        linear_identifier = ${issue.linearIdentifier},
        title = ${issue.title},
        description = ${issue.description},
        status = ${issue.status},
        priority = ${issue.priority},
        sprint_branch = ${issue.sprintBranch},
        worktree_path = ${issue.worktreePath},
        retry_count = ${issue.retryCount},
        max_retries = ${issue.maxRetries},
        failure_reason = ${issue.failureReason},
        created_at = ${issue.createdAt},
        updated_at = ${issue.updatedAt}
      WHERE id = ${issue.id}
    `,
  });

  const updateIssueQueueStatusRow = SqlSchema.void({
    Request: UpdateIssueQueueStatusInput,
    execute: (input) => sql`
      UPDATE issue_queue
      SET
        status = ${input.status},
        updated_at = ${input.updatedAt},
        failure_reason = ${input.failureReason}
      WHERE id = ${input.id}
    `,
  });

  const getIssueQueueRowById = SqlSchema.findOneOption({
    Request: GetIssueQueueByIdInput,
    Result: IssueQueueEntry,
    execute: ({ id }) => sql`
      SELECT
        id,
        linear_identifier AS "linearIdentifier",
        title,
        description,
        status,
        priority,
        sprint_branch AS "sprintBranch",
        worktree_path AS "worktreePath",
        retry_count AS "retryCount",
        max_retries AS "maxRetries",
        failure_reason AS "failureReason",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM issue_queue
      WHERE id = ${id}
    `,
  });

  const listIssueQueueRowsByStatus = SqlSchema.findAll({
    Request: ListIssueQueueByStatusInput,
    Result: IssueQueueEntry,
    execute: ({ status }) => sql`
      SELECT
        id,
        linear_identifier AS "linearIdentifier",
        title,
        description,
        status,
        priority,
        sprint_branch AS "sprintBranch",
        worktree_path AS "worktreePath",
        retry_count AS "retryCount",
        max_retries AS "maxRetries",
        failure_reason AS "failureReason",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM issue_queue
      WHERE status = ${status}
      ORDER BY priority ASC, created_at ASC, id ASC
    `,
  });

  const deleteIssueQueueRowById = SqlSchema.void({
    Request: DeleteIssueQueueByIdInput,
    execute: ({ id }) => sql`
      DELETE FROM issue_queue
      WHERE id = ${id}
    `,
  });

  const insert: IssueQueueRepositoryShape["insert"] = (issue) =>
    insertIssueQueueRow(issue).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "IssueQueueRepository.insert:query",
          "IssueQueueRepository.insert:encodeRequest",
        ),
      ),
    );

  const update: IssueQueueRepositoryShape["update"] = (issue) =>
    updateIssueQueueRow(issue).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "IssueQueueRepository.update:query",
          "IssueQueueRepository.update:encodeRequest",
        ),
      ),
    );

  const updateStatus: IssueQueueRepositoryShape["updateStatus"] = (input) =>
    updateIssueQueueStatusRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "IssueQueueRepository.updateStatus:query",
          "IssueQueueRepository.updateStatus:encodeRequest",
        ),
      ),
    );

  const getById: IssueQueueRepositoryShape["getById"] = (input) =>
    getIssueQueueRowById(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "IssueQueueRepository.getById:query",
          "IssueQueueRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((row) =>
        Option.match(row, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (issue) => Effect.succeed(Option.some(issue)),
        }),
      ),
    );

  const listByStatus: IssueQueueRepositoryShape["listByStatus"] = (input) =>
    listIssueQueueRowsByStatus(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "IssueQueueRepository.listByStatus:query",
          "IssueQueueRepository.listByStatus:decodeRows",
        ),
      ),
    );

  const deleteById: IssueQueueRepositoryShape["deleteById"] = (input) =>
    deleteIssueQueueRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("IssueQueueRepository.deleteById:query")),
    );

  return {
    insert,
    update,
    updateStatus,
    getById,
    listByStatus,
    deleteById,
  } satisfies IssueQueueRepositoryShape;
});

export const IssueQueueRepositoryLive = Layer.effect(
  IssueQueueRepository,
  makeIssueQueueRepository,
);
