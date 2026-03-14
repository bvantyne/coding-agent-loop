import { Layer } from "effect";

import { AgentSessionRepositoryLive } from "./AgentSessions.ts";
import { FileLockRepositoryLive } from "./FileLocks.ts";
import { IssueQueueRepositoryLive } from "./IssueQueue.ts";
import { PlanArtifactRepositoryLive } from "./PlanArtifacts.ts";

export const AgentStateRepositoriesLive = Layer.mergeAll(
  IssueQueueRepositoryLive,
  AgentSessionRepositoryLive,
  FileLockRepositoryLive,
  PlanArtifactRepositoryLive,
);
