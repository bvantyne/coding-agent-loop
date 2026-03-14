import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { FileLockConflictError, FileLockExpiredError, toPersistenceSqlError } from "../Errors.ts";
import { toPersistenceSqlOrDecodeError } from "../repositoryHelpers.ts";
import {
  FileLockEntry,
  FileLockRepository,
  ReleaseFileLockInput,
  type FileLockRepositoryShape,
} from "../Services/FileLocks.ts";
import {
  IssueQueueId,
  type FileLockEntry as FileLockEntryType,
} from "../Services/AgentStateSchemas.ts";

const ExpiringFileLockScope = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  asOf: IsoDateTime,
});

const ActiveFileLocksByFileInput = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  asOf: IsoDateTime,
});

const ActiveFileLocksByIssueAtInput = Schema.Struct({
  issueId: IssueQueueId,
  asOf: IsoDateTime,
});

const DatabaseAsOfRow = Schema.Struct({
  asOf: IsoDateTime,
});

const findConflicts = (locks: ReadonlyArray<FileLockEntryType>, desired: FileLockEntryType) =>
  locks.filter(
    (existing) =>
      existing.lockedByAgent !== desired.lockedByAgent &&
      (desired.lockType === "exclusive" || existing.lockType === "exclusive"),
  );

const makeFileLockRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const purgeExpiredFileLocksForPath = SqlSchema.void({
    Request: ExpiringFileLockScope,
    execute: ({ filePath, asOf }) => sql`
      DELETE FROM file_locks
      WHERE file_path = ${filePath}
        AND expires_at <= ${asOf}
    `,
  });

  const upsertFileLockRow = SqlSchema.void({
    Request: FileLockEntry,
    execute: (lock) => sql`
      INSERT INTO file_locks (
        file_path,
        locked_by_agent,
        locked_by_issue,
        locked_at,
        expires_at,
        lock_type
      )
      VALUES (
        ${lock.filePath},
        ${lock.lockedByAgent},
        ${lock.lockedByIssue},
        ${lock.lockedAt},
        ${lock.expiresAt},
        ${lock.lockType}
      )
      ON CONFLICT (file_path, locked_by_agent)
      DO UPDATE SET
        locked_by_issue = excluded.locked_by_issue,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at,
        lock_type = excluded.lock_type
    `,
  });

  const listActiveFileLocksByFilePath = SqlSchema.findAll({
    Request: ActiveFileLocksByFileInput,
    Result: FileLockEntry,
    execute: ({ filePath, asOf }) => sql`
      SELECT
        file_path AS "filePath",
        locked_by_agent AS "lockedByAgent",
        locked_by_issue AS "lockedByIssue",
        locked_at AS "lockedAt",
        expires_at AS "expiresAt",
        lock_type AS "lockType"
      FROM file_locks
      WHERE file_path = ${filePath}
        AND expires_at > ${asOf}
      ORDER BY locked_at ASC, locked_by_agent ASC
    `,
  });

  const listActiveFileLocksByIssueId = SqlSchema.findAll({
    Request: ActiveFileLocksByIssueAtInput,
    Result: FileLockEntry,
    execute: ({ issueId, asOf }) => sql`
      SELECT
        file_path AS "filePath",
        locked_by_agent AS "lockedByAgent",
        locked_by_issue AS "lockedByIssue",
        locked_at AS "lockedAt",
        expires_at AS "expiresAt",
        lock_type AS "lockType"
      FROM file_locks
      WHERE locked_by_issue = ${issueId}
        AND expires_at > ${asOf}
      ORDER BY locked_at ASC, file_path ASC, locked_by_agent ASC
    `,
  });

  const deleteFileLockRow = SqlSchema.void({
    Request: ReleaseFileLockInput,
    execute: ({ filePath, lockedByAgent }) => sql`
      DELETE FROM file_locks
      WHERE file_path = ${filePath}
        AND locked_by_agent = ${lockedByAgent}
    `,
  });

  const getDatabaseAsOfRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: DatabaseAsOfRow,
    execute: () => sql`
      SELECT STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') AS "asOf"
    `,
  });

  const acquire: FileLockRepositoryShape["acquire"] = (lock) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const { asOf } = yield* getDatabaseAsOfRow(undefined);
          if (Date.parse(lock.expiresAt) <= Date.parse(asOf)) {
            return yield* new FileLockExpiredError({
              filePath: lock.filePath,
              expiresAt: lock.expiresAt,
              asOf,
            });
          }

          yield* purgeExpiredFileLocksForPath({
            filePath: lock.filePath,
            asOf,
          });

          const locks = yield* listActiveFileLocksByFilePath({
            filePath: lock.filePath,
            asOf,
          });

          const conflicts = findConflicts(locks, lock);
          if (conflicts.length > 0) {
            const conflict = conflicts[0]!;
            return yield* new FileLockConflictError({
              filePath: lock.filePath,
              lockType: lock.lockType,
              detail: `Held by agent '${conflict.lockedByAgent}' as ${conflict.lockType}.`,
            });
          }

          yield* upsertFileLockRow(lock);
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          Schema.is(FileLockConflictError)(cause) || Schema.is(FileLockExpiredError)(cause)
            ? cause
            : toPersistenceSqlOrDecodeError(
                "FileLockRepository.acquire:query",
                "FileLockRepository.acquire:encodeRequest",
              )(cause),
        ),
      );

  const release: FileLockRepositoryShape["release"] = (input) =>
    deleteFileLockRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("FileLockRepository.release:query")),
    );

  const listByIssueId: FileLockRepositoryShape["listByIssueId"] = (input) =>
    Effect.gen(function* () {
      const { asOf } = yield* getDatabaseAsOfRow(undefined);
      return yield* listActiveFileLocksByIssueId({
        issueId: input.issueId,
        asOf,
      });
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "FileLockRepository.listByIssueId:query",
          "FileLockRepository.listByIssueId:decodeRows",
        ),
      ),
    );

  const checkAvailability: FileLockRepositoryShape["checkAvailability"] = (input) => {
    return sql
      .withTransaction(
        Effect.gen(function* () {
          const asOf = input.asOf ?? (yield* getDatabaseAsOfRow(undefined)).asOf;
          yield* purgeExpiredFileLocksForPath({
            filePath: input.filePath,
            asOf,
          });

          const locks = yield* listActiveFileLocksByFilePath({
            filePath: input.filePath,
            asOf,
          });

          return yield* Effect.succeed(
            locks.every(
              (existing) =>
                existing.lockedByAgent === input.lockedByAgent ||
                (input.lockType === "shared" && existing.lockType === "shared"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "FileLockRepository.checkAvailability:query",
            "FileLockRepository.checkAvailability:decodeRows",
          ),
        ),
      );
  };

  return {
    acquire,
    release,
    listByIssueId,
    checkAvailability,
  } satisfies FileLockRepositoryShape;
});

export const FileLockRepositoryLive = Layer.effect(FileLockRepository, makeFileLockRepository);
