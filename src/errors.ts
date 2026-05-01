/**
 * Typed error classes for the Worlds API.
 *
 * Using explicit types (instead of string-matched messages) so that RPC error
 * mapping is reliable and consumers can programmatically distinguish errors.
 */

export class WorldAlreadyExistsError extends Error {
  override name = "WorldAlreadyExistsError";
  constructor(reference: { namespace: string; id: string }) {
    super(`World already exists: ${reference.namespace}/${reference.id}`);
  }
}

export class WorldNotFoundError extends Error {
  override name = "WorldNotFoundError";
  constructor(reference: { namespace: string; id: string }) {
    super(`World not found: ${reference.namespace}/${reference.id}`);
  }
}

export class InvalidPageTokenError extends Error {
  override name = "InvalidPageTokenError";
  constructor(message = "Invalid page token") {
    super(message);
  }
}

export class InvalidArgumentError extends Error {
  override name = "InvalidArgumentError";
  constructor(message: string) {
    super(message);
  }
}

export class SparqlSyntaxError extends Error {
  override name = "SparqlSyntaxError";
  constructor(message: string) {
    super(message);
  }
}

export class SparqlUnsupportedOperationError extends Error {
  override name = "SparqlUnsupportedOperationError";
  constructor(message: string) {
    super(message);
  }
}

export class SparqlError extends Error {
  override name = "SparqlError";
  constructor(message: string) {
    super(message);
  }
}
