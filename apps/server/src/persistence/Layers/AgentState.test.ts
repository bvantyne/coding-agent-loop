import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { FileLockConflictError, FileLockExpiredError } from "../Errors.ts";
import { AgentSessionRepository } from "../Services/AgentSessions.ts";
import { IssueQueueRepository } from "../Services/IssueQueue.ts";
import { FileLockRepository } from "../Services/FileLocks.ts";
import { PlanArtifactRepository } from "../Services/PlanArtifacts.ts";
import { AgentSessionId, IssueQueueId, PlanArtifactId } from "../Services/AgentStateSchemas.ts";
import { AgentStateRepositoriesLive, AgentStateRepositoryLayers } from "./AgentState.ts";
import { AgentStateSqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  AgentStateRepositoryLayers.pipe(Layer.provideMerge(AgentStateSqlitePersistenceMemory)),
);

const makeServerConfigLayer = (stateDir: string) =>
  Layer.succeed(ServerConfig, {
    mode: "web",
    port: 0,
    host: undefined,
    cwd: process.cwd(),
    keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
    stateDir,
    agentStateDbPath: path.join(stateDir, "agent-state.db"),
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
  } satisfies ServerConfigShape);

layer("AgentStateRepositoriesLive", (it) => {
  it.effect("creates the agent-state tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const result = yield* Effect.all({
        issueQueue: sql<{ readonly count: number }>`
          SELECT COUNT(*) AS "count"
          FROM issue_queue
        `,
        agentSessions: sql<{ readonly count: number }>`
          SELECT COUNT(*) AS "count"
          FROM agent_sessions
        `,
        fileLocks: sql<{ readonly count: number }>`
          SELECT COUNT(*) AS "count"
          FROM file_locks
        `,
        planArtifacts: sql<{ readonly count: number }>`
          SELECT COUNT(*) AS "count"
          FROM plan_artifacts
        `,
        pragma: sql<{ readonly journal_mode: string }>`PRAGMA journal_mode;`,
      }).pipe(
        Effect.map(({ pragma, ...counts }) => ({
          tableCounts: Object.fromEntries(
            Object.entries(counts).map(([name, rows]) => [name, rows[0]?.count ?? -1]),
          ),
          journalMode: pragma[0]?.journal_mode,
        })),
      );

      assert.deepStrictEqual(result.tableCounts, {
        issueQueue: 0,
        agentSessions: 0,
        fileLocks: 0,
        planArtifacts: 0,
      });
    }),
  );

  it.effect(
    "supports CRUD and domain queries across issue, session, lock, and plan repositories",
    () =>
      Effect.gen(function* () {
        const issues = yield* IssueQueueRepository;
        const sessions = yield* AgentSessionRepository;
        const fileLocks = yield* FileLockRepository;
        const plans = yield* PlanArtifactRepository;

        const now = new Date().toISOString();
        const issueId = IssueQueueId.makeUnsafe("issue-1");
        const sessionIdA = AgentSessionId.makeUnsafe("agent-1");
        const sessionIdB = AgentSessionId.makeUnsafe("agent-2");
        const planIdV1 = PlanArtifactId.makeUnsafe("plan-1");
        const planIdV2 = PlanArtifactId.makeUnsafe("plan-2");

        yield* issues.insert({
          id: issueId,
          linearIdentifier: "CODE-8",
          title: "SQLite schema design and Effect SQL integration for agent state",
          description: "Backs the autonomous coding agent loop.",
          status: "queued",
          priority: 3,
          sprintBranch: "feature/codex-agent-loop",
          worktreePath: "/tmp/worktrees/code-8",
          retryCount: 0,
          maxRetries: 3,
          failureReason: null,
          createdAt: now,
          updatedAt: now,
        });

        yield* issues.updateStatus({
          id: issueId,
          status: "planning",
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
          failureReason: null,
        });

        const loadedIssue = yield* issues.getById({ id: issueId });
        assert.equal(Option.isSome(loadedIssue), true);
        if (Option.isSome(loadedIssue)) {
          assert.equal(loadedIssue.value.status, "planning");
        }

        const planningIssues = yield* issues.listByStatus({ status: "planning" });
        assert.equal(planningIssues.length, 1);
        assert.equal(planningIssues[0]?.id, issueId);

        yield* sessions.insert({
          id: sessionIdA,
          issueId,
          agentType: "planner",
          cliBackend: "codex",
          pid: 101,
          status: "starting",
          assignedFiles: ["apps/server/src/persistence/Layers/IssueQueue.ts"],
          startedAt: now,
          completedAt: null,
          exitCode: null,
          errorOutput: null,
        });

        yield* sessions.insert({
          id: sessionIdB,
          issueId,
          agentType: "validator",
          cliBackend: "codex",
          pid: 202,
          status: "running",
          assignedFiles: ["apps/server/src/persistence/Layers/FileLocks.ts"],
          startedAt: now,
          completedAt: null,
          exitCode: null,
          errorOutput: null,
        });

        yield* sessions.updateStatus({
          id: sessionIdA,
          status: "completed",
          completedAt: new Date(Date.now() + 2_000).toISOString(),
          exitCode: 0,
          errorOutput: null,
        });

        const issueSessions = yield* sessions.listByIssueId({ issueId });
        assert.equal(issueSessions.length, 2);
        const activeSessions = yield* sessions.listActive();
        assert.equal(activeSessions.length, 1);
        assert.equal(activeSessions[0]?.id, sessionIdB);

        const filePath = "apps/server/src/persistence/Layers/FileLocks.ts";
        const firstLockTime = new Date(Date.now() + 3_000).toISOString();
        const secondLockTime = new Date(Date.now() + 4_000).toISOString();

        yield* fileLocks.acquire({
          filePath,
          lockedByAgent: sessionIdA,
          lockedByIssue: issueId,
          lockedAt: firstLockTime,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          lockType: "shared",
        });

        const sharedAvailable = yield* fileLocks.checkAvailability({
          filePath,
          lockType: "shared",
          lockedByAgent: sessionIdB,
        });
        assert.equal(sharedAvailable, true);

        yield* fileLocks.acquire({
          filePath,
          lockedByAgent: sessionIdB,
          lockedByIssue: issueId,
          lockedAt: secondLockTime,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          lockType: "shared",
        });

        const exclusiveAvailable = yield* fileLocks.checkAvailability({
          filePath,
          lockType: "exclusive",
          lockedByAgent: sessionIdB,
        });
        assert.equal(exclusiveAvailable, false);

        const conflictingAcquire = yield* Effect.result(
          fileLocks.acquire({
            filePath,
            lockedByAgent: sessionIdB,
            lockedByIssue: issueId,
            lockedAt: new Date(Date.now() + 5_000).toISOString(),
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            lockType: "exclusive",
          }),
        );
        assert.equal(conflictingAcquire._tag, "Failure");
        if (conflictingAcquire._tag === "Failure") {
          assert.ok(Schema.is(FileLockConflictError)(conflictingAcquire.failure));
        }

        const issueLocks = yield* fileLocks.listByIssueId({ issueId });
        assert.equal(issueLocks.length, 2);

        yield* fileLocks.release({
          filePath,
          lockedByAgent: sessionIdA,
        });
        yield* fileLocks.release({
          filePath,
          lockedByAgent: sessionIdB,
        });

        const exclusiveAvailableAfterRelease = yield* fileLocks.checkAvailability({
          filePath,
          lockType: "exclusive",
          lockedByAgent: sessionIdB,
        });
        assert.equal(exclusiveAvailableAfterRelease, true);

        yield* plans.insert({
          id: planIdV1,
          issueId,
          version: 1,
          planContent: "Draft plan v1",
          feedbackRounds: [
            {
              summary: "Needs retry policy details.",
              checkpoints: ["locks", "retries"],
              metadata: { attempts: 2, approved: false },
            },
          ],
          status: "draft",
          createdAt: now,
          approvedAt: null,
        });

        yield* plans.insert({
          id: planIdV2,
          issueId,
          version: 2,
          planContent: "Approved plan v2",
          feedbackRounds: [
            {
              summary: "Approved after SQL repo review.",
              checklist: [{ item: "schema" }, { item: "constraints" }],
            },
          ],
          status: "reviewing",
          createdAt: new Date(Date.now() + 6_000).toISOString(),
          approvedAt: null,
        });

        yield* plans.update({
          id: planIdV2,
          issueId,
          version: 2,
          planContent: "Approved plan v2",
          feedbackRounds: [
            {
              summary: "Approved after SQL repo review.",
              checklist: [{ item: "schema" }, { item: "constraints" }],
            },
          ],
          status: "approved",
          createdAt: new Date(Date.now() + 6_000).toISOString(),
          approvedAt: new Date(Date.now() + 7_000).toISOString(),
        });

        const latestPlan = yield* plans.getLatestByIssueId({ issueId });
        assert.equal(Option.isSome(latestPlan), true);
        if (Option.isSome(latestPlan)) {
          assert.equal(latestPlan.value.id, planIdV2);
          assert.equal(latestPlan.value.status, "approved");
        }

        const planVersions = yield* plans.listVersionsByIssueId({ issueId });
        assert.equal(planVersions.length, 2);
        assert.deepStrictEqual(
          planVersions.map((artifact) => artifact.version),
          [1, 2],
        );

        const loadedPlan = yield* plans.getById({ id: planIdV1 });
        assert.equal(Option.isSome(loadedPlan), true);
        if (Option.isSome(loadedPlan)) {
          assert.equal(loadedPlan.value.version, 1);
        }

        yield* plans.deleteById({ id: planIdV1 });
        yield* sessions.deleteById({ id: sessionIdA });
        yield* sessions.deleteById({ id: sessionIdB });
        yield* issues.deleteById({ id: issueId });

        const deletedIssue = yield* issues.getById({ id: issueId });
        assert.equal(Option.isSome(deletedIssue), false);
      }),
  );

  it.effect("rejects already-expired lock requests using authoritative database time", () =>
    Effect.gen(function* () {
      const issues = yield* IssueQueueRepository;
      const sessions = yield* AgentSessionRepository;
      const fileLocks = yield* FileLockRepository;

      const now = new Date().toISOString();
      const issueId = IssueQueueId.makeUnsafe("issue-expired");
      const sessionId = AgentSessionId.makeUnsafe("agent-expired");

      yield* issues.insert({
        id: issueId,
        linearIdentifier: "CODE-EXPIRED",
        title: "expired lock request",
        description: null,
        status: "queued",
        priority: 1,
        sprintBranch: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 1,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });

      yield* sessions.insert({
        id: sessionId,
        issueId,
        agentType: "planner",
        cliBackend: "codex",
        pid: 303,
        status: "running",
        assignedFiles: ["apps/server/src/persistence/Layers/FileLocks.ts"],
        startedAt: now,
        completedAt: null,
        exitCode: null,
        errorOutput: null,
      });

      const expiredAcquire = yield* Effect.result(
        fileLocks.acquire({
          filePath: "apps/server/src/persistence/Layers/FileLocks.ts",
          lockedByAgent: sessionId,
          lockedByIssue: issueId,
          lockedAt: now,
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          lockType: "exclusive",
        }),
      );

      assert.equal(expiredAcquire._tag, "Failure");
      if (expiredAcquire._tag === "Failure") {
        assert.ok(Schema.is(FileLockExpiredError)(expiredAcquire.failure));
      }
    }),
  );

  it.effect("enforces JSON constraints on persisted agent-state payload columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* sql`
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
          ${"issue-json"},
          ${"CODE-JSON"},
          ${"json constraint"},
          ${null},
          ${"queued"},
          ${0},
          ${null},
          ${null},
          ${0},
          ${1},
          ${null},
          ${now},
          ${now}
        )
      `;

      const invalidSessionInsert = yield* Effect.result(sql`
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
          ${"agent-json"},
          ${"issue-json"},
          ${"planner"},
          ${"codex"},
          ${1},
          ${"running"},
          ${"not-json"},
          ${now},
          ${null},
          ${null},
          ${null}
        )
      `);
      assert.equal(invalidSessionInsert._tag, "Failure");

      const validSessionInsert = yield* Effect.result(sql`
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
          ${"agent-json-valid"},
          ${"issue-json"},
          ${"planner"},
          ${"codex"},
          ${1},
          ${"running"},
          ${'["apps/server/src/persistence/Layers/FileLocks.ts"]'},
          ${now},
          ${null},
          ${null},
          ${null}
        )
      `);
      assert.equal(validSessionInsert._tag, "Success");

      const invalidPlanInsert = yield* Effect.result(sql`
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
          ${"plan-json"},
          ${"issue-json"},
          ${1},
          ${"plan"},
          ${"{"},
          ${"draft"},
          ${now},
          ${null}
        )
      `);
      assert.equal(invalidPlanInsert._tag, "Failure");
    }),
  );

  it.effect("serializes conflicting exclusive lock acquires across separate clients", () =>
    Effect.gen(function* () {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-agent-lock-race-"));
      const layerA = AgentStateRepositoriesLive.pipe(
        Layer.provide(makeServerConfigLayer(stateDir)),
        Layer.provideMerge(NodeServices.layer),
      );
      const layerB = AgentStateRepositoriesLive.pipe(
        Layer.provide(makeServerConfigLayer(stateDir)),
        Layer.provideMerge(NodeServices.layer),
      );
      const now = new Date().toISOString();
      const issueId = IssueQueueId.makeUnsafe("issue-race");
      const sessionIdA = AgentSessionId.makeUnsafe("agent-race-a");
      const sessionIdB = AgentSessionId.makeUnsafe("agent-race-b");
      const filePath = "apps/server/src/persistence/Layers/FileLocks.ts";

      try {
        yield* Effect.gen(function* () {
          const issues = yield* IssueQueueRepository;
          const sessions = yield* AgentSessionRepository;

          yield* issues.insert({
            id: issueId,
            linearIdentifier: "CODE-RACE",
            title: "race setup",
            description: null,
            status: "queued",
            priority: 0,
            sprintBranch: null,
            worktreePath: null,
            retryCount: 0,
            maxRetries: 1,
            failureReason: null,
            createdAt: now,
            updatedAt: now,
          });

          yield* sessions.insert({
            id: sessionIdA,
            issueId,
            agentType: "planner",
            cliBackend: "codex",
            pid: 11,
            status: "running",
            assignedFiles: [filePath],
            startedAt: now,
            completedAt: null,
            exitCode: null,
            errorOutput: null,
          });

          yield* sessions.insert({
            id: sessionIdB,
            issueId,
            agentType: "validator",
            cliBackend: "codex",
            pid: 22,
            status: "running",
            assignedFiles: [filePath],
            startedAt: now,
            completedAt: null,
            exitCode: null,
            errorOutput: null,
          });
        }).pipe(Effect.provide(layerA));

        const acquireWith = (runtimeLayer: typeof layerA, lockedByAgent: AgentSessionId) =>
          Effect.gen(function* () {
            const fileLocks = yield* FileLockRepository;
            return yield* Effect.result(
              fileLocks.acquire({
                filePath,
                lockedByAgent,
                lockedByIssue: issueId,
                lockedAt: now,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                lockType: "exclusive",
              }),
            );
          }).pipe(Effect.provide(runtimeLayer));

        const results = yield* Effect.all(
          [acquireWith(layerA, sessionIdA), acquireWith(layerB, sessionIdB)],
          { concurrency: "unbounded" },
        );

        assert.equal(results.filter((result) => result._tag === "Success").length, 1);
        assert.equal(results.filter((result) => result._tag === "Failure").length, 1);
        const failure = results.find((result) => result._tag === "Failure");
        if (failure?._tag === "Failure") {
          assert.ok(Schema.is(FileLockConflictError)(failure.failure));
        }

        const lockRows = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS "count"
            FROM file_locks
            WHERE file_path = ${filePath}
          `;
        }).pipe(Effect.provide(layerA));
        assert.equal(lockRows[0]?.count, 1);
      } finally {
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    }),
  );
});
