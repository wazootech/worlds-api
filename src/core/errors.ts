/**
 * Typed error classes for the Worlds domain layer.
 *
 * Explicit subclasses (not string-matched messages) let {@link ../api/rpc/handler.ts}
 * map failures to stable RPC `error.code` values:
 *
 * | Class | RPC code |
 * | ----- | -------- |
 * | {@link WorldAlreadyExistsError} | `ALREADY_EXISTS` |
 * | {@link WorldNotFoundError} | `NOT_FOUND` |
 * | {@link InvalidArgumentError}, {@link InvalidPageTokenError} | `INVALID_ARGUMENT` |
 * | {@link SparqlSyntaxError}, {@link SparqlUnsupportedOperationError}, {@link SparqlError} | `INVALID_ARGUMENT` |
 * | Other `Error` | `INTERNAL` |
 */

/** Thrown when `createWorld` targets an existing `namespace`/`id`. */
export class WorldAlreadyExistsError extends Error {
  override name = "WorldAlreadyExistsError";
  constructor(reference: { namespace: string; id: string }) {
    super(`World already exists: ${reference.namespace}/${reference.id}`);
  }
}

/**
 * Thrown when an operation requires an existing world. Not used for `getWorld`
 * (that returns `null`).
 */
export class WorldNotFoundError extends Error {
  override name = "WorldNotFoundError";
  constructor(reference: { namespace: string; id: string }) {
    super(`World not found: ${reference.namespace}/${reference.id}`);
  }
}

/** Opaque pagination token missing, malformed, or signature mismatch. */
export class InvalidPageTokenError extends Error {
  override name = "InvalidPageTokenError";
  constructor(message = "Invalid page token") {
    super(message);
  }
}

/** Validation failures (e.g. empty SPARQL sources, invalid page size). */
export class InvalidArgumentError extends Error {
  override name = "InvalidArgumentError";
  constructor(message: string) {
    super(message);
  }
}

/** Malformed SPARQL or query timeout from the engine layer. */
export class SparqlSyntaxError extends Error {
  override name = "SparqlSyntaxError";
  constructor(message: string) {
    super(message);
  }
}

/** e.g. CONSTRUCT/DESCRIBE; multi-source UPDATE is enforced in {@link ./worlds.ts}. */
export class SparqlUnsupportedOperationError extends Error {
  override name = "SparqlUnsupportedOperationError";
  constructor(message: string) {
    super(message);
  }
}

/** Reserved for explicit SPARQL engine failures when introduced in call paths. */
export class SparqlError extends Error {
  override name = "SparqlError";
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when request lacks authentication. */
export class UnauthenticatedError extends Error {
  override name = "UnauthenticatedError";
  constructor(message = "Authentication required") {
    super(message);
  }
}

/** Thrown when user lacks permission to access a resource. */
export class PermissionDeniedError extends Error {
  override name = "PermissionDeniedError";
  constructor(resource?: string) {
    super(resource ? `Access denied to: ${resource}` : "Permission denied");
  }
}
