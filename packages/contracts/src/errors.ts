// Standard error envelope and typed error codes (API_CONTRACTS.md §7).

export const ERROR_STATUS = {
  INVALID_INPUT: 400,
  INVALID_CURSOR: 400,
  SESSION_EXPIRED: 401,
  UNAUTHENTICATED: 401,
  INVALID_CONNECTOR_SIGNATURE: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  SELF_APPROVAL_DENIED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  ACTION_STALE: 409,
  ACTION_EXPIRED: 409,
  ACTION_ALREADY_DISPATCHED: 409,
  ACTIVE_INCIDENT_CONFLICT: 409,
  SOURCE_EVENT_CONFLICT: 409,
  CONFLICT: 409,
  VERSION_CONFLICT: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 422,
  INVALID_ACTION_ARGUMENTS: 422,
  PRECONDITION_REQUIRED: 428,
  RATE_LIMITED: 429,
  AI_BUDGET_EXCEEDED: 429,
  INTERNAL: 500,
  DEPENDENCY_UNAVAILABLE: 503,
  CAPACITY_EXCEEDED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'CAPACITY_EXCEEDED',
  'INTERNAL',
]);

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        retryable: RETRYABLE.has(this.code),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Uniform not-found to prevent cross-tenant identifier enumeration. */
export const notFound = () => new AppError('NOT_FOUND', 'This item is unavailable.');
export const forbidden = (message = 'You do not have permission for this operation.') =>
  new AppError('FORBIDDEN', message);
