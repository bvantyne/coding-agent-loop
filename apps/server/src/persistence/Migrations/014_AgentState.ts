import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS issue_queue (
      id TEXT PRIMARY KEY,
      linear_identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 3,
      sprint_branch TEXT,
      worktree_path TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_issue_queue_status_priority
    ON issue_queue(status, priority, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      cli_backend TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'starting',
      assigned_files TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      exit_code INTEGER,
      error_output TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_issue_started
    ON agent_sessions(issue_id, started_at, id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status_started
    ON agent_sessions(status, started_at, id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS file_locks (
      file_path TEXT NOT NULL,
      locked_by_agent TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      locked_by_issue TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      locked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'exclusive',
      PRIMARY KEY (file_path, locked_by_agent)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_file_locks_issue_path
    ON file_locks(locked_by_issue, file_path, locked_by_agent)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_file_locks_expiry
    ON file_locks(file_path, expires_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_artifacts (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issue_queue(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      plan_content TEXT NOT NULL,
      feedback_rounds TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      approved_at TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_artifacts_issue_version
    ON plan_artifacts(issue_id, version)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_artifacts_issue_created
    ON plan_artifacts(issue_id, created_at, id)
  `;
});
