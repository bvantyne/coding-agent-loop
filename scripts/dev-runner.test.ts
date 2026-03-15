import * as assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";

import {
  DEFAULT_DEV_STATE_DIR,
  createDevRunnerEnv,
  findFirstAvailableOffset,
  resolveModePortOffsets,
  resolveOffset,
} from "./dev-runner.ts";

const runNodeEffect = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);
const runNodeServicesEffect = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    (effect as Effect.Effect<A, unknown, never>).pipe(Effect.provide(NodeServices.layer as never)),
  );

test("resolveOffset uses explicit T3CODE_PORT_OFFSET when provided", () => {
  const result = resolveOffset({ portOffset: 12, devInstance: undefined });
  assert.deepEqual(result, {
    offset: 12,
    source: "T3CODE_PORT_OFFSET=12",
  });
});

test("resolveOffset hashes non-numeric instance values", () => {
  const result = resolveOffset({ portOffset: undefined, devInstance: "feature-branch" });
  assert.ok(result.offset >= 1);
  assert.ok(result.offset <= 3000);
});

test("resolveOffset throws for negative port offset", () => {
  assert.throws(
    () => resolveOffset({ portOffset: -1, devInstance: undefined }),
    /Invalid T3CODE_PORT_OFFSET/,
  );
});

test("createDevRunnerEnv defaults state dir to ~/.t3/dev when not provided", async () => {
  const [env, defaultStateDir] = await Effect.runPromise(
    Effect.all([
      createDevRunnerEnv({
        mode: "dev",
        baseEnv: {},
        serverOffset: 0,
        webOffset: 0,
        stateDir: undefined,
        authToken: undefined,
        noBrowser: undefined,
        autoBootstrapProjectFromCwd: undefined,
        logWebSocketEvents: undefined,
        host: undefined,
        port: undefined,
        devUrl: undefined,
      }),
      DEFAULT_DEV_STATE_DIR,
    ]).pipe(Effect.provide(NodeServices.layer)),
  );

  assert.equal(env.T3CODE_STATE_DIR, defaultStateDir);
});

test("createDevRunnerEnv supports explicit typed overrides", async () => {
  const env = await runNodeServicesEffect(
    createDevRunnerEnv({
      mode: "dev:server",
      baseEnv: {},
      serverOffset: 0,
      webOffset: 0,
      stateDir: "/tmp/override-state",
      authToken: "secret",
      noBrowser: true,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: true,
      host: "0.0.0.0",
      port: 4222,
      devUrl: new URL("http://localhost:7331"),
    }),
  );

  assert.equal(env.T3CODE_STATE_DIR, resolve("/tmp/override-state"));
  assert.equal(env.T3CODE_PORT, "4222");
  assert.equal(env.VITE_WS_URL, "ws://localhost:4222");
  assert.equal(env.T3CODE_NO_BROWSER, "1");
  assert.equal(env.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "0");
  assert.equal(env.T3CODE_LOG_WS_EVENTS, "1");
  assert.equal(env.T3CODE_HOST, "0.0.0.0");
  assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:7331/");
});

test("createDevRunnerEnv does not force websocket logging on in dev mode when unset", async () => {
  const env = await runNodeServicesEffect(
    createDevRunnerEnv({
      mode: "dev",
      baseEnv: {
        T3CODE_LOG_WS_EVENTS: "keep-me-out",
      },
      serverOffset: 0,
      webOffset: 0,
      stateDir: undefined,
      authToken: undefined,
      noBrowser: undefined,
      autoBootstrapProjectFromCwd: undefined,
      logWebSocketEvents: undefined,
      host: undefined,
      port: undefined,
      devUrl: undefined,
    }),
  );

  assert.equal(env.T3CODE_MODE, "web");
  assert.equal(env.T3CODE_LOG_WS_EVENTS, undefined);
});

