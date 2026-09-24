/** Errors the API maps to HTTP responses. Anything else is a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message);
export const unauthenticated = () => new AppError(401, 'unauthenticated', 'Sign-in required');
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const invalid = (message: string, details?: unknown) => new AppError(400, 'invalid', message, details);
export const staleVersion = () =>
  new AppError(409, 'stale_version', 'The record was changed by someone else. Reload and try again.');
