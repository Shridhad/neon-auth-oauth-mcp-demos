export type InvalidTokenCode =
  | 'missing_token'
  | 'malformed_header'
  | 'expired'
  | 'invalid_audience'
  | 'invalid_issuer'
  | 'invalid_token';

/** The caller's token is unusable. Maps to HTTP 401 `invalid_token`. */
export class InvalidTokenError extends Error {
  constructor(
    readonly code: InvalidTokenCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/** We could not reach or trust the authorization server, so the token could not be checked. Maps to HTTP 503. */
export class AuthServerUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthServerUnavailableError';
  }
}
