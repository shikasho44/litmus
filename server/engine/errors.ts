/**
 * Engine errors are shared/api ApiError instances (so the embedded client can throw them
 * straight to the UI) with an HTTP status attached for the handler.
 */
import { ApiError } from '../../shared/api.js';

export type ApiErrorCode = ApiError['code'];

export class EngineError extends ApiError {
  constructor(code: ApiErrorCode, message: string, readonly status: number, retryable = false) {
    super(code, message, retryable);
    this.name = 'EngineError';
  }
}

export const badRequest = (msg: string) => new EngineError('bad_request', msg, 400);
export const notFound = (msg: string) => new EngineError('bad_request', msg, 404);
export const forbidden = (msg: string) => new EngineError('bad_request', msg, 403);
export const rateLimited = (msg: string, retryable = true) => new EngineError('rate_limited', msg, 429, retryable);

export function statusOf(e: unknown): number {
  if (e instanceof EngineError) return e.status;
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'bad_request': return 400;
      case 'bad_token': return 401;
      case 'rate_limited': return 429;
      case 'timeout': return 504;
      case 'network': return 502;
      default: return 500;
    }
  }
  return 500;
}
