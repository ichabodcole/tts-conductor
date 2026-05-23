/**
 * Error hierarchy for TTS provider failures. Adapters convert SDK-specific errors
 * to these classes so consumers can apply uniform retry / classification logic
 * without parsing error messages.
 *
 * Consumers should use `instanceof` checks rather than string matching:
 *
 * ```ts
 * try {
 *   await provider.generate(chunk);
 * } catch (err) {
 *   if (err instanceof TtsRateLimitError) {
 *     await sleep(err.retryAfterMs ?? 1000);
 *     // retry
 *   } else if (err instanceof TtsTransientError) {
 *     // exponential backoff
 *   } else if (err instanceof TtsInvalidInputError) {
 *     // do not retry; surface to caller
 *   }
 * }
 * ```
 */

/** Base class for all TTS provider errors. Direct instances signal an unclassified failure. */
export class TtsError extends Error {
  /** The underlying error that triggered this one, if any. */
  readonly cause?: unknown;
  /** HTTP status code from the upstream API, if available. */
  readonly statusCode?: number;

  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message);
    this.name = 'TtsError';
    this.cause = options?.cause;
    this.statusCode = options?.statusCode;
  }
}

/**
 * Provider rejected the request because the caller has exceeded a rate limit.
 * Retry after `retryAfterMs` if supplied, otherwise apply caller-default backoff.
 */
export class TtsRateLimitError extends TtsError {
  /** Milliseconds to wait before retrying, parsed from the upstream Retry-After header if present. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options?: { cause?: unknown; statusCode?: number; retryAfterMs?: number },
  ) {
    super(message, options);
    this.name = 'TtsRateLimitError';
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * Provider rejected the request because the caller has exhausted their quota or
 * subscription tier. Retrying without consumer action (upgrade, top-up) will keep failing.
 */
export class TtsQuotaExceededError extends TtsError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.name = 'TtsQuotaExceededError';
  }
}

/**
 * Provider rejected the credentials. The API key is missing, invalid, or revoked.
 * Retrying will not help until the caller fixes their authentication.
 */
export class TtsAuthenticationError extends TtsError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.name = 'TtsAuthenticationError';
  }
}

/**
 * Provider failure that is expected to resolve on retry: 5xx responses, network errors,
 * upstream timeouts, transient connectivity issues. Safe to retry with exponential backoff.
 */
export class TtsTransientError extends TtsError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.name = 'TtsTransientError';
  }
}

/**
 * Provider rejected the request because the input was malformed or unprocessable.
 * Retrying with the same input will not help; the caller must fix the input.
 */
export class TtsInvalidInputError extends TtsError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.name = 'TtsInvalidInputError';
  }
}