test("createDevRunnerEnv forwards explicit websocket logging false without coercing it away", async () => {
  const env = await runNodeServicesEffect(
    createDevRunnerEnv({
      mode: "dev",
      baseEnv: {},
      serverOffset: 0,
      webOffset: 0,
      stateDir: undefined,
      authToken: undefined,
      noBrowser: undefined,
      autoBootstrapProjectFromCwd: undefined,
      logWebSocketEvents: false,
      host: undefined,
      port: undefined,
      devUrl: undefined,
    }),
  );

  assert.equal(env.T3CODE_LOG_WS_EVENTS, "0");
});

test("findFirstAvailableOffset returns the starting offset when required ports are available", async () => {
  const offset = await runNodeEffect(
    findFirstAvailableOffset({
      startOffset: 0,
      requireServerPort: true,
      requireWebPort: true,
      checkPortAvailability: () => Effect.succeed(true),
    }),
  );

  assert.equal(offset, 0);
});

test("findFirstAvailableOffset advances until all required ports are available", async () => {
  const taken = new Set([3773, 5733, 3774, 5734]);
  const offset = await runNodeEffect(
    findFirstAvailableOffset({
      startOffset: 0,
      requireServerPort: true,
      requireWebPort: true,
      checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
    }),
  );

  assert.equal(offset, 2);
});

test("findFirstAvailableOffset allows offsets where only non-required ports exceed max", async () => {
  const offset = await runNodeEffect(
    findFirstAvailableOffset({
      startOffset: 59_803,
      requireServerPort: true,
      requireWebPort: false,
      checkPortAvailability: () => Effect.succeed(true),
    }),
  );

  assert.equal(offset, 59_803);
});

test("resolveModePortOffsets uses a shared fallback offset for dev mode", async () => {
  const taken = new Set([3773, 5733]);
  const offsets = await runNodeEffect(
    resolveModePortOffsets({
      mode: "dev",
      startOffset: 0,
      hasExplicitServerPort: false,
      hasExplicitDevUrl: false,
      checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
    }),
  );

  assert.deepEqual(offsets, { serverOffset: 1, webOffset: 1 });
});

test("resolveModePortOffsets keeps server offset stable for dev:web and only shifts web offset", async () => {
  const taken = new Set([5733]);
  const offsets = await runNodeEffect(
    resolveModePortOffsets({
      mode: "dev:web",
      startOffset: 0,
      hasExplicitServerPort: false,
      hasExplicitDevUrl: false,
      checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
    }),
  );

  assert.deepEqual(offsets, { serverOffset: 0, webOffset: 1 });
});

test("resolveModePortOffsets shifts only server offset for dev:server", async () => {
  const taken = new Set([3773]);
  const offsets = await runNodeEffect(
    resolveModePortOffsets({
      mode: "dev:server",
      startOffset: 0,
      hasExplicitServerPort: false,
      hasExplicitDevUrl: false,
      checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
    }),
  );

  assert.deepEqual(offsets, { serverOffset: 1, webOffset: 1 });
});

test("resolveModePortOffsets respects explicit dev-url override for dev:web", async () => {
  const offsets = await runNodeEffect(
    resolveModePortOffsets({
      mode: "dev:web",
      startOffset: 0,
      hasExplicitServerPort: false,
      hasExplicitDevUrl: true,
      checkPortAvailability: () => Effect.succeed(false),
    }),
  );

  assert.deepEqual(offsets, { serverOffset: 0, webOffset: 0 });
});

test("resolveModePortOffsets respects explicit server port override for dev:server", async () => {
  const offsets = await runNodeEffect(
    resolveModePortOffsets({
      mode: "dev:server",
      startOffset: 0,
      hasExplicitServerPort: true,
      hasExplicitDevUrl: false,
      checkPortAvailability: () => Effect.succeed(false),
    }),
  );

  assert.deepEqual(offsets, { serverOffset: 0, webOffset: 0 });
});
