import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { agentStateLayerConfig, layerConfig } from "./Sqlite.ts";

const makeServerConfigLayer = (stateDir: string, agentStateDbPath: string) =>
  Layer.succeed(ServerConfig, {
    mode: "web",
    port: 0,
    host: undefined,
    cwd: process.cwd(),
    keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
    stateDir,
    agentStateDbPath,
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
  } satisfies ServerConfigShape);

it("keeps the shared persistence database on state.sqlite when agent state is custom", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-shared-db-"));
  const customAgentStateDbPath = path.join(stateDir, "custom-agent-state.db");

  try {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly file: string }>`PRAGMA database_list;`;
      }).pipe(
        Effect.provide(
          layerConfig.pipe(
            Layer.provide(makeServerConfigLayer(stateDir, customAgentStateDbPath)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Effect.orDie,
      ),
    );

    assert.equal(rows[0]?.file, path.join(stateDir, "state.sqlite"));
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

it("uses the dedicated agent state database path for agent-state repositories", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-agent-state-db-"));
  const customAgentStateDbPath = path.join(stateDir, "custom-agent-state.db");

  try {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly file: string }>`PRAGMA database_list;`;
      }).pipe(
        Effect.provide(
          agentStateLayerConfig.pipe(
            Layer.provide(makeServerConfigLayer(stateDir, customAgentStateDbPath)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Effect.orDie,
      ),
    );

    assert.equal(rows[0]?.file, customAgentStateDbPath);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
