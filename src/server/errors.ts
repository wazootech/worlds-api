/**
 * ErrorResponse provides a structured JSON error response.
 */
export class ErrorResponse extends Response {
  constructor(
    message: string,
    code: number,
    headers: Record<string, string> = {},
  ) {
    super(
      JSON.stringify({
        error: {
          code,
          message,
        },
      }),
      {
        status: code,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
    );
  }

  /**
   * BadRequest creates a 400 Bad Request error response.
   */
  static BadRequest(
    message: string,
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 400, headers);
  }

  /**
   * Unauthorized creates a 401 Unauthorized error response.
   */
  static Unauthorized(
    message = "Unauthorized",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 401, headers);
  }

  /**
   * Forbidden creates a 403 Forbidden error response.
   */
  static Forbidden(
    message = "Forbidden",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 403, headers);
  }

  /**
   * NotFound creates a 404 Not Found error response.
   */
  static NotFound(
    message = "Not found",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 404, headers);
  }

  /**
   * MethodNotAllowed creates a 405 Method Not Allowed error response.
   */
  static MethodNotAllowed(
    message = "Method Not Allowed",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 405, headers);
  }

  /**
   * Conflict creates a 409 Conflict error response.
   */
  static Conflict(
    message: string,
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 409, headers);
  }

  /**
   * PayloadTooLarge creates a 413 Payload Too Large error response.
   */
  static PayloadTooLarge(
    message = "Payload Too Large",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 413, headers);
  }

  /**
   * UnsupportedMediaType creates a 415 Unsupported Media Type error response.
   */
  static UnsupportedMediaType(
    message = "Unsupported Media Type",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 415, headers);
  }

  /**
   * RateLimitExceeded creates a 429 Too Many Requests error response.
   */
  static RateLimitExceeded(
    message = "Rate limit exceeded",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 429, headers);
  }

  /**
   * InternalServerError creates a 500 Internal Server Error response.
   */
  static InternalServerError(
    message = "Internal Server Error",
    headers: Record<string, string> = {},
  ): ErrorResponse {
    return new ErrorResponse(message, 500, headers);
  }
}
