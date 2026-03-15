import { TrimmedNonEmptyString } from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import { toPersistenceSqlOrDecodeError } from "../repositoryHelpers.ts";
import {
  AgentSessionEntry,
  AgentSessionRepository,
  DeleteAgentSessionByIdInput,
  GetAgentSessionByIdInput,
  ListAgentSessionsByIssueInput,
  UpdateAgentSessionStatusInput,
  type AgentSessionRepositoryShape,
} from "../Services/AgentSessions.ts";

const AgentSessionDbRowSchema = AgentSessionEntry.mapFields(
  Struct.assign({
    assignedFiles: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
  }),
);

const makeAgentSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertAgentSessionRow = SqlSchema.void({
    Request: AgentSessionEntry,
    execute: (session) => sql`
      INSERT INTO agent_sessions (
        id,
        issue_id,
        agent_type,
        cli_backend,
        pid,
        status,
        assigned_files,
        started_at,
        completed_at,
        exit_code,
        error_output
      )
      VALUES (
        ${session.id},
        ${session.issueId},
        ${session.agentType},
        ${session.cliBackend},
        ${session.pid},
        ${session.status},
        ${JSON.stringify(session.assignedFiles)},
        ${session.startedAt},
        ${session.completedAt},
        ${session.exitCode},
        ${session.errorOutput}
      )
    `,
  });

  const updateAgentSessionRow = SqlSchema.void({
    Request: AgentSessionEntry,
    execute: (session) => sql`
      UPDATE agent_sessions
      SET
        issue_id = ${session.issueId},
        agent_type = ${session.agentType},
        cli_backend = ${session.cliBackend},
        pid = ${session.pid},
        status = ${session.status},
        assigned_files = ${JSON.stringify(session.assignedFiles)},
        started_at = ${session.startedAt},
        completed_at = ${session.completedAt},
        exit_code = ${session.exitCode},
        error_output = ${session.errorOutput}
      WHERE id = ${session.id}
    `,
  });

  const updateAgentSessionStatusRow = SqlSchema.void({
    Request: UpdateAgentSessionStatusInput,
    execute: (input) => sql`
      UPDATE agent_sessions
      SET
        status = ${input.status},
        completed_at = ${input.completedAt},
        exit_code = ${input.exitCode},
        error_output = ${input.errorOutput}
      WHERE id = ${input.id}
    `,
  });

  const getAgentSessionRowById = SqlSchema.findOneOption({
    Request: GetAgentSessionByIdInput,
    Result: AgentSessionDbRowSchema,
    execute: ({ id }) => sql`
      SELECT
        id,
        issue_id AS "issueId",
        agent_type AS "agentType",
        cli_backend AS "cliBackend",
        pid,
        status,
        assigned_files AS "assignedFiles",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        exit_code AS "exitCode",
        error_output AS "errorOutput"
      FROM agent_sessions
      WHERE id = ${id}
    `,
  });

  const listAgentSessionRowsByIssueId = SqlSchema.findAll({
    Request: ListAgentSessionsByIssueInput,
    Result: AgentSessionDbRowSchema,
    execute: ({ issueId }) => sql`
      SELECT
        id,
        issue_id AS "issueId",
        agent_type AS "agentType",
        cli_backend AS "cliBackend",
        pid,
        status,
        assigned_files AS "assignedFiles",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        exit_code AS "exitCode",
        error_output AS "errorOutput"
      FROM agent_sessions
      WHERE issue_id = ${issueId}
      ORDER BY started_at ASC, id ASC
    `,
  });

  const listActiveAgentSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AgentSessionDbRowSchema,
    execute: () => sql`
      SELECT
        id,
        issue_id AS "issueId",
        agent_type AS "agentType",
        cli_backend AS "cliBackend",
        pid,
        status,
        assigned_files AS "assignedFiles",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        exit_code AS "exitCode",
        error_output AS "errorOutput"
      FROM agent_sessions
      WHERE status IN ('starting', 'running')
      ORDER BY started_at ASC, id ASC
    `,
  });

  const deleteAgentSessionRowById = SqlSchema.void({
    Request: DeleteAgentSessionByIdInput,
    execute: ({ id }) => sql`
      DELETE FROM agent_sessions
      WHERE id = ${id}
    `,
  });

  const insert: AgentSessionRepositoryShape["insert"] = (session) =>
    insertAgentSessionRow(session).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.insert:query",
          "AgentSessionRepository.insert:encodeRequest",
        ),
      ),
    );

  const update: AgentSessionRepositoryShape["update"] = (session) =>
    updateAgentSessionRow(session).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.update:query",
          "AgentSessionRepository.update:encodeRequest",
        ),
      ),
    );

  const updateStatus: AgentSessionRepositoryShape["updateStatus"] = (input) =>
    updateAgentSessionStatusRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.updateStatus:query",
          "AgentSessionRepository.updateStatus:encodeRequest",
        ),
      ),
    );

  const getById: AgentSessionRepositoryShape["getById"] = (input) =>
    getAgentSessionRowById(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.getById:query",
          "AgentSessionRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((row) =>
        Option.match(row, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (session) => Effect.succeed(Option.some(session)),
        }),
      ),
    );

  const listByIssueId: AgentSessionRepositoryShape["listByIssueId"] = (input) =>
    listAgentSessionRowsByIssueId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.listByIssueId:query",
          "AgentSessionRepository.listByIssueId:decodeRows",
        ),
      ),
    );

  const listActive: AgentSessionRepositoryShape["listActive"] = () =>
    listActiveAgentSessionRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentSessionRepository.listActive:query",
          "AgentSessionRepository.listActive:decodeRows",
        ),
      ),
    );

  const deleteById: AgentSessionRepositoryShape["deleteById"] = (input) =>
    deleteAgentSessionRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("AgentSessionRepository.deleteById:query")),
    );

  return {
    insert,
    update,
    updateStatus,
    getById,
    listByIssueId,
    listActive,
    deleteById,
  } satisfies AgentSessionRepositoryShape;
});

export const AgentSessionRepositoryLive = Layer.effect(
  AgentSessionRepository,
  makeAgentSessionRepository,
);
