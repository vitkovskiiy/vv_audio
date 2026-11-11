/**
 * Business errors. Services throw these; the single error handler in app.ts turns them into HTTP responses,
 * so no layer needs try/catch just to pick a status code.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Некоректні дані запиту', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Увійдіть в акаунт') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Недостатньо прав') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Не знайдено') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class PaymentRequiredError extends AppError {
  constructor(code: string, message: string) {
    super(402, code, message);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(422, 'IDEMPOTENCY_KEY_REUSED', 'Цей Idempotency-Key уже використано з іншим запитом');
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Забагато спроб, спробуйте пізніше') {
    super(429, 'RATE_LIMITED', message);
  }
}

export class DbUnavailableError extends AppError {
  constructor() {
    super(503, 'DB_UNAVAILABLE', 'База даних тимчасово недоступна');
  }
}
