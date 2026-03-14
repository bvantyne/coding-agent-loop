import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema } from "effect";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const IssueQueueId = makeEntityId("IssueQueueId");
export type IssueQueueId = typeof IssueQueueId.Type;

export const AgentSessionId = makeEntityId("AgentSessionId");
export type AgentSessionId = typeof AgentSessionId.Type;

export const PlanArtifactId = makeEntityId("PlanArtifactId");
export type PlanArtifactId = typeof PlanArtifactId.Type;

export const IssueQueueStatus = Schema.Literals([
  "queued",
  "validating",
  "planning",
  "coding",
  "verifying",
  "reviewing",
  "merged",
  "failed",
]);
export type IssueQueueStatus = typeof IssueQueueStatus.Type;

export const AgentSessionType = Schema.Literals([
  "planner",
  "context",
  "feedback",
  "coder",
  "validator",
]);
export type AgentSessionType = typeof AgentSessionType.Type;

export const AgentCliBackend = Schema.Literals(["codex", "claude-code"]);
export type AgentCliBackend = typeof AgentCliBackend.Type;

export const AgentSessionStatus = Schema.Literals([
  "starting",
  "running",
  "completed",
  "failed",
  "killed",
]);
export type AgentSessionStatus = typeof AgentSessionStatus.Type;

export const FileLockType = Schema.Literals(["exclusive", "shared"]);
export type FileLockType = typeof FileLockType.Type;

export const PlanArtifactStatus = Schema.Literals(["draft", "reviewing", "approved", "rejected"]);
export type PlanArtifactStatus = typeof PlanArtifactStatus.Type;

export const IssueQueueEntry = Schema.Struct({
  id: IssueQueueId,
  linearIdentifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  status: IssueQueueStatus,
  priority: NonNegativeInt,
  sprintBranch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  retryCount: NonNegativeInt,
  maxRetries: PositiveInt,
  failureReason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IssueQueueEntry = typeof IssueQueueEntry.Type;

export const AgentSessionEntry = Schema.Struct({
  id: AgentSessionId,
  issueId: IssueQueueId,
  agentType: AgentSessionType,
  cliBackend: AgentCliBackend,
  pid: Schema.NullOr(Schema.Int),
  status: AgentSessionStatus,
  assignedFiles: Schema.Array(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  exitCode: Schema.NullOr(Schema.Int),
  errorOutput: Schema.NullOr(Schema.String),
});
export type AgentSessionEntry = typeof AgentSessionEntry.Type;

export const FileLockEntry = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  lockedByAgent: AgentSessionId,
  lockedByIssue: IssueQueueId,
  lockedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  lockType: FileLockType,
});
export type FileLockEntry = typeof FileLockEntry.Type;

export const PlanArtifactEntry = Schema.Struct({
  id: PlanArtifactId,
  issueId: IssueQueueId,
  version: PositiveInt,
  planContent: TrimmedNonEmptyString,
  feedbackRounds: Schema.NullOr(Schema.Array(Schema.Unknown)),
  status: PlanArtifactStatus,
  createdAt: IsoDateTime,
  approvedAt: Schema.NullOr(IsoDateTime),
});
export type PlanArtifactEntry = typeof PlanArtifactEntry.Type;
