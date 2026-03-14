import { Database } from "bun:sqlite";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ServiceMap from "effect/ServiceMap";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const TypeId: TypeId = "~local/sqlite-bun/SqliteClient";

export type TypeId = "~local/sqlite-bun/SqliteClient";

export const SqliteClient = ServiceMap.Service<Client.SqlClient>("t3/persistence/BunSqliteClient");

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly create?: boolean | undefined;
  readonly readwrite?: boolean | undefined;
  readonly disableWAL?: boolean | undefined;
  readonly beginTransaction?: string | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

interface SqliteConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
}

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const db = new Database(options.filename, {
        readonly: options.readonly,
        readwrite: options.readwrite ?? true,
        create: options.create ?? true,
      } as never);
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));

      if (options.disableWAL !== true) {
        db.run("PRAGMA journal_mode = WAL;");
      }

      const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = ServiceMap.get(fiber.services, Client.SafeIntegers);
          // @ts-expect-error bun types are missing safeIntegers()
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.all(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
          }
        });

      const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = ServiceMap.get(fiber.services, Client.SafeIntegers);
          // @ts-expect-error bun types are missing safeIntegers()
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.values(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
          }
        });

      return identity<SqliteConnection>({
        execute(sql, params, rowTransform) {
          return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
        },
        executeRaw(sql, params) {
          return run(sql, params);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, rowTransform) {
          return this.execute(sql, params, rowTransform);
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
        export: Effect.try({
          try: () => db.serialize(),
          catch: (cause) => new SqlError({ cause, message: "Failed to export database" }),
        }),
        loadExtension: (path) =>
          Effect.try({
            try: () => db.loadExtension(path),
            catch: (cause) => new SqlError({ cause, message: "Failed to load extension" }),
          }),
      });
    });

    const semaphore = yield* Semaphore.make(1);
    const connection = yield* makeConnection;

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = ServiceMap.getUnsafe(fiber.services, Scope.Scope);
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () =>
          Scope.addFinalizer(scope, semaphore.release(1)),
        ),
        connection,
      );
    });

    return yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer,
      beginTransaction: options.beginTransaction,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transformRows,
    });
  });

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
  Layer.effectServices(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(make),
        Effect.map((client) =>
          ServiceMap.make(SqliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effectServices(
    Effect.map(make(config), (client) =>
      ServiceMap.make(SqliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
