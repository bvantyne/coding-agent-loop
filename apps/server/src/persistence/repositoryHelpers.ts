import { Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "./Errors.ts";

/**
 * Creates an error handler that maps a raw failure to a persistence decode error when the cause is a schema error, or to a persistence SQL error otherwise.
 *
 * @param sqlOperation - Label for the SQL operation used when producing a SQL persistence error
 * @param decodeOperation - Label for the decode operation used when producing a decode persistence error
 * @returns A function that accepts a `cause` and returns a persistence error: a decode error for schema validation failures, otherwise a SQL error
 */
export function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}
