import { Layer } from "effect";

import { AgentStateSqlitePersistenceMemory, agentStateLayerConfig } from "./Sqlite.ts";
import { AgentSessionRepositoryLive } from "./AgentSessions.ts";
import { FileLockRepositoryLive } from "./FileLocks.ts";
import { IssueQueueRepositoryLive } from "./IssueQueue.ts";
import { PlanArtifactRepositoryLive } from "./PlanArtifacts.ts";

export const AgentStateRepositoryLayers = Layer.mergeAll(
  IssueQueueRepositoryLive,
  AgentSessionRepositoryLive,
  FileLockRepositoryLive,
  PlanArtifactRepositoryLive,
);

export const AgentStateRepositoriesLive = AgentStateRepositoryLayers.pipe(
  Layer.provide(agentStateLayerConfig),
);

export const AgentStateRepositoriesMemory = AgentStateRepositoryLayers.pipe(
  Layer.provide(AgentStateSqlitePersistenceMemory),
);
