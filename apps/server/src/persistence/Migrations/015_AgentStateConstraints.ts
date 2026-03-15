import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`PRAGMA defer_foreign_keys = ON;`;

  yield* sql`ALTER TABLE issue_queue RENAME TO issue_queue_old;`;
  yield* sql`ALTER TABLE agent_sessions RENAME TO agent_sessions_old;`;
  yield* sql`ALTER TABLE file_locks RENAME TO file_locks_old;`;
  yield* sql`ALTER TABLE plan_artifacts RENAME TO plan_artifacts_old;`;

  yield* sql`
    CREATE TABLE issue_queue (
      id TEXT PRIMARY KEY,
      linear_identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'validating', 'planning', 'coding', 'verifying', 'reviewing', 'merged', 'failed')),
      priority INTEGER NOT NULL DEFAULT 3
        CHECK (priority >= 0),
      sprint_branch TEXT,
      worktree_path TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
        CHECK (retry_count >= 0),
      max_retries INTEGER NOT NULL DEFAULT 3
        CHECK (max_retries >= 1),
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

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
    SELECT
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
    FROM issue_queue_old
  `;

  yield* sql`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      cli_backend TEXT NOT NULL,
      pid INTEGER
        CHECK (pid IS NULL OR pid >= 0),
      status TEXT NOT NULL DEFAULT 'starting'
        CHECK (status IN ('starting', 'running', 'completed', 'failed', 'killed')),
      assigned_files TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(assigned_files)),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      exit_code INTEGER,
      error_output TEXT
    )
  `;

  yield* sql`
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
    SELECT
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
    FROM agent_sessions_old
  `;

  yield* sql`
    CREATE TABLE file_locks (
      file_path TEXT NOT NULL,
      locked_by_agent TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      locked_by_issue TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      locked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'exclusive'
        CHECK (lock_type IN ('exclusive', 'shared')),
      CHECK (expires_at >= locked_at),
      PRIMARY KEY (file_path, locked_by_agent)
    )
  `;

  yield* sql`
    INSERT INTO file_locks (
      file_path,
      locked_by_agent,
      locked_by_issue,
      locked_at,
      expires_at,
      lock_type
    )
    SELECT
      file_path,
      locked_by_agent,
      locked_by_issue,
      locked_at,
      expires_at,
      lock_type
    FROM file_locks_old
  `;

  yield* sql`
    CREATE TABLE plan_artifacts (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1
        CHECK (version >= 1),
      plan_content TEXT NOT NULL,
      feedback_rounds TEXT
        CHECK (feedback_rounds IS NULL OR json_valid(feedback_rounds)),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'reviewing', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      approved_at TEXT
    )
  `;

  yield* sql`
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
    SELECT
      id,
      issue_id,
      version,
      plan_content,
      feedback_rounds,
      status,
      created_at,
      approved_at
    FROM plan_artifacts_old
  `;

  yield* sql`DROP TABLE file_locks_old;`;
  yield* sql`DROP TABLE plan_artifacts_old;`;
  yield* sql`DROP TABLE agent_sessions_old;`;
  yield* sql`DROP TABLE issue_queue_old;`;

  yield* sql`
    CREATE INDEX idx_issue_queue_status_priority
    ON issue_queue(status, priority, created_at)
  `;

  yield* sql`
    CREATE INDEX idx_agent_sessions_issue_started
    ON agent_sessions(issue_id, started_at, id)
  `;

  yield* sql`
    CREATE INDEX idx_agent_sessions_status_started
    ON agent_sessions(status, started_at, id)
  `;

  yield* sql`
    CREATE INDEX idx_file_locks_issue_path
    ON file_locks(locked_by_issue, file_path, locked_by_agent)
  `;

  yield* sql`
    CREATE INDEX idx_file_locks_expiry
    ON file_locks(file_path, expires_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_plan_artifacts_issue_version
    ON plan_artifacts(issue_id, version)
  `;

  yield* sql`
    CREATE INDEX idx_plan_artifacts_issue_created
    ON plan_artifacts(issue_id, created_at, id)
  `;
});
