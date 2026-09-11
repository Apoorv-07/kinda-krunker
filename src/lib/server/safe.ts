import {
  ensureSchema,
  invalidateSchema,
  isMissingRelation,
} from "@/db/ensure-schema";

/**
 * Run a DB operation, retrying once if the tables turned out to be missing.
 * Keeps a long-lived serverless instance alive after the schema is dropped or
 * replaced, without paying for a existence check on every request.
 */
export async function withSchema<T>(fn: () => Promise<T>): Promise<T> {
  await ensureSchema();
  try {
    return await fn();
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    invalidateSchema();
    await ensureSchema();
    return fn();
  }
}
